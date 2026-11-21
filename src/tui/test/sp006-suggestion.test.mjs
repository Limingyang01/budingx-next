// SP006 波次 G 回归：输入框「下一句」建议由模型按当前对话生成。
// 纯函数用例是 L0，Ink 全屏帧用例是 L2（模型由脚本假件替换，其余真实）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSuggestionMessages,
  conversationLanguage,
  generatePromptSuggestion,
  sanitizeSuggestion,
  suggestionExcerpt
} from '../dist/tui/suggestion.js'
import { mountTty } from './helpers/mount-tty.mjs'

const done = { type: 'message_completed', finishReason: 'stop' }

function message(role, text) {
  return { id: `${role}-${Math.random().toString(16).slice(2)}`, role, blocks: [{ type: 'text', text }] }
}

function toolMessage(text) {
  return { id: 'tool-1', role: 'tool', blocks: [{ type: 'tool_result', callId: 'c1', content: text, isError: false }] }
}

/** 只吐出给定文本的 provider，记录收到的请求。 */
function scriptProvider(texts, seen = []) {
  return {
    async *stream(request) {
      seen.push(request)
      for (const text of texts) yield { type: 'text_delta', text }
      yield done
    }
  }
}

test('G-01 建议上下文只取最近可读文本，跳过工具消息并截断', () => {
  const history = [
    message('user', '先看一下仓库结构'),
    message('assistant', '好的，我来看看。'),
    toolMessage('src/ 下有 core 和 tui'),
    message('user', '把测试补上')
  ]
  const excerpt = suggestionExcerpt(history)
  assert.match(excerpt, /用户：先看一下仓库结构/)
  assert.match(excerpt, /助手：好的，我来看看。/)
  assert.match(excerpt, /用户：把测试补上/)
  assert.doesNotMatch(excerpt, /src\/ 下有 core 和 tui/)
  const long = 'x'.repeat(5000)
  const clipped = suggestionExcerpt([message('user', long)])
  assert.ok(clipped.length < 2000, '单条消息必须截断')
  assert.match(clipped, /…$/)
})

test('G-02 建议请求按对话语言选择提示词', () => {
  assert.equal(conversationLanguage([message('user', '帮我修一下这个 bug')]), 'zh')
  assert.equal(conversationLanguage([message('user', 'fix the failing test')]), 'en')
  const zh = buildSuggestionMessages([message('user', '帮我修一下这个 bug'), message('assistant', '已经修好了')])
  assert.ok(zh && zh[0].role === 'system')
  assert.match(zh[0].content, /下一句/)
  assert.match(zh[1].content, /最近对话/)
  const en = buildSuggestionMessages([message('user', 'fix the failing test'), message('assistant', 'done')])
  assert.ok(en)
  assert.match(en[0].content, /next-input placeholder/i)
  assert.match(en[1].content, /Recent conversation/)
  assert.equal(buildSuggestionMessages([]), undefined)
  assert.equal(buildSuggestionMessages([toolMessage('only tool output')]), undefined)
})

test('G-03 建议清洗：只接受一句用户口吻的短句', () => {
  assert.equal(sanitizeSuggestion('跑一遍单元测试'), '跑一遍单元测试')
  assert.equal(sanitizeSuggestion('「再看下测试覆盖」'), '再看下测试覆盖')
  assert.equal(sanitizeSuggestion('run the tests.'), 'run the tests')
  assert.equal(sanitizeSuggestion('/commit'), '/commit')
  assert.equal(sanitizeSuggestion('yes'), 'yes')
  assert.equal(sanitizeSuggestion('  补一个回归用例  '), '补一个回归用例')
  // 追问是用户最常打的下一句，必须保留（真实模型产出即此形态）。
  assert.equal(sanitizeSuggestion('怎么验证？'), '怎么验证？')
  assert.equal(sanitizeSuggestion('跳过的项是什么原因？'), '跳过的项是什么原因？')
  assert.equal(sanitizeSuggestion('which test covers this?'), 'which test covers this?')
  // 英文按词数约束：12 词以内即使超过 40 字符也应保留。
  assert.equal(
    sanitizeSuggestion('check the failing test in the storage module'),
    'check the failing test in the storage module'
  )
  for (const rejected of [
    'NONE',
    'none at all',
    '无',
    '没有',
    '谢谢',
    '看起来不错',
    'thanks',
    'let me check the diff',
    '我来看看日志',
    '以下是建议',
    '建议：补测试',
    '好的，继续实现',
    '没问题，我来改',
    '该问什么？',
    '- 补测试',
    '**补测试**',
    '补测试\n再跑一遍',
    '（补一个用例）',
    '这是一个非常非常长的建议而且远远超过了四十个字符的上限所以必须被丢弃掉',
    'one two three four five six seven eight nine ten eleven twelve thirteen'
  ]) {
    assert.equal(sanitizeSuggestion(rejected), undefined, `不应接受：${rejected}`)
  }
})

