// SP004 T22 · 计划持久化、审批正文与追问多题（design §6.1/§6.2/§6.4，AC TP-04/TP-06/TP-10）。
// 真实文件 IO：计划落盘到会话隔离目录，读回与内存结构一致；用户编辑正文参与指纹。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateQuestions } from '../../tui/dist/core/plan.js'
import { createPlanStore, planFingerprintOf } from '../../tui/dist/plan/store.js'
import { parsePlan, planFilePath, serializePlan } from '../../tui/dist/plan/serialize.js'

function snapshotOf(overrides = {}) {
  return {
    root: '/repo',
    head: 'a'.repeat(40),
    files: { 'src/app.mjs': 'digest-app' },
    ...overrides
  }
}

function makeDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-plan-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  return dir
}

function makeStore(extra = {}) {
  return createPlanStore({
    snapshot: () => snapshotOf(),
    now: () => 1000,
    ...extra
  })
}

const PLAN_TEXT = '# 计划\n\n1. 修改 src/app.mjs\n2. 运行测试\n'

test('T22-1 计划序列化为 Markdown + frontmatter，解析后与内存结构一致', () => {
  const store = makeStore({ id: () => 'plan-1' })
  const plan = store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }, { title: '运行测试' }])
  store.update('step-1', { status: 'in_progress', note: '先读代码' })
  store.update('step-2', { blockedBy: ['step-1'] })
  store.requestApproval(PLAN_TEXT)
  store.approve('# 计划（用户编辑）\n\n1. 修改 src/app.mjs\n2. 运行测试\n')

  const text = serializePlan(plan)
  assert.ok(text.startsWith('---\n'), 'frontmatter 必须以 --- 开头')
  assert.ok(text.includes('\n---\n'), 'frontmatter 必须有结束分隔线')
  assert.ok(text.includes('# 修复 add 的失败测试'), '正文必须含计划目标标题')
  assert.ok(text.includes('修改 src/app.mjs'), '正文必须含步骤标题')

  const parsed = parsePlan(text)
  assert.deepEqual(parsed, plan)
  assert.equal(parsed.approval, 'approved')
  assert.equal(parsed.approvedText, '# 计划（用户编辑）\n\n1. 修改 src/app.mjs\n2. 运行测试\n')
  assert.deepEqual(parsed.steps[1].blockedBy, ['step-1'])
  assert.equal(parsed.steps[0].note, '先读代码')
})

test('T22-2 计划路径位于用户数据根的会话隔离目录，不与项目目录混用', () => {
  const home = join(tmpdir(), 'budingx-home-fixture')
  assert.equal(
    planFilePath('sess-1', 'plan-1', home),
    join(home, '.budingx', 'plans', 'sess-1', 'plan-1.md')
  )
  assert.notEqual(planFilePath('sess-1', 'plan-1', home), planFilePath('sess-2', 'plan-1', home))
  assert.equal(planFilePath('sess-1', 'plan-1'), join(homedir(), '.budingx', 'plans', 'sess-1', 'plan-1.md'))
})

test('T22-3 创建计划即落盘，读回内容与内存结构一致（TP-10）', (t) => {
  const dir = makeDir(t)
  const filePath = join(dir, 'plans', 'sess-1', 'plan-1.md')
  const store = makeStore({ id: () => 'plan-1', filePath })
  const plan = store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }, { title: '运行测试' }])

  assert.ok(existsSync(filePath), '创建计划后必须写入计划文件')
  const parsed = parsePlan(readFileSync(filePath, 'utf8'))
  assert.deepEqual(parsed, plan)
  assert.equal(parsed.id, 'plan-1')
})

test('T22-4 批准携带用户编辑正文：approvedText 落盘且指纹按当前版本重算（TP-04）', (t) => {
  const dir = makeDir(t)
  const filePath = join(dir, 'plans', 'sess-1', 'plan-1.md')
  const store = makeStore({ id: () => 'plan-1', filePath })
  store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }])
  store.requestApproval(PLAN_TEXT)
  const edited = '# 计划（用户编辑）\n\n1. 先补测试，再修改 src/app.mjs\n'
  const approved = store.approve(edited)

  assert.equal(approved.approvedText, edited)
  assert.equal(approved.fingerprint, planFingerprintOf({ updatedAt: approved.updatedAt }, snapshotOf()))

  const persisted = parsePlan(readFileSync(filePath, 'utf8'))
  assert.equal(persisted.approval, 'approved')
  assert.equal(persisted.approvedText, edited)
  assert.equal(persisted.fingerprint, approved.fingerprint)
})

