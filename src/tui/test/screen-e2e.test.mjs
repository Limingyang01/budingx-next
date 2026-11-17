// Screen-class end-to-end regressions (pseudo-TTY harness).
// These are the bugs that previously required a human to launch the TUI and
// send a screenshot: first-screen content/wording/geometry, model name shown
// after configuration and after /model, ASCII fallback, streaming CJK frames,
// interrupt/queue/exit visibility, resize reflow.
// Evidence layer: in-process real Ink + real Session; provider is an async-gen
// fixture (UI-flow layer). Provider wire contract lives in provider tests.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import stringWidth from 'string-width'
import { mountTty, frameWidths } from './helpers/mount-tty.mjs'
import { createProfile } from '../dist/storage/profiles.js'

const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

function gatedStream(chunks) {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  return {
    release,
    provider: {
      async *stream() {
        for (const chunk of chunks) {
          if (chunk === '@gate') await gate
          else yield chunk
        }
      }
    }
  }
}

const done = { type: 'message_completed', finishReason: 'stop' }

test('S1 未配置首屏：中文欢迎框、几何不越界、配置引导、无密钥痕迹', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    }
  })
  const frame = ui.last()
  assert.match(frame, /欢迎使用 budingx/)
  assert.match(frame, /快速上手/)
  assert.match(frame, /模型：未配置/)
  assert.match(frame, /尚未配置 · 运行 \/provider add/)
  assert.match(frame, /╭/)
  assert.match(frame, /╯/)
  assert.ok(frameWidths(frame, stringWidth).every((wd) => wd <= 100))
  assert.ok(!ui.raw().includes('sk-'))
})

test('S2 配置完成后精简横幅显示真实模型名与端点主机', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    },
    config: {
      model: 'model-x',
      apiKey: 'fixture-key',
      baseUrl: 'https://api.example.test/v1'
    }
  })
  const frame = ui.last()
  assert.match(frame, /model-x · api\.example\.test/)
  assert.match(frame, /budingx v0\.1\.1/)
  assert.ok(!frame.includes('╭'), '配置后不应再显示欢迎框')
})

test('S3 /model 切换后首屏模型行即时更新', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    },
    config: {
      model: 'm-one',
      apiKey: 'fixture-key',
      baseUrl: 'https://api.example.test/v1'
    }
  })
  const stored = ui.configStore.load()
  const second = createProfile({
    label: 'two',
    baseUrl: 'https://api.example.test/v1',
    model: 'm-two'
  })
  stored.models.push(second)
  ui.configStore.save(stored)
  await ui.send('/model two\r')
  await ui.waitFor((frame) => /m-two · api\.example\.test/.test(frame))
})

test('S4 老终端 ASCII 兜底：整帧纯 ASCII 且含 ASCII 吉祥物', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    },
    strategy: 'ascii'
  })
  const frame = ui.last()
  assert.ok(/^[\x20-\x7e\n]*$/.test(frame), 'ASCII 兜底帧不得含 Unicode 框线/块字符/中文')
  assert.match(frame, /\( o\.o \)/)
  assert.match(frame, /Welcome to budingx/)
})

test('S5 流式中文增量渲染与状态行迁移', async (t) => {
  const { release, provider } = gatedStream([
    { type: 'text_delta', text: '你好' },
    '@gate',
    { type: 'text_delta', text: '，世界' },
    done
  ])
  const ui = await mountTty(t, {
    provider,
    config: { model: 'm', apiKey: 'k', baseUrl: 'https://api.example.test/v1' }
  })
  ui.session.submit('hi')
  await ui.waitFor((frame) => frame.includes('你好') && /流式输出中/.test(frame))
  release()
  await ui.waitFor((frame) => frame.includes('你好，世界') && /就绪/.test(frame))
  assert.ok(
    ui.frames().some((frame) => frame.includes('你好') && !frame.includes('你好，世界')),
    '必须存在只含部分增量的中间帧'
  )
})

