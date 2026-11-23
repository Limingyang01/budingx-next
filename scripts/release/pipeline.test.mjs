import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyRegistryFailure,
  classifyRemoteState,
  validateChannel,
  validateReleaseNotes
} from './pipeline.mjs'

const notes = (extra = '') =>
  [
    '# v1.2.3 · SP009',
    '',
    '## 变更',
    '- 发布链路可判定',
    '',
    '## 兼容性',
    '- 无破坏性变化',
    '',
    '## 升级',
    '- `npm install -g budingx@latest`',
    '',
    '## 已知限制',
    '- 未验证 macOS',
    '',
    '## 验证',
    '- `npm test` 通过',
    extra
  ].join('\n')

test('稳定版本可以使用默认的 latest 通道', () => {
  const result = validateChannel({ version: '1.2.3', tag: 'latest' })
  assert.equal(result.tag, 'latest')
  assert.equal(result.prerelease, false)
})

test('预发布版本不能使用 latest 通道', () => {
  assert.throws(
    () => validateChannel({ version: '1.2.3-beta.1', tag: 'latest' }),
    /prerelease/i
  )
})

test('预发布版本可以使用 next 通道', () => {
  const result = validateChannel({ version: '1.2.3-beta.1', tag: 'next' })
  assert.equal(result.tag, 'next')
  assert.equal(result.prerelease, true)
})

test('稳定版本使用其他通道时必须在发行说明声明 dist-tag', () => {
  assert.throws(
    () =>
      validateChannel({
        version: '1.2.3',
        tag: 'next',
        releaseNotes: notes()
      }),
    /dist-tag/
  )
  const result = validateChannel({
    version: '1.2.3',
    tag: 'next',
    releaseNotes: notes('dist-tag: next')
  })
  assert.equal(result.tag, 'next')
})

test('非法通道名被拒绝', () => {
  for (const tag of ['Latest', 'next_tag', '-next', '1next', '']) {
    assert.throws(
      () => validateChannel({ version: '1.2.3', tag }),
      /channel|tag/i,
      `tag ${JSON.stringify(tag)} should be rejected`
    )
  }
})

test('认证类失败被分类为 auth 并要求重新登录而不是改版本', () => {
  const failure = classifyRegistryFailure(
    Object.assign(new Error('npm ERR! code E401'), { code: 'E401' })
  )
  assert.equal(failure.kind, 'auth')
  assert.match(failure.guidance, /login|2FA|重新登录/i)
  assert.doesNotMatch(failure.guidance, /bump|新版本号/i)
})

test('权限类失败被分类为 permission 且不建议更换 registry 或账号', () => {
  const failure = classifyRegistryFailure(
    Object.assign(new Error('npm ERR! code E403'), { err: 'code E403' })
  )
  assert.equal(failure.kind, 'permission')
  assert.match(failure.guidance, /permission|publish access/i)
  assert.doesNotMatch(failure.guidance, /use another registry|try another account|switch to/i)
})

test('版本或名称冲突被分类为 conflict', () => {
  const failure = classifyRegistryFailure(
    new Error('Version already exists; verify remote receipt rather than uploading again')
  )
  assert.equal(failure.kind, 'conflict')
  assert.match(failure.guidance, /query|never upload it again/i)
})

test('网络类失败被分类为 network', () => {
  const failure = classifyRegistryFailure(
    Object.assign(new Error('request failed'), { code: 'ETIMEDOUT' })
  )
  assert.equal(failure.kind, 'network')
})

test('未知失败被分类为 unknown 并要求保留现场', () => {
  const failure = classifyRegistryFailure(new Error('something odd happened'))
  assert.equal(failure.kind, 'unknown')
  assert.match(failure.guidance, /报告|report|人工/i)
})

test('发行说明缺少小节时被拒绝并列出缺失项', () => {
  assert.throws(
    () => validateReleaseNotes('# v1.2.3\n## 变更\n- 少量变更', { version: '1.2.3' }),
    (error) => {
      assert.match(error.message, /兼容性/)
      assert.match(error.message, /验证/)
      return true
    }
  )
})

test('发行说明仍是草稿时被拒绝', () => {
  assert.throws(
    () => validateReleaseNotes(notes().replace('- `npm test` 通过', '- replace this draft'), { version: '1.2.3' }),
    /draft|草稿/i
  )
})

test('结构完整的发行说明通过并返回小节列表', () => {
  const result = validateReleaseNotes(notes(), { version: '1.2.3' })
  assert.equal(result.sections.length, 5)
  assert.deepEqual(result.missing, [])
})

test('发行说明必须提到对应版本号', () => {
  assert.throws(
    () => validateReleaseNotes(notes(), { version: '9.9.9' }),
    /9\.9\.9/
  )
})

test('远端查询 404 判定为未发布', () => {
  const result = classifyRemoteState({
    error: Object.assign(new Error('not found'), { code: 'E404' }),
    version: '1.2.3'
  })
  assert.equal(result.state, 'not-published')
})

test('远端版本与 integrity 一致判定为已发布', () => {
  const result = classifyRemoteState({
    metadata: { version: '1.2.3', dist: { integrity: 'sha512-abc' } },
    version: '1.2.3',
    expectedIntegrity: 'sha512-abc'
  })
  assert.equal(result.state, 'published')
})

test('远端 integrity 与本地不一致判定为内容不一致', () => {
  const result = classifyRemoteState({
    metadata: { version: '1.2.3', dist: { integrity: 'sha512-other' } },
    version: '1.2.3',
    expectedIntegrity: 'sha512-abc'
  })
  assert.equal(result.state, 'mismatch')
})

test('远端版本号不同判定为内容不一致', () => {
  const result = classifyRemoteState({
    metadata: { version: '1.2.2', dist: { integrity: 'sha512-abc' } },
    version: '1.2.3',
    expectedIntegrity: 'sha512-abc'
  })
  assert.equal(result.state, 'mismatch')
})

test('查询失败且没有元数据时判定为未知', () => {
  const result = classifyRemoteState({
    error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    version: '1.2.3'
  })
  assert.equal(result.state, 'unknown')
})
