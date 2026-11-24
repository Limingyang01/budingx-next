// SP010 T2：取消恢复（CAN）整题评分。
// 一个 CAN 题次包含两个回合：先取消，再从产品恢复入口续跑。
// 两个回合共用一次题目预算，整题只计一次结论。
// 判定只依据可观察事实：回合终态、恢复回执、返回历史中的首回合消息、独立副作用计数。

/**
 * @typedef {object} CanEvidence
 * @property {{ id?: string, outcome?: string } | undefined} firstTurn 首个回合（应为 cancelled）
 * @property {{ id?: string, outcome?: string } | undefined} secondTurn 恢复后的回合（应为 completed）
 * @property {number} sideEffectCount 独立观察到的目标副作用总次数
 * @property {{ ok?: boolean, sessionId?: string, messages?: unknown[] } | undefined} resumeReceipt 恢复入口回执
 * @property {string} expectedSessionId 取消前登记的会话 ID
 * @property {string} expectedMessageId 取消前登记的首回合消息 ID
 * @property {string} expectedMarker 取消前登记的首回合内容标记
 * @property {boolean} assertionsPassed 剩余任务断言是否通过
 * @property {string | undefined} budgetExceeded 触发的预算资源
 * @property {string[]} missingEvidence 缺失的证据项（基础设施缺证）
 */

/** 首回合历史条目是否同时命中消息 ID 与内容标记。 */
function matchesFirstTurn(messages, messageId, marker) {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    if (!message || typeof message !== 'object') return false
    if (message.id !== messageId) return false
    return containsMarker(message, marker)
  })
}

/** 消息正文中是否含有该题次独有的合成内容标记。 */
function containsMarker(message, marker) {
  if (typeof message === 'string') return message.includes(marker)
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  return blocks.some((block) => {
    if (!block || typeof block !== 'object') return false
    return typeof block.text === 'string' && block.text.includes(marker)
  })
}

/**
 * 给出 CAN 整题评分。
 * 返回 { status, failureClass, reasons }：
 * - passed：整题通过
 * - failed：判定不通过（含预算终止）
 * - unverified：基础设施缺证，无法判定
 */
export function scoreCanTask(evidence) {
  const reasons = []
  const missing = Array.isArray(evidence.missingEvidence) ? evidence.missingEvidence : []

  if (evidence.budgetExceeded) {
    return {
      status: 'failed',
      failureClass: 'BUDGET',
      reasons: ['预算终止：' + evidence.budgetExceeded]
    }
  }
  if (missing.length > 0) {
    return { status: 'unverified', failureClass: undefined, reasons: ['缺少证据：' + missing.join('、')] }
  }

  const first = evidence.firstTurn
  const second = evidence.secondTurn
  if (!first) {
    reasons.push('缺少首个回合的终态记录')
  } else if (first.outcome !== 'cancelled') {
    reasons.push('首个回合终态应为 cancelled，实际 ' + first.outcome)
  }
  if (!second) {
    reasons.push('缺少恢复回合的终态记录')
  } else if (second.outcome !== 'completed') {
    reasons.push('恢复回合终态应为 completed，实际 ' + second.outcome)
  }
  if (first?.id && second?.id && first.id === second.id) {
    reasons.push('恢复后必须是新的回合，实际回合 ID 未变')
  }

  const receipt = evidence.resumeReceipt
  if (evidence.resumeSkipped) {
    reasons.push('未通过产品恢复入口即继续提交回合')
  } else if (!receipt) {
    reasons.push('缺少恢复入口回执')
  } else {
    if (receipt.ok !== true) reasons.push('恢复入口回执未成功')
    if (receipt.sessionId !== evidence.expectedSessionId) {
      reasons.push(
        '恢复入口返回的 sessionId 与原会话不一致：' + receipt.sessionId + ' ≠ ' + evidence.expectedSessionId
      )
    }
    if (!matchesFirstTurn(receipt.messages, evidence.expectedMessageId, evidence.expectedMarker)) {
      reasons.push('恢复入口返回的历史中找不到匹配首回合消息 ID 与内容标记的条目')
    }
  }

  if (evidence.sideEffectCount !== 1) {
    reasons.push('目标副作用总次数应为 1，实际 ' + evidence.sideEffectCount)
  }
  if (evidence.assertionsPassed !== true) {
    reasons.push('恢复后的剩余任务断言未通过')
  }

  if (reasons.length > 0) {
    return { status: 'failed', failureClass: 'assertion', reasons }
  }
  return { status: 'passed', failureClass: undefined, reasons: [] }
}

/** 脱敏后的证据摘要：只保留判定需要的字段，不落盘消息正文。 */
export function summarizeCanEvidence(evidence) {
  const receipt = evidence.resumeReceipt
  return {
    sessionId: evidence.expectedSessionId,
    firstTurn: evidence.firstTurn ? { id: evidence.firstTurn.id, outcome: evidence.firstTurn.outcome } : undefined,
    secondTurn: evidence.secondTurn ? { id: evidence.secondTurn.id, outcome: evidence.secondTurn.outcome } : undefined,
    sideEffectCount: evidence.sideEffectCount,
    resumeOk: receipt?.ok === true,
    resumeSkipped: evidence.resumeSkipped === true,
    resumeSessionMatches: receipt?.sessionId === evidence.expectedSessionId,
    firstTurnMessageMatched:
      receipt?.ok === true &&
      matchesFirstTurn(receipt.messages, evidence.expectedMessageId, evidence.expectedMarker),
    assertionsPassed: evidence.assertionsPassed === true,
    budgetExceeded: evidence.budgetExceeded,
    missingEvidence: evidence.missingEvidence ?? []
  }
}