test('S6 执行中 Esc：打断提示可见、部分输出保留、会话回到空闲', async (t) => {
  const { release, provider } = gatedStream([
    { type: 'text_delta', text: '部分输出' },
    '@gate',
    done
  ])
  const ui = await mountTty(t, {
    provider,
    config: { model: 'm', apiKey: 'k', baseUrl: 'https://api.example.test/v1' }
  })
  ui.session.submit('hi')
  await ui.waitFor((frame) => /流式输出中/.test(frame))
  await ui.send('\x1b')
  await ui.waitFor((frame) => /已请求打断|取消中/.test(frame))
  release()
  await ui.waitFor(() => !ui.session.isBusy)
  assert.match(ui.last(), /部分输出/)
})

test('S7 忙时追加输入：排队指示可见且回合结束后自动注入', async (t) => {
  let turns = 0
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        turns++
        if (turns === 1) await gate
        yield { type: 'text_delta', text: turns === 1 ? 'one' : 'two' }
        yield done
      }
    },
    config: { model: 'm', apiKey: 'k', baseUrl: 'https://api.example.test/v1' }
  })
  ui.session.submit('first')
  await ui.waitFor((frame) => /流式输出中|请求中/.test(frame))
  await ui.send('second\r')
  await ui.waitFor((frame) => /排队/.test(frame))
  release()
  await ui.waitFor((frame) => frame.includes('two') && !/排队/.test(frame))
  assert.equal(turns, 2)
})

test('S8 空闲 Ctrl+C 单按提示、双按退出', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    }
  })
  await ui.send('\x03')
  await ui.waitFor((frame) => /再按一次 Ctrl\+C 退出/.test(frame))
  assert.equal(ui.exitCalls.length, 0)
  await ui.send('\x03')
  await pause()
  assert.ok(ui.exitCalls.includes('app'))
})

test('S9 resize 到窄屏：欢迎框改紧凑且几何不越界', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    }
  })
  await ui.resize(40)
  const frame = await ui.waitFor((f) => f.includes('欢迎使用 budingx'))
  assert.ok(frameWidths(frame, stringWidth).every((wd) => wd <= 40))
  assert.ok(!frame.includes('│ Tips'), '窄屏不应保留双栏分隔')
})

test('S10 clear 同时清除模型上下文和可见会话内容', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield { type: 'text_delta', text: 'fixture-old-answer' }
        yield done
      }
    },
    config: { model: 'm', apiKey: 'fixture-key' }
  })
  await ui.send('hello\r')
  await ui.waitFor((frame) => frame.includes('fixture-old-answer') && !ui.session.isBusy)
  await ui.send('/clear\r')
  await ui.waitFor((frame) => frame.includes('会话已清空'))
  assert.equal(ui.session.history.length, 0)
  assert.doesNotMatch(ui.last(), /fixture-old-answer/)
})

test('S11 首屏品牌色保留 truecolor ANSI', async (t) => {
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield done
      }
    }
  })
  assert.ok(
    ui.raw().includes('38;2;175;135;255'),
    'brand purple must be emitted as truecolor'
  )
})
test('S12 完成后的长回答随宽度缩小和放大重排且不丢字', async (t) => {
  const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(3)
  const ui = await mountTty(t, {
    provider: {
      async *stream() {
        yield { type: 'text_delta', text }
        yield done
      }
    },
    config: { model: 'm', apiKey: 'fixture-key' },
    columns: 100
  })
  await ui.send('hello\r')
  await ui.waitFor((frame) => frame.includes(text) && !ui.session.isBusy)
  await ui.resize(30)
  const narrow = ui.last()
  assert.ok(frameWidths(narrow, stringWidth).every((w) => w <= 30))
  assert.ok(!narrow.includes(text), 'narrow frame wraps answer')
  await ui.resize(100)
  await ui.waitFor((frame) => frame.includes(text))
})
