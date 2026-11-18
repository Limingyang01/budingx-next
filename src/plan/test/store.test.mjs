// SP004 T10 · 计划状态机、待办与执行前漂移校验（design §6.1、§6.3，AC TP-01/02/04/05/09）。
// 纯逻辑：无 IO、无进程；持久化属 T22。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN_MAX_STEPS } from '../../tui/dist/core/plan.js'
import {
  createPlanStore,
  createTodoStore,
  planEvidenceOf
} from '../../tui/dist/plan/store.js'
import { validateBeforeExecute } from '../../tui/dist/plan/validate.js'

function snapshotOf(overrides = {}) {
  return {
    root: '/repo',
    head: 'a'.repeat(40),
    files: { 'src/a.ts': 'digest-a', 'src/b.ts': 'digest-b' },
    version: 1,
    ...overrides
  }
}

function makeStore(extra = {}) {
  return createPlanStore({
    snapshot: () => snapshotOf(),
    now: () => 1000,
    ...extra
  })
}

test('T10-1 创建计划：步骤 pending、approval=none、稳定步骤 id', () => {
  const store = makeStore()
  assert.equal(store.current(), undefined)
  const plan = store.create('实现登录', [{ title: '读代码' }, { title: '写测试' }, { title: '实现' }])
  assert.equal(plan.goal, '实现登录')
  assert.equal(plan.approval, 'none')
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['step-1', 'step-2', 'step-3']
  )
  assert.ok(plan.steps.every((step) => step.status === 'pending'))
  assert.equal(plan.createdAt, 1000)
  assert.equal(plan.updatedAt, 1000)
  assert.equal(store.current()?.id, plan.id)
  // 超过 50 步拒绝。
  const tooMany = Array.from({ length: PLAN_MAX_STEPS + 1 }, (_, index) => ({ title: `步骤${index}` }))
  assert.throws(() => makeStore().create('超大计划', tooMany), /50|拆分/)
  // 上限本身允许。
  const exactly = Array.from({ length: PLAN_MAX_STEPS }, (_, index) => ({ title: `步骤${index}` }))
  assert.equal(makeStore().create('满上限', exactly).steps.length, PLAN_MAX_STEPS)
  // 空目标/空步骤拒绝。
  assert.throws(() => makeStore().create('   ', [{ title: 'x' }]), /目标/)
  assert.throws(() => makeStore().create('目标', []), /步骤/)
})

test('T10-2 更新步骤：状态与 blockedBy 生效，非法引用被拒绝', () => {
  let clock = 1000
  const store = createPlanStore({ snapshot: () => snapshotOf(), now: () => clock })
  store.create('目标', [{ title: 'A' }, { title: 'B' }, { title: 'C' }])
  clock = 2000
  const updated = store.update('step-1', { status: 'completed' })
  assert.equal(updated.steps[0].status, 'completed')
  assert.equal(updated.updatedAt, 2000)
  const blocked = store.update('step-3', { status: 'blocked', blockedBy: ['step-1', 'step-2'], note: '等待依赖' })
  assert.deepEqual(blocked.steps[2].blockedBy, ['step-1', 'step-2'])
  assert.equal(blocked.steps[2].note, '等待依赖')
  // 非法输入拒绝。
  assert.throws(() => store.update('step-9', { status: 'completed' }), /不存在|步骤/)
  assert.throws(() => store.update('step-1', { status: 'done' }), /状态/)
  assert.throws(() => store.update('step-1', { blockedBy: ['step-2', 'step-2'] }), /重复|blockedBy/)
  assert.throws(() => store.update('step-1', { blockedBy: ['step-1'] }), /自身|blockedBy/)
  assert.throws(() => store.update('step-1', { blockedBy: ['step-9'] }), /不存在|blockedBy/)
})

test('T10-3 requestApproval 进入 pending，且不存在执行入口', () => {
  const store = makeStore()
  store.create('目标', [{ title: 'A' }])
  const pending = store.requestApproval('# 计划\n- A')
  assert.equal(pending.approval, 'pending')
  // 计划存储只有审批状态机，不提供执行入口（TP-04）。
  assert.deepEqual(Object.keys(store).sort(), [
    'approve',
    'create',
    'current',
    'progress',
    'reject',
    'requestApproval',
    'update'
  ])
  // 未 request 直接 approve 拒绝；非 pending 状态再 request 也拒绝。
  const fresh = makeStore()
  fresh.create('目标', [{ title: 'A' }])
  assert.throws(() => fresh.approve(), /待批/)
  assert.throws(() => store.requestApproval('再次'), /待批/)
})

