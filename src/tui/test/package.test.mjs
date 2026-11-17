import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

test('产品清单声明的运行时依赖恰为渲染白名单', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    'ink',
    'react',
    'string-width'
  ])
})

test('bin 指向拍平后的入口且不依赖 workspace/file 协议', () => {
  assert.equal(manifest.bin.budingx, 'dist/tui/cli.js')
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.equal(
      /^(workspace:|file:|link:)/.test(version),
      false,
      `${name} must not use a workspace or file protocol`
    )
  }
})

test('files 清单只包含编译产物与说明文件', () => {
  assert.deepEqual(manifest.files, ['dist/', 'README.md', 'LICENSE'])
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.private, undefined)
})

test('Node 版本边界沿用既有约束', () => {
  assert.equal(manifest.engines.node, '>=22.18.0')
})

test('入口文件存在于编译产物中', () => {
  const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
  const source = readFileSync(cli, 'utf8')
  assert.match(source, /budingx/)
})
