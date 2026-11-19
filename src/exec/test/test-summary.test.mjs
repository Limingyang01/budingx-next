import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestSummaryParser } from '../../tui/dist/exec/test-summary.js'

function parse(command, stdout, stderr = '') {
  const parser = createTestSummaryParser(command)
  // Split metadata, CRLF, and multibyte UTF-8 across chunk boundaries.
  for (const [channel, output] of [['stdout', stdout], ['stderr', stderr]]) {
    const bytes = Buffer.from(output)
    for (let index = 0; index < bytes.length; index += 7) {
      parser.push(channel, bytes.subarray(index, index + 7))
    }
  }
  return parser.result()
}

test('terminal Node/TAP summary counts passed tests rather than skipped or TODO entries', () => {
  const summary = '# tests 4\r\n# suites 0\r\n# pass 2\r\n# fail 0\r\n# cancelled 0\r\n# skipped 1\r\n# todo 1\r\n# duration_ms 1.5'
  assert.deepEqual(parse('node --test src/range.test.mjs', '打印调试内容\r\n' + summary), { executed: 2 })
  assert.equal(parse('node --test', '# tests 0\n# pass 0\n# fail 0\n# skipped 0'), undefined)
  assert.equal(parse('node --test', '# tests 1\n# pass 0\n# fail 0\n# skipped 1'), undefined)
  assert.equal(parse('node --test', '# tests 1\n# pass 1\n# fail 0\n# skipped 1'), undefined)
  assert.equal(parse('node --test', 'ok 1 incomplete\n1..1'), undefined)
})

test('native TAP requires a complete plan, positive pass, and consistent terminal summaries', () => {
  assert.deepEqual(parse('bash proof.test.sh', 'ok 1 检查输入\nnot ok 2 deferred # TODO test pending\nok 3 # SKIP environment\n1..3'), { executed: 1 })
  const noTests = '1..0 # SKIP no fixtures\n'
  const valid = '1..1\nok 1 valid\n'
  for (const text of [noTests, '1..1\nok 1 # SKIP disabled\n', '1..1\nnot ok 1\n', '1..2\nok 1\n', 'Bail out! runner crashed\n' + valid]) {
    assert.equal(parse('bash proof.test.sh', text), undefined, text)
  }
  assert.equal(parse('bash proof.test.sh', noTests, valid), undefined)
  assert.equal(parse('bash proof.test.sh', valid + '# tests 0\n# pass 0\n# fail 0\n# skipped 0\n'), undefined)
})

test('explicit TAP failure after cleanup revokes a completed report even without a number or with a long description', () => {
  const tap = 'TAP version 13\nok 1 - ran first assertion\n1..1\n'
  const node = tap + '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n'
  const cleanup = 'ok cleanup complete\n' + 'cleanup details '.repeat(100) + '\n'
  for (const [command, earlier] of [['bash proof.test.sh', tap], ['node --test', node]]) {
    assert.deepEqual(parse(command, earlier + cleanup), { executed: 1 })
    for (const failure of [
      'not ok - later assertion failed',
      'not ok - ' + '诊'.repeat(1500),
      '\x1b[31mnot ok 2 - ' + 'a'.repeat(1500) + '\x1b[0m'
    ]) {
      assert.equal(parse(command, earlier + cleanup + failure + '\nposttest complete\n'), undefined, failure.slice(0, 75))
    }
  }
})

test('pytest and Python unittest require positive passing counts from their terminal report', () => {
  assert.deepEqual(parse('python3 -m unittest', '', 'Ran 4 tests in 0.002s\n\nOK (skipped=1)'), { executed: 3 })
  assert.equal(parse('python3 -m unittest', '', 'Ran 2 tests in 0.001s\n\nOK (skipped=1, expected failures=1)'), undefined)
  assert.equal(parse('python3 -m unittest', '', 'Ran 0 tests in 0.000s\n\nOK'), undefined)
  assert.equal(parse('npm test', '1..1\nok 1 fake\n', 'Ran 0 tests in 0.000s\n\nNO TESTS RAN'), undefined)
  assert.equal(parse('python3 -m unittest', '', 'Ran 6 tests in 0.001s\n\nFAILED (failures=1)'), undefined)
  assert.deepEqual(parse('pytest -q', '\x1b[32m=== 3 passed, 1 skipped in 0.04s ===\x1b[0m'), { executed: 3 })
  assert.equal(parse('pytest', '=== 3 skipped in 0.02s ==='), undefined)
  assert.equal(parse('pytest', '=== 1 passed, 1 failed in 0.12s ==='), undefined)
  assert.equal(parse('pytest', '=== no tests ran in 0.00s ==='), undefined)
})