test('G-04 生成建议：小请求、无工具、失败静默', async () => {
  const seen = []
  const provider = scriptProvider(['跑一遍单元测试'], seen)
  const history = [message('user', '改完了吗'), message('assistant', '改完了')]
  assert.equal(await generatePromptSuggestion({ provider, model: 'fixture', history }), '跑一遍单元测试')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 256)
  assert.equal(seen[0].tools, undefined)
  assert.ok(seen[0].messages.length >= 2)

  const silent = scriptProvider(['NONE'])
  assert.equal(await generatePromptSuggestion({ provider: silent, model: 'fixture', history }), undefined)

  const broken = { async *stream() { yield { type: 'failed', message: 'boom' } } }
  assert.equal(await generatePromptSuggestion({ provider: broken, model: 'fixture', history }), undefined)

  const throwing = { async *stream() { throw new Error('network down') } }
  assert.equal(await generatePromptSuggestion({ provider: throwing, model: 'fixture', history }), undefined)

  const skipping = scriptProvider(['不应该被请求'], seen)
  assert.equal(await generatePromptSuggestion({ provider: skipping, model: '   ', history }), undefined)
  assert.equal(await generatePromptSuggestion({ provider: skipping, model: 'fixture', history: [] }), undefined)
})

test('G-05 生成建议：超时与外部取消都能及时退出', async () => {
  let aborted = false
  const hanging = {
    async *stream(request) {
      await new Promise((resolve) => {
        request.signal?.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      })
      throw new Error('aborted')
    }
  }
  const history = [message('user', '改完了吗')]
  const started = Date.now()
  assert.equal(await generatePromptSuggestion({ provider: hanging, model: 'fixture', history, timeoutMs: 20 }), undefined)
  assert.equal(aborted, true)
  assert.ok(Date.now() - started < 2000)

  const controller = new AbortController()
  controller.abort()
  assert.equal(await generatePromptSuggestion({ provider: hanging, model: 'fixture', history, signal: controller.signal }), undefined)
})

test('G-05b 超时计时器必须保持引用：事件循环不得在中止前排空', async () => {
  // 回归：计时器若被 unref，事件循环会在中止前排空，挂起的 provider 永不
  // 结算，Node 22 下表现为 "Promise resolution is still pending but the event
  // loop has already resolved"，并连带取消同文件后续用例。
  let aborted = false
  const hanging = {
    async *stream(request) {
      await new Promise((resolve) => {
        request.signal?.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      })
      throw new Error('aborted')
    }
  }
  const history = [message('user', '改完了吗')]
  assert.equal(await generatePromptSuggestion({ provider: hanging, model: 'fixture', history, timeoutMs: 20 }), undefined)
  assert.equal(aborted, true, '超时必须真正触发中止')
})

test('G-06 回合结束后输入框显示模型生成的建议，Tab 可填入', async (t) => {
  const calls = []
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: '已经补好测试了' }
      yield done
    }
  }
  const ui = await mountTty(t, {
    fullScreen: true,
    provider,
    config: { model: 'fixture' },
    suggestNextPrompt: async (signal) => {
      calls.push(signal)
      return '跑一遍单元测试'
    }
  })
  await ui.send('补个测试\r')
  await ui.waitFor((frame) => frame.includes('已经补好测试了'))
  const frame = await ui.waitFor((candidate) => candidate.includes('Tab 填入') && candidate.includes('跑一遍单元测试'))
  assert.match(frame, /Tab 填入 · 跑一遍单元测试/)
  assert.equal(calls.length, 1)
  assert.ok(calls[0] instanceof AbortSignal, '生成端口应收到取消信号')

  await ui.send('\t')
  await ui.waitFor((candidate) => candidate.includes('> 跑一遍单元测试'))
  assert.doesNotMatch(ui.last(), /Tab 填入/)
})

test('G-07 未注入生成端口时不显示静态话术', async (t) => {
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: '好' }
      yield done
    }
  }
  const ui = await mountTty(t, { fullScreen: true, provider, config: { model: 'fixture' } })
  await ui.send('你好\r')
  await ui.waitFor((frame) => frame.includes('已完成') && frame.includes('› 你好'))
  assert.doesNotMatch(ui.last(), /Tab 填入/)
  assert.doesNotMatch(ui.raw(), /结合项目给我一个具体示例/)
})

test('G-08 建议被拒时输入框保持干净', async (t) => {
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: '好' }
      yield done
    }
  }
  let calls = 0
  const ui = await mountTty(t, {
    fullScreen: true,
    provider,
    config: { model: 'fixture' },
    suggestNextPrompt: async () => {
      calls += 1
      return undefined
    }
  })
  await ui.send('你好\r')
  await ui.waitFor((frame) => frame.includes('已完成'))
  await ui.waitFor(() => calls === 1)
  assert.doesNotMatch(ui.last(), /Tab 填入/)
})
