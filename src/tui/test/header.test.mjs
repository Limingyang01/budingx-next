import assert from 'node:assert/strict'
import { test } from 'node:test'
import stringWidth from 'string-width'
import {
  ACCENT,
  lineWidth,
  renderHeader,
  setupHint,
  terminalStrategy,
  truncatePath
} from '../dist/tui/render/header.js'

const texts = (lines) => lines.map((line) => line.map((s) => s.text).join(''))
const allText = (lines) => texts(lines).join('\n')
const base = {
  version: '0.1.1',
  cwd: 'D:\\extra_project\\budingx-next',
  strategy: 'pixel'
}

test('终端策略：win32 无现代终端 env 走 ASCII，WT_SESSION/linux 走像素，env 可强制', () => {
  assert.equal(terminalStrategy({}, 'win32'), 'ascii')
  assert.equal(terminalStrategy({ WT_SESSION: 'x' }, 'win32'), 'pixel')
  assert.equal(terminalStrategy({ TERM_PROGRAM: 'vscode' }, 'win32'), 'pixel')
  assert.equal(terminalStrategy({}, 'linux'), 'pixel')
  assert.equal(terminalStrategy({ BUDINGX_FORCE_ASCII_LOGO: '1' }, 'linux'), 'ascii')
  assert.equal(
    terminalStrategy({ BUDINGX_FORCE_PIXEL_LOGO: '1', WT_SESSION: '' }, 'win32'),
    'pixel'
  )
})

test('路径截断保持宽度上限并保留尾部标识，CJK 按显示宽度计', () => {
  const long = 'D:\\very\\long\\middle\\segments\\here\\budingx-next'
  const short = truncatePath(long, 24)
  assert.ok(stringWidth(short) <= 24)
  assert.ok(short.includes('budingx-next'))
  assert.ok(short.includes('…'))
  const cjk = truncatePath('D:\\用户\\很长的中文目录名称\\项目\\仓库', 16)
  assert.ok(stringWidth(cjk) <= 16)
  assert.ok(cjk.includes('仓库'))
  assert.equal(truncatePath('D:\\a', 40), 'D:\\a')
})

test('宽终端首屏：等宽圆角框、顶 border 嵌入产品名与 dim 版本、左吉祥物右信息栏', () => {
  const lines = renderHeader({ ...base, columns: 100 })
  const widths = lines.map((line) => lineWidth(line))
  assert.ok(widths.every((wd) => wd === widths[0]), '所有行显示宽度必须一致')
  assert.ok(widths[0] <= 100)
  const text = allText(lines)
  assert.match(text, /╭/)
  assert.match(text, /╯/)
  assert.match(text, /Welcome to budingx/)
  assert.match(text, /Tips for getting started/)
  assert.match(text, /What's new/)
  assert.match(text, /▲   ▲/)
  assert.match(text, /model: not configured/)
  assert.match(text, /budingx-next/)
  const title = lines[0].find((s) => s.text === 'budingx')
  assert.equal(title.color, ACCENT)
  assert.equal(title.bold, true)
  const version = lines[0].find((s) => s.text === 'v0.1.1')
  assert.equal(version.dim, true)
  const divider = lines[1].filter((s) => s.text === '│' && s.dim)
  assert.equal(divider.length, 1)
  const welcome = lines.flat().find((s) => s.text === 'Welcome to budingx')
  assert.equal(welcome.bold, true)
})

test('窄终端（<70 列）走居中紧凑框，无分隔栏', () => {
  const lines = renderHeader({ ...base, columns: 60 })
  const widths = lines.map((line) => lineWidth(line))
  assert.ok(widths.every((wd) => wd === widths[0]))
  assert.ok(widths[0] <= 60)
  assert.ok(!lines.some((line) => line.some((s) => s.dim && s.text === '│')))
  const welcomeRow = texts(lines).findIndex((t) => t.includes('Welcome to budingx'))
  assert.ok(welcomeRow > 0)
  assert.match(texts(lines)[welcomeRow], /^│\s{2,}/)
})

test('极窄终端不越界', () => {
  const lines = renderHeader({ ...base, columns: 30 })
  const widths = lines.map((line) => lineWidth(line))
  assert.ok(widths.every((wd) => wd === widths[0]))
  assert.ok(widths[0] <= 30)
})

test('ASCII 兜底：全部纯 ASCII，框线 +-|，ASCII 猫', () => {
  const lines = renderHeader({ ...base, columns: 100, strategy: 'ascii' })
  const text = allText(lines)
  assert.ok(/^[\x20-\x7e\n]*$/.test(text), '不得含 Unicode 块字符/框线')
  assert.match(text, /\+-/)
  assert.match(text, /\( o\.o \)/)
  assert.match(text, /Tips for getting started/)
  const widths = lines.map((line) => lineWidth(line))
  assert.ok(widths.every((wd) => wd === widths[0]))
})

test('配置完成后切换无边框精简横幅：吉祥物 + 名称/版本 + 模型行 + cwd', () => {
  const lines = renderHeader({
    ...base,
    columns: 100,
    model: 'my-model',
    baseUrl: 'https://api.example.com/v1',
    keyPresent: true
  })
  assert.equal(lines.length, 4)
  const text = allText(lines)
  assert.ok(!text.includes('╭') && !text.includes('+--'))
  assert.match(text, /my-model · api\.example\.com/)
  assert.match(text, /budingx-next/)
  const name = lines[0].find((s) => s.text === 'budingx')
  assert.equal(name.bold, true)
  assert.equal(lines[0].find((s) => s.text === 'v0.1.1').dim, true)
  assert.ok(!text.includes('key:'), '精简横幅不重复密钥状态')
})

test('首屏任何形态都不接触密钥内容', () => {
  for (const columns of [100, 60, 30]) {
    for (const strategy of ['pixel', 'ascii']) {
      const lines = renderHeader({ ...base, columns, strategy, keyPresent: true, model: 'm' })
      assert.ok(!allText(lines).includes('sk-'))
    }
  }
})

test('未配置时给出可执行的配置引导', () => {
  assert.equal(
    setupHint({ model: '', apiKey: '' }),
    'Not configured · run /provider add <label> <base-url> <model>'
  )
  assert.equal(setupHint({ model: 'm', apiKey: 'k' }), undefined)
})
