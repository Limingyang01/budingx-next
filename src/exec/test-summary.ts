import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'

const MAX_LINE_CHARS = 1024
const MAX_TAIL_LINES = 16

type Counter = 'tests' | 'pass' | 'fail' | 'skipped' | 'cancelled' | 'todo'
const TAP_COUNTER = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/
const TAP_COUNTER_MARKER = /^# (?:tests|pass|fail|skipped|cancelled|todo)(?:\s|$)/
const DIRECT_REPORTERS = new Set(['node', 'pytest', 'jest', 'vitest', 'mocha', 'cargo', 'go'])
const PYTEST_MARKER = /^(?:=+ )?(?:no tests ran|\d+ (?:passed|failed|errors?|skipped|deselected|xfailed|xpassed)(?:, [^,]+)*)(?: in(?:\s|$)| =+$|$)/

function count(value: string): number {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : NaN
}

/** Parse the contiguous Node/TAP counter block ending at the newest counter. */
function nodeSummary(tail: readonly string[]): number | undefined {
  const counters: Partial<Record<Counter, number>> = {}
  let recognized = false
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index]
    if (/^# (?:duration_ms [\d.]+|suites \d+)$/.test(line)) continue
    const match = TAP_COUNTER.exec(line)
    if (!match) break
    recognized = true
    const key = match[1] as Counter
    if (counters[key] !== undefined) return 0
    counters[key] = count(match[2])
    if (key === 'tests') break
  }
  if (!recognized) return undefined
  const { tests, pass, fail, skipped, cancelled = 0, todo = 0 } = counters
  if (tests === undefined || pass === undefined || skipped === undefined || fail !== 0 || cancelled !== 0) return 0
  return tests === pass + skipped + todo ? pass : 0
}

function unittestSummary(previous: string, last: string): number | undefined {
  const ran = /^Ran (\d+) tests? in [\d.]+s$/.exec(previous)
  if (ran && (last === 'NO TESTS RAN' || /^FAILED(?: \([^()]*\))?$/.test(last))) return 0
  const match = /^OK(?: \(([^()]*)\))?$/.exec(last)
  if (!match || !ran) return undefined
  let passed = count(ran[1])
  const seen = new Set<string>()
  for (const entry of match[1]?.split(', ') ?? []) {
    const modifier = /^(skipped|expected failures)=(\d+)$/.exec(entry)
    if (!modifier || seen.has(modifier[1])) return 0
    seen.add(modifier[1])
    passed -= count(modifier[2])
  }
  return Math.max(0, passed)
}

function reportCounts(entries: string[]): Map<string, number> | undefined {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const match = /^(\d+) (passed|failed|skipped|error|errors|deselected|xfailed|xpassed|warnings?|reruns?|todo|total)$/.exec(entry)
    if (!match || counts.has(match[2])) return undefined
    const value = count(match[1])
    if (!Number.isSafeInteger(value)) return undefined
    counts.set(match[2], value)
  }
  return counts
}

function pytestSummary(last: string): number | undefined {
  if (/^(?:=+ )?no tests ran in [\d.]+s(?: =+)?$/.test(last)) return 0
  const summary = /^(?:=+ )?(\d+ [a-z]+(?:, \d+ [a-z]+)*) in [\d.]+s(?: =+)?$/.exec(last)
  if (!summary) return undefined
  const counts = reportCounts(summary[1].split(', '))
  if (!counts || (counts.get('failed') ?? 0) !== 0 || (counts.get('error') ?? 0) !== 0 ||
    (counts.get('errors') ?? 0) !== 0) return 0
  return counts.get('passed') ?? 0
}

function jestSummary(tail: readonly string[]): number | undefined {
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index].trim()
    if (/^No tests found(?:, exiting with code \d+)?$/.test(line)) return 0
    if (/^(?:Snapshots:|Time:|Ran (?:all|the) test suites\b)/.test(line)) continue
    const tests = /^Tests:\s+(.+)$/.exec(line)
    if (!tests) return undefined
    const counts = reportCounts(tests[1].split(', '))
    if (!counts) return 0
    const passed = counts.get('passed') ?? 0
    return counts.get('total') === passed + (counts.get('skipped') ?? 0) + (counts.get('todo') ?? 0) &&
      (counts.get('failed') ?? 0) === 0 ? passed : 0
  }
}