test('T22-5 拒绝携带反馈：反馈随计划落盘，重载后仍可回灌', (t) => {
  const dir = makeDir(t)
  const filePath = join(dir, 'plans', 'sess-1', 'plan-1.md')
  const store = makeStore({ id: () => 'plan-1', filePath })
  store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }])
  store.requestApproval(PLAN_TEXT)
  store.reject('先补测试再动 src/app.mjs')

  const persisted = parsePlan(readFileSync(filePath, 'utf8'))
  assert.equal(persisted.approval, 'rejected')
  assert.match(persisted.approvedText, /先补测试再动 src\/app\.mjs/)

  const reopened = makeStore({ id: () => 'plan-1', filePath })
  assert.equal(reopened.current().approval, 'rejected')
  assert.match(reopened.current().approvedText, /先补测试再动 src\/app\.mjs/)
})

test('T22-6 同一路径重开计划存储可读回计划；文件缺失视为无计划且不凭空创建（TP-10）', (t) => {
  const dir = makeDir(t)
  const filePath = join(dir, 'plans', 'sess-1', 'plan-1.md')
  const store = makeStore({ id: () => 'plan-1', filePath })
  const plan = store.create('实现登录', [{ title: '读代码' }])
  store.update('step-1', { status: 'completed' })

  const reopened = makeStore({ id: () => 'plan-1', filePath })
  assert.deepEqual(reopened.current(), plan)
  assert.equal(reopened.current().steps[0].status, 'completed')
  assert.deepEqual(reopened.progress(), { total: 1, completed: 1, inProgress: 0, blocked: 0, pending: 0 })

  const missingPath = join(dir, 'plans', 'sess-1', 'plan-2.md')
  const empty = makeStore({ filePath: missingPath })
  assert.equal(empty.current(), undefined)
  assert.equal(existsSync(missingPath), false, '没有计划时不得创建空计划文件')
})

test('T22-7 计划文件损坏或格式不合法时明确报错，不静默丢弃', (t) => {
  const dir = makeDir(t)
  const filePath = join(dir, 'plans', 'sess-1', 'plan-1.md')
  mkdirSync(join(dir, 'plans', 'sess-1'), { recursive: true })
  writeFileSync(filePath, '这不是计划文件\n')
  assert.throws(() => parsePlan('这不是计划文件\n'), /frontmatter/)
  assert.throws(() => makeStore({ filePath }), /frontmatter/)

  writeFileSync(filePath, '---\nid: plan-1\n---\n# 缺字段\n')
  assert.throws(() => parsePlan(readFileSync(filePath, 'utf8')), /goal|目标/)
})

test('T22-8 追问多题：1–4 题、每题 2–4 选项（TP-06）', () => {
  const option = (label) => ({ label, description: `${label} 的说明` })
  const question = (index, count = 2) => ({
    question: `第 ${index} 个问题？`,
    header: `问题${index}`,
    options: Array.from({ length: count }, (_, i) => option(`选项${i + 1}`))
  })

  assert.equal(validateQuestions({ questions: [] }).ok, false)
  assert.match(validateQuestions({ questions: [] }).reason, /1–4/)
  assert.equal(validateQuestions({ questions: [1, 2, 3, 4, 5].map((i) => question(i)) }).ok, false)
  assert.match(validateQuestions({ questions: [1, 2, 3, 4, 5].map((i) => question(i)) }).reason, /1–4/)
  assert.equal(validateQuestions({ questions: [question(1, 1)] }).ok, false)
  assert.match(validateQuestions({ questions: [question(1, 1)] }).reason, /2–4/)

  const valid = validateQuestions({ questions: [1, 2, 3, 4].map((i) => question(i, 4)) })
  assert.equal(valid.ok, true)
  assert.equal(valid.questions.length, 4)
  assert.equal(valid.questions[0].options.length, 4)
})