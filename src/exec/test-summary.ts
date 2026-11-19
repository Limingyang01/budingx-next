import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'

const MAX_LINE_CHARS = 1024
const MAX_TAIL_LINES = 16

type Counter = 'tests' | 'pass' | 'fail' | 'skipped' | 'cancelled' | 'todo'
const TAP_COUNTER = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/

function count(value: string): number {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : NaN
}

/** The final Node/TAP reporter counters take precedence over plan lines. */
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
  let pending = ''
  let overflow = false
  let tapPlan: number | undefined
  let tapTotal = 0
  let tapPassed = 0
  let invalidTap = false
  let sawNodeCounters = false
  let cargoPassed: number | undefined
  let cargoFailed = false

  function finishLine(): void {
    // Long lines are neither summaries nor observable TAP directives.
    const line = overflow ? '\0' : stripVTControlCharacters(pending).replace(/\r$/, '')
    pending = ''
    overflow = false
    if (!line.trim()) return
    tail.push(line.trimEnd())
    if (tail.length > MAX_TAIL_LINES) tail.shift()
    if (TAP_COUNTER.test(line)) sawNodeCounters = true
    const cargo = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; \d+ ignored; \d+ measured; \d+ filtered out; finished in [\d.]+s$/.exec(line)
    if (cargo) {
      cargoPassed = (cargoPassed ?? 0) + count(cargo[2])
      cargoFailed ||= cargo[1] !== 'ok' || count(cargo[3]) !== 0
    }

    const plan = /^1\.\.(\d+)(?:\s+#\s*SKIP(?:\s.*)?)?$/i.exec(line)
    if (plan) {
      if (tapPlan !== undefined) invalidTap = true
      tapPlan = count(plan[1])
      if (line.includes('#') && tapPlan !== 0) invalidTap = true
    } else if (/^Bail out!/i.test(line)) {
      invalidTap = true
    } else {
      const assertion = /^(ok|not ok)(?=\s|$)(?:\s+(\d+)(?=\s|$))?/.exec(line)
      if (!assertion) return
      tapTotal += 1
      if (assertion[2] !== undefined && count(assertion[2]) !== tapTotal) invalidTap = true
      if (/\s+#\s*(?:skip|todo)(?:\s|$)/i.test(line)) return
      if (assertion[1] === 'ok') tapPassed += 1
      else invalidTap = true
    }
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
      const last = tail.at(-1) ?? ''
      const previous = tail.at(-2) ?? ''
      if (program === 'node') return nodeSummary(tail)
      if (program === 'python' || program === 'python3') return unittestSummary(previous, last)
      if (program === 'pytest') return pytestSummary(last)
      if (program === 'jest') return jestSummary(tail)
      if (program === 'vitest') return vitestSummary(tail)
      if (program === 'mocha') return mochaSummary(tail)
      if (program === 'cargo') return cargoFailed ? 0 : cargoPassed
      if (program === 'go') return undefined
      const tap = sawNodeCounters ? 0 : tapPlan === undefined ? undefined : !invalidTap && tapPlan === tapTotal ? tapPassed : 0
      return nodeSummary(tail) ?? unittestSummary(previous, last) ?? pytestSummary(last) ??
        jestSummary(tail) ?? vitestSummary(tail) ?? mochaSummary(tail) ?? (cargoFailed ? 0 : cargoPassed) ?? tap
    }
  }
}

/** Parse small terminal summaries without depending on the transcript's truncation budget. */
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