function vitestSummary(tail: readonly string[]): number | undefined {
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index].trim()
    if (/^No test files found(?:, exiting with code \d+)?$/.test(line)) return 0
    if (/^(?:Start at|Duration)\s/.test(line)) continue
    const tests = /^Tests\s+(.+?)\s+\((\d+)\)$/.exec(line)
    if (!tests) return undefined
    const counts = reportCounts(tests[1].split(' | '))
    const passed = counts?.get('passed') ?? 0
    return counts && count(tests[2]) === passed + (counts.get('skipped') ?? 0) + (counts.get('todo') ?? 0) &&
      (counts.get('failed') ?? 0) === 0 ? passed : 0
  }
}

function mochaSummary(tail: readonly string[]): number | undefined {
  let failed = false
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index].trim()
    if (/^\d+ pending$/.test(line)) continue
    const failure = /^(\d+) failing$/.exec(line)
    if (failure) {
      failed ||= count(failure[1]) !== 0
      continue
    }
    const passing = /^(\d+) passing \([\d.]+(?:ms|s|m)\)$/.exec(line)
    if (!passing) return undefined
    return failed ? 0 : count(passing[1])
  }
}

function captureStream(program: string) {
  const decoder = new StringDecoder('utf8')
  const tail: string[] = []
  const selected = program === 'python' || program === 'python3'
    ? 'unittest'
    : DIRECT_REPORTERS.has(program) ? program : undefined
  const accepts = (reporter: string) => selected === undefined || selected === reporter
  let pending = ''
  let overflow = false
  let reported: number | undefined
  let startedTap = false
  let tapPlan: number | undefined
  let tapTotal = 0
  let tapPassed = 0
  let invalidTap = false
  let sawNodeCounters = false
  let cargoPassed: number | undefined
  let cargoFailed = false

  function observeSummary(line: string, previous: string): void {
    if (accepts('node') && TAP_COUNTER_MARKER.test(line)) {
      sawNodeCounters = true
      reported = nodeSummary(tail) ?? 0
    } else if (accepts('unittest') && /^Ran \S+ tests? in(?:\s|$)/.test(line)) {
      // The next nonblank line must finish this report with a known outcome.
      reported = 0
    } else if (accepts('unittest') && (line === 'NO TESTS RAN' || /^FAILED \([^()]*\)$/.test(line))) {
      reported = 0
    } else if (accepts('unittest') && /^OK(?:\s|$)/.test(line)) {
      reported = unittestSummary(previous, line) ?? reported
    } else if (accepts('pytest') && PYTEST_MARKER.test(line)) {
      reported = pytestSummary(line) ?? 0
    } else if (accepts('jest') && /^(?:Tests:|No tests found(?:, exiting with code \d+)?$)/.test(line.trim())) {
      reported = jestSummary(tail) ?? 0
    } else if (accepts('vitest') && /^(?:Tests\s+(?:\d|no tests\b|.*\([^)]+\)$)|No test files found(?:, exiting with code \d+)?$)/.test(line.trim())) {
      reported = vitestSummary(tail) ?? 0
    } else if (accepts('mocha') && /^\d+ (?:passing|pending|failing)(?:\s|$)/.test(line.trim())) {
      reported = mochaSummary(tail) ?? 0
    } else if (accepts('cargo') && line.startsWith('test result:')) {
      const cargo = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; \d+ ignored; \d+ measured; \d+ filtered out; finished in [\d.]+s$/.exec(line)
      const passed = cargo ? count(cargo[2]) : 0
      const success = cargo?.[1] === 'ok' && count(cargo[3]) === 0
      if (selected === 'cargo') {
        // A direct Cargo invocation reports separate unit, integration and doc-test groups.
        cargoPassed = (cargoPassed ?? 0) + passed
        cargoFailed ||= !success
        reported = cargoFailed ? 0 : cargoPassed
      } else {
        reported = success ? passed : 0
      }
    }
  }

  function startTap(): void {
    startedTap = true
    tapPlan = undefined
    tapTotal = 0
    tapPassed = 0
    invalidTap = false
    sawNodeCounters = false
  }

  function observeTap(line: string): void {
    if (!accepts('tap') && !accepts('node')) return
    if (/^TAP version(?:\s|$)/i.test(line)) {
      startTap()
      invalidTap = !/^TAP version \d+$/i.test(line)
      reported = 0
      return
    }
    const plan = /^1\.\.(\d+)(?:\s+#\s*SKIP(?:\s.*)?)?$/i.exec(line)
    if (/^1\.\./.test(line)) {
      if (sawNodeCounters) startTap()
      if (!plan || tapPlan !== undefined) invalidTap = true
      tapPlan = plan ? count(plan[1]) : 0
      if (line.includes('#') && tapPlan !== 0) invalidTap = true
    } else if (/^Bail out!/i.test(line)) {
      invalidTap = true
      reported = 0
      return
    } else {
      const assertion = /^(ok|not ok)(?=\s|$)(?:\s+(\d+)(?=\s|$))?/.exec(line)
      if (!assertion || (!assertion[2] && tapPlan !== undefined && tapPlan === tapTotal)) return
      if (assertion[2]) {
        if (sawNodeCounters) startTap()
        startedTap = true
      }
      tapTotal += 1
      if (assertion[2] !== undefined && count(assertion[2]) !== tapTotal) invalidTap = true
      if (!/\s+#\s*(?:skip|todo)(?:\s|$)/i.test(line)) {
        if (assertion[1] === 'ok') tapPassed += 1
        else invalidTap = true
      }
    }
    // Direct Node requires its own validated counters; a later explicit TAP plan alone cannot replace them.
    if (!sawNodeCounters && (tapPlan !== undefined || startedTap)) {
      reported = accepts('tap') && !invalidTap && tapPlan === tapTotal ? tapPassed : 0
    }
  }

  function finishLine(): void {
    // Long lines are neither summaries nor observable TAP directives.
    const line = overflow ? '\0' : stripVTControlCharacters(pending).trimEnd()
    pending = ''
    overflow = false
    if (!line) return
    const previous = tail.at(-1) ?? ''
    tail.push(line)
    if (tail.length > MAX_TAIL_LINES) tail.shift()
    observeTap(line)
    observeSummary(line, previous)
  }

  function append(text: string): void {
    let start = 0
    while (start < text.length) {
      const newline = text.indexOf('\n', start)
      const end = newline === -1 ? text.length : newline
      if (!overflow) {
        if (pending.length + end - start > MAX_LINE_CHARS) {
          pending = ''
          overflow = true
        } else {
          pending += text.slice(start, end)
        }
      }
      if (newline === -1) break
      finishLine()
      start = newline + 1
    }
  }

  return {
    push(chunk: Buffer) { append(decoder.write(chunk)) },
    result(): number | undefined {
      append(decoder.end())
      if (pending || overflow) finishLine()
      return reported
    }
  }
}

/** Keep the latest recognized reporter outcome independently of ordinary trailing output. */
export function createTestSummaryParser(command: string) {
  const program = command.trim().split(/[ \t]/, 1)[0]
  const streams = { stdout: captureStream(program), stderr: captureStream(program) }
  return {
    push(channel: keyof typeof streams, chunk: Buffer): void { streams[channel].push(chunk) },
    result(): { executed: number } | undefined {
      const stdout = streams.stdout.result()
      const stderr = streams.stderr.result()
      const executed = stdout ?? stderr
      if (executed === undefined || !Number.isSafeInteger(executed) || executed <= 0 ||
        (stdout !== undefined && stderr !== undefined && stdout !== stderr)) return undefined
      return { executed }
    }
  }
}
