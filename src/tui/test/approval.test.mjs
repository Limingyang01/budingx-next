import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InkApprovalGateway } from '../dist/tui/approval.js'

const request = {
  requestId: 'r1',
  turnId: 't1',
  callId: 'c1',
  name: 'read_file',
  summary: 'read a.txt'
}

test('审批决策恰好生效一次，后续决策被忽略', async () => {
  const gateway = new InkApprovalGateway()
  const pending = gateway.request(request)
  assert.equal(gateway.pendingRequests.length, 1)
  assert.equal(gateway.resolve('r1', 'allow'), true)
  assert.equal(gateway.resolve('r1', 'deny'), false)
  const decision = await pending
  assert.equal(decision.outcome, 'allow')
  assert.equal(decision.via, 'user')
  assert.equal(gateway.pendingRequests.length, 0)
})

test('未知的审批 id 不会被处理', () => {
  const gateway = new InkApprovalGateway()
  assert.equal(gateway.resolve('missing', 'allow'), false)
})

test('取消会清空所有待决审批且不留残留', async () => {
  const gateway = new InkApprovalGateway()
  const first = gateway.request(request)
  const second = gateway.request({ ...request, requestId: 'r2' })
  assert.equal(gateway.pendingRequests.length, 2)
  gateway.cancelAll()
  assert.equal(gateway.pendingRequests.length, 0)
  assert.equal((await first).outcome, 'cancelled')
  assert.equal((await second).outcome, 'cancelled')
})
