// SP008 T17：serve 参数解析单测与真实进程错误退出码（--help/未知参数/越界/损坏配置）。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseServeArgs } from '../dist/tui/serve.js'
import { cli } from './helpers/host-process.mjs'

test('parseServeArgs 默认值：stdio、回环、端口 0、合法随机会话 id', () => {
  const options = parseServeArgs([])
  assert.equal(options.transport, 'stdio')
  assert.equal(options.host, '127.0.0.1')
  assert.equal(options.port, 0)
  assert.equal(options.takeover, false)
  assert.equal(options.help, false)
  assert.match(options.sessionId, /^[a-z0-9][a-z0-9_-]{0,127}$/i)
})

test('parseServeArgs 解析全部选项', () => {
  const options = parseServeArgs([
    '--transport', 'ws',
    '--host', 'localhost',
    '--port', '8080',
    '--session', 'my-session_1',
    '--takeover',
    '--token', 'secret',
    '--home', '/tmp/home'
  ])
  assert.equal(options.transport, 'ws')
  assert.equal(options.host, 'localhost')
  assert.equal(options.port, 8080)
  assert.equal(options.sessionId, 'my-session_1')
  assert.equal(options.takeover, true)
  assert.equal(options.token, 'secret')
  assert.equal(options.home, '/tmp/home')
  assert.equal(parseServeArgs(['--help']).help, true)
  assert.equal(parseServeArgs(['-h']).help, true)
  assert.equal(parseServeArgs(['--port', '0']).port, 0)
  assert.equal(parseServeArgs(['--port', '65535']).port, 65535)
})

test('parseServeArgs 用法错误携带 exitCode 2 与稳定文案', () => {
  const cases = [
    [['--bogus'], 'Unknown option: --bogus'],
    [['--transport'], '--transport requires a value'],
    [['--transport', 'carrier-pigeon'], 'Invalid --transport; expected stdio or ws'],
    [['--port', '70000'], 'Invalid --port; expected 0-65535'],
    [['--port', '-1'], 'Invalid --port; expected 0-65535'],
    [['--port', 'abc'], 'Invalid --port; expected 0-65535'],
    [['--port', '1.5'], 'Invalid --port; expected 0-65535'],
    [['--port', ''], 'Invalid --port; expected 0-65535'],
    [['--port', '  '], 'Invalid --port; expected 0-65535'],
    [['--session', 'bad id!'], 'Invalid --session; expected letters, digits, - and _'],
    [['--session', ''], 'Invalid --session; expected letters, digits, - and _'],
    [['--token'], '--token requires a value'],
    [['--home'], '--home requires a value'],
    [['--host'], '--host requires a value'],
    [['--session'], '--session requires a value']
  ]
  for (const [args, message] of cases) {
    assert.throws(
      () => parseServeArgs(args),
      (error) => {
        assert.equal(error.message, message, JSON.stringify(args))
        assert.equal(error.exitCode, 2, JSON.stringify(args))
        return true
      },
      JSON.stringify(args)
    )
  }
})

function runCli(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('close', (code) => resolveRun({ code, stdout, stderr }))
  })
}

test('真实进程：serve --help 输出用法并退出 0', async () => {
  const { code, stdout } = await runCli(['serve', '--help'])
  assert.equal(code, 0)
  assert.match(stdout, /Usage: budingx serve/)
  assert.match(stdout, /--transport stdio\|ws/)
})

test('真实进程：未知参数退出 2 并写明选项', async () => {
  const { code, stderr } = await runCli(['serve', '--bogus'])
  assert.equal(code, 2)
  assert.match(stderr, /Error: Unknown option: --bogus/)
})

test('真实进程：越界端口与非法会话 id 退出 2', async () => {
  const port = await runCli(['serve', '--port', '70000'])
  assert.equal(port.code, 2)
  assert.match(port.stderr, /Invalid --port; expected 0-65535/)
  const session = await runCli(['serve', '--session', 'bad id!'])
  assert.equal(session.code, 2)
  assert.match(session.stderr, /Invalid --session/)
})

test('真实进程：损坏配置启动失败退出 1，备份保留且不抹数据', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-serve-cli-'))
  const dataRoot = join(home, '.budingx')
  mkdirSync(dataRoot, { recursive: true })
  const configFile = join(dataRoot, 'config.json')
  writeFileSync(configFile, '{corrupt', 'utf8')
  const { code, stderr } = await runCli(['serve', '--transport', 'stdio', '--session', 'cli-fail'], {
    HOME: home,
    USERPROFILE: home
  })
  assert.equal(code, 1)
  assert.match(stderr, /Error:/)
  assert.match(stderr, /corrupt/)
  assert.equal(existsSync(configFile + '.bak'), true)
  assert.equal(existsSync(configFile), true)
})
