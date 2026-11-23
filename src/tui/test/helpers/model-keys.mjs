import { setTimeout as wait } from 'node:timers/promises'

async function waitForFrame(ui, pattern) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (pattern.test(ui.last())) return
    await wait(20)
  }
  throw new Error('Expected ' + pattern + ' in the model manager. Last frame:\n' + ui.last())
}

export async function openModels(ui) {
  await ui.send('/models')
  await ui.send('\r')
}

export async function addCustomModel(ui, { label, baseUrl, model, key = '', use = false }) {
  await openModels(ui)
  await waitForFrame(ui, /模型管理|Model management/)
  await ui.send('n')
  await waitForFrame(ui, /选择供应商|Choose provider/)
  await ui.send('\x1b[F')
  await waitForFrame(ui, />\s*Custom/)
  await ui.send('\r')
  await waitForFrame(ui, />\s*(API 端点|API endpoint)/)
  await ui.send(baseUrl)
  await ui.send('\r')
  await waitForFrame(ui, />\s*Model ID/)
  await ui.send(model)
  await ui.send('\r')
  await waitForFrame(ui, />\s*(名称|Label)/)
  if (label) await ui.send(label)
  await ui.send('\r')
  await waitForFrame(ui, />\s*API Key/)
  if (key) {
    await ui.send(key)
    await waitForFrame(ui, /已输入（隐藏）|Entered \(hidden\)/)
  }
  // 表单字段会随能力扩展增加（如 SP009 的上下文窗口），按目标标签逐格前进，
  // 不写死跳格次数，避免新增字段后导航错位。
  const target = use ? />\s*(保存并使用|Save and use)/ : />\s*(保存|Save)(?!并使用| and use)/
  for (let i = 0; i < 12 && !target.test(ui.last()); i++) await ui.send('\t')
  await waitForFrame(ui, target)
  await ui.send('\r')
  await waitForFrame(ui, use ? /已保存并切换模型|Model saved and selected/ : /模型档案已保存|Model profile saved/)
  if (!use) await ui.send('\x1b')
}