test('npm posttest logs keep a complete count after diagnostics move it outside the rolling tail', () => {
  const summary = '# tests 1\n# pass 1\n# fail 0\n# skipped 0'
  const chunks = '诊'.repeat(1_000_000) + '\n' + summary
  assert.deepEqual(parse('npm test', chunks), { executed: 1 })
  assert.equal(parse('npm test', 'ordinary output without a summary'), undefined)
  const posttest = '\n> posttest\n> node cleanup.js\n' + 'cleanup 完成\n'.repeat(80)
  assert.deepEqual(parse('npm test', summary + posttest), { executed: 1 })
  assert.deepEqual(parse('node --test', summary + '\ncleanup complete'), { executed: 1 })
})

test('trailing logs retain complete unittest and pytest summaries', () => {
  assert.deepEqual(parse('python3 -m unittest', '', 'Ran 2 tests in 0.001s\n\nOK\ncleanup finished\n'), { executed: 2 })
  assert.deepEqual(parse('pytest', '=== 2 passed in 0.03s ===\narchive cleanup complete'), { executed: 2 })
})

test('a later explicit empty, failed, incomplete, or malformed report overrides earlier evidence', () => {
  const valid = '# tests 1\n# pass 1\n# fail 0\n# skipped 0'
  const cleanup = '\narchiving\ncleanup finished\n'
  for (const later of [
    '# tests 0\n# pass 0\n# fail 0\n# skipped 0',
    '# tests 1\n# pass 0\n# fail 0\n# skipped 1',
    '# tests 1\n# pass 0\n# fail 1\n# skipped 0',
    '# tests 1\n# pass invalid\n# fail 0\n# skipped 0',
    '# tests 2\n# pass 2',
    'ok 1 incomplete TAP report without a plan',
    '1..2\nok 1 incomplete native TAP report',
    'Ran 0 tests in 0.001s\nNO TESTS RAN',
    'Ran 1 test in 0.001s\nFAILED (failures=1)',
    'Ran 1 test in 0.001s',
    '=== 1 skipped in 0.04s ===',
    'Tests: 1 passed, malformed total'
  ]) {
    assert.equal(parse('npm test', valid + cleanup + later + cleanup), undefined, later)
  }
  assert.equal(parse('npm test', valid + cleanup, 'Ran 0 tests in 0.001s\nNO TESTS RAN' + cleanup), undefined)
  assert.equal(parse('npm test', valid + cleanup, 'Ran 2 tests in 0.001s\nOK' + cleanup), undefined)
  assert.equal(parse('node --test', valid + cleanup, '# tests 0\n# pass 0\n# fail 0\n# skipped 0' + cleanup), undefined)
  const laterValid = '# tests 2\n# pass 2\n# fail 0\n# skipped 0'
  assert.deepEqual(parse('npm test', valid + cleanup + laterValid + cleanup), { executed: 2 })
  assert.deepEqual(parse('npm test', valid + '\n' + laterValid + cleanup), { executed: 2 })
  assert.deepEqual(parse('npm test', valid + cleanup + 'ok 1 first\nok 2 second\n1..2' + cleanup), { executed: 2 })
  assert.deepEqual(parse('npm test', valid + cleanup + '1..2\nok 1 first\nok 2 second' + cleanup), { executed: 2 })
})

test('Jest, Vitest, Mocha, and Cargo require explicit positive passing counts', () => {
  assert.deepEqual(parse('jest', '', 'Test Suites: 1 passed, 1 total\nTests:       2 passed, 2 total\nSnapshots: 0 total\nTime: 0.346 s\nRan all test suites.\nCache cleanup done'), { executed: 2 })
  assert.equal(parse('jest', 'No tests found, exiting with code 0'), undefined)
  assert.deepEqual(parse('vitest run', ' Test Files  1 passed (1)\n      Tests  3 passed | 1 skipped (4)\n   Start at 16:48:23\n   Duration 320ms\nCache cleanup done'), { executed: 3 })
  assert.equal(parse('vitest run', '      Tests  2 skipped (2)\n   Duration 120ms'), undefined)
  assert.deepEqual(parse('mocha', '  1 passing (4ms)\n  1 pending\nCache cleanup done'), { executed: 1 })
  assert.equal(parse('mocha', '  0 passing (3ms)\n  1 pending'), undefined)
  const cargo = (passed) => `test result: ok. ${passed} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s`
  assert.deepEqual(parse('cargo test', `running 4 tests\n${cargo(4)}\n\nrunning 0 tests\n${cargo(0)}`), { executed: 4 })
  assert.equal(parse('cargo test', `running 0 tests\n${cargo(0)}`), undefined)
  assert.equal(parse('go test', 'ok  example/package   0.511s'), undefined)
})
