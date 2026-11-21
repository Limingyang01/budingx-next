// SP007 T1 契约扩展：图片块规范化与档案 protocol/vision 兼容（MM-05/07、PC-02）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeForApi } from '../../tui/dist/core/normalize.js'
import { createProfile, updateProfile, mergeSources } from '../../tui/dist/storage/profiles.js'

const img = (id, mediaType = 'image/png', data = 'aGVsbG8=') => ({
  type: 'image', id, mediaType, data, width: 4, height: 4
})
const user = (id, blocks) => ({ id, role: 'user', blocks })

test('纯文本用户消息路径字节级不变（回归保护）', () => {
  const api = normalizeForApi([
    user('m1', [{ type: 'text', text: 'hello' }]),
    user('m2', [
      { type: 'context', source: 'a.txt', content: 'file body' },
      { type: 'text', text: 'look' }
    ])
  ])
  assert.deepEqual(api, [
    { role: 'user', content: 'hello' },
    { role: 'user', content: '<file_context source="a.txt">\nfile body\n</file_context>\n\nlook' }
  ])
})

test('含图用户消息→content parts：text 在前图片在后，data URI 形状', () => {
  const api = normalizeForApi([
    user('m1', [{ type: 'text', text: '这是什么' }, img(1), img(2, 'image/jpeg', 'eHl6')])
  ])
  assert.deepEqual(api, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '这是什么' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eHl6' } }
      ]
    }
  ])
})

test('含图但无文本→仅图片 parts；context 包裹文本仍在前', () => {
  const api = normalizeForApi([
    user('m1', [img(1)]),
    user('m2', [
      { type: 'context', source: 'b.txt', content: 'ctx' },
      { type: 'text', text: 'q' },
      img(2)
    ])
  ])
  assert.deepEqual(api[0], {
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }]
  })
  assert.deepEqual(api[1], {
    role: 'user',
    content: [
      { type: 'text', text: '<file_context source="b.txt">\nctx\n</file_context>\n\nq' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
    ]
  })
})

test('assistant/tool 消息中的 image 块不进入 API（仅 user 携带图片）', () => {
  const api = normalizeForApi([
    user('m1', [{ type: 'text', text: 'go' }]),
    { id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: 'ok' }, img(9)] },
    { id: 'm3', role: 'tool', blocks: [{ type: 'tool_result', callId: 'c1', content: 'r', isError: false }] }
  ])
  // 悬空 tool_result 无匹配调用被剥离；assistant 仅文本
  assert.deepEqual(api, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'ok' }
  ])
})

test('旧档案无 protocol/vision：缺省兼容，不迁移不重算', () => {
  const p = createProfile({ label: 'L', baseUrl: 'https://api.example.com/v1', model: 'm' })
  assert.equal(p.protocol, undefined)
  assert.deepEqual(p.capabilities, { tools: true })
  const u = updateProfile(p, { label: 'L2' })
  assert.equal(u.protocol, undefined)
  assert.equal(u.capabilities.vision, undefined)
  assert.equal(u.capabilities.tools, true)
})

test('新档案 protocol=anthropic 与 vision=false 持久化并可更新', () => {
  const p = createProfile({
    label: 'A', baseUrl: 'https://api.example.com/anthropic', model: 'claude-x',
    protocol: 'anthropic', vision: false
  })
  assert.equal(p.protocol, 'anthropic')
  assert.deepEqual(p.capabilities, { tools: true, vision: false })
  const u = updateProfile(p, { vision: true })
  assert.equal(u.protocol, 'anthropic')
  assert.equal(u.capabilities.vision, true)
  const u2 = updateProfile(u, { protocol: 'openai' })
  assert.equal(u2.protocol, 'openai')
})

test('mergeSources 传递档案 protocol/vision 到 ResolvedConfig', () => {
  const resolved = mergeSources({
    args: [],
    env: {},
    file: {
      profileId: 'p1', baseUrl: 'https://api.example.com/anthropic', model: 'claude-x',
      apiKey: 'k', protocol: 'anthropic', vision: false
    }
  })
  assert.equal(resolved.protocol, 'anthropic')
  assert.equal(resolved.vision, false)
  assert.equal(resolved.source, 'file')
  const plain = mergeSources({ args: [], env: {}, file: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k' } })
  assert.equal(plain.protocol, undefined)
  assert.equal(plain.vision, undefined)
})