test('T10-4 approve 写入指纹与 approvedText；reject 记录原因；重复批准拒绝', () => {
  const store = makeStore()
  store.create('目标', [{ title: 'A' }, { title: 'B' }])
  store.requestApproval('# 原计划')
  const approved = store.approve('# 用户编辑后的计划')
  assert.equal(approved.approval, 'approved')
  assert.ok(typeof approved.fingerprint === 'string' && approved.fingerprint.length > 0)
  assert.equal(approved.approvedText, '# 用户编辑后的计划')
  assert.throws(() => store.approve(), /待批|已批/)

  const rejected = makeStore()
  rejected.create('目标', [{ title: 'A' }])
  rejected.requestApproval('# 计划')
  const plan = rejected.reject('步骤太大')
  assert.equal(plan.approval, 'rejected')
  assert.match(String(plan.approvedText ?? ''), /步骤太大/)
})

test('T10-5 progress 计数准确（TP-09）', () => {
  const store = makeStore()
  store.create('目标', [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }])
  store.update('step-1', { status: 'completed' })
  store.update('step-2', { status: 'in_progress' })
  store.update('step-3', { status: 'blocked' })
  assert.deepEqual(store.progress(), { total: 4, completed: 1, inProgress: 1, blocked: 1, pending: 1 })
})

test('T10-6 执行前漂移校验：稳定通过，文件/HEAD/计划版本/根变化均列出差异（TP-05）', () => {
  let clock = 1000
  const store = createPlanStore({ snapshot: () => snapshotOf(), now: () => clock })
  store.create('目标', [{ title: 'A' }])
  store.requestApproval('# 计划')
  const plan = store.approve()
  const ok = validateBeforeExecute(plan, snapshotOf())
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.drift, [])

  const headDrift = validateBeforeExecute(plan, snapshotOf({ head: 'b'.repeat(40) }))
  assert.equal(headDrift.ok, false)
  assert.ok(headDrift.drift.some((item) => item.item === 'head'))

  const fileDrift = validateBeforeExecute(plan, snapshotOf({ files: { 'src/a.ts': 'digest-changed', 'src/b.ts': 'digest-b' } }))
  assert.equal(fileDrift.ok, false)
  assert.ok(fileDrift.drift.some((item) => item.item.includes('src/a.ts')))

  const missingFile = validateBeforeExecute(plan, snapshotOf({ files: { 'src/b.ts': 'digest-b' } }))
  assert.equal(missingFile.ok, false)
  assert.ok(missingFile.drift.some((item) => item.item.includes('src/a.ts')))

  const rootDrift = validateBeforeExecute(plan, snapshotOf({ root: '/repo2' }))
  assert.equal(rootDrift.ok, false)
  assert.ok(rootDrift.drift.some((item) => item.item === 'root'))

  // 计划版本变化（批准后用户改了步骤）同样视为漂移，须回待审。
  clock = 2000
  store.update('step-1', { note: '批准后追加的说明' })
  const versionDrift = validateBeforeExecute(store.current(), snapshotOf())
  assert.equal(versionDrift.ok, false)
  assert.ok(versionDrift.drift.some((item) => item.item === 'version'))
})

test('T10-7 未批准或指纹缺失时执行入口拒绝；证据结构稳定', () => {
  const store = makeStore()
  store.create('目标', [{ title: 'A' }])
  const unapproved = validateBeforeExecute(store.current(), snapshotOf())
  assert.equal(unapproved.ok, false)
  assert.ok(unapproved.drift.some((item) => item.item === 'approval'))

  store.requestApproval('# 计划')
  const plan = store.approve()
  const evidence = planEvidenceOf(plan, snapshotOf({ version: plan.updatedAt }))
  assert.deepEqual(Object.keys(evidence).sort(), ['files', 'head', 'root', 'version'])
  assert.deepEqual(Object.keys(evidence.files), ['src/a.ts', 'src/b.ts'])
})

test('T10-8 待办存储：三字段校验、替换语义与进度（TodoWrite）', () => {
  const todos = createTodoStore()
  assert.deepEqual(todos.list(), [])
  assert.deepEqual(todos.progress(), { completed: 0, total: 0 })
  const written = todos.set([
    { content: '读代码', status: 'completed', activeForm: '读代码中' },
    { content: '写测试', status: 'in_progress', activeForm: '写测试中' },
    { content: '实现', status: 'pending', activeForm: '实现中' }
  ])
  assert.equal(written.length, 3)
  assert.deepEqual(todos.progress(), { completed: 1, total: 3 })
  // 替换语义：第二次 set 覆盖整个列表。
  const replaced = todos.set([{ content: '只剩一项', status: 'pending', activeForm: '处理中' }])
  assert.deepEqual(replaced.map((item) => item.content), ['只剩一项'])
  assert.deepEqual(todos.progress(), { completed: 0, total: 1 })
  // 空列表允许。
  assert.deepEqual(todos.set([]), [])
  // 非法输入拒绝。
  assert.throws(() => todos.set([{ content: '', status: 'pending', activeForm: 'x' }]), /内容|content/)
  assert.throws(() => todos.set([{ content: 'x', status: 'blocked', activeForm: 'y' }]), /状态/)
  assert.throws(() => todos.set([{ content: 'x', status: 'pending', activeForm: '' }]), /activeForm/)
})