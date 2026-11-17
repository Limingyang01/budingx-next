// Tool call assembly (SP002 AC PS-02). Lives in Core because Core owns the
// tool call contract and must not import the provider module.
import { ERROR_CODES } from './constants.js'
import type { ToolCall, ToolCallError, ToolFragment } from './provider.js'

/**
 * Merge streaming tool call fragments into complete calls.
 * - fragments carry an optional `index`; continuation fragments without an
 *   index attach to the call that is currently open (never dropped);
 * - a fragment without an index but with a new call id starts a new slot.
 */
export function assembleToolCalls(
  fragments: ToolFragment[],
  retainInvalid = false
): {
  calls: ToolCall[]
  errors: ToolCallError[]
} {
  type Slot = { id: string; name: string; args: string }
  const slots = new Map<number, Slot>()
  const order: number[] = []
  let next = 0
  let last = -1

  for (const fragment of fragments) {
    const hasIndex =
      fragment.index !== undefined &&
      Number.isInteger(fragment.index) &&
      fragment.index >= 0
    let index: number
    if (hasIndex) {
      index = fragment.index as number
      next = Math.max(next, index + 1)
    } else if (!fragment.callId && last !== -1) {
      index = last
    } else {
      index = next++
    }
    let slot = slots.get(index)
    if (!slot) {
      slot = { id: '', name: '', args: '' }
      slots.set(index, slot)
      order.push(index)
    }
    last = index
    if (fragment.callId) slot.id += fragment.callId
    if (fragment.nameDelta) slot.name += fragment.nameDelta
    if (fragment.argsDelta) slot.args += fragment.argsDelta
  }

  const calls: ToolCall[] = []
  const errors: ToolCallError[] = []
  for (const index of order.sort((a, b) => a - b)) {
    const slot = slots.get(index) as Slot
    if (!slot.name) {
      errors.push({
        index,
        code: ERROR_CODES.providerToolCallIncomplete,
        message: 'Tool call is missing a function name'
      })
      continue
    }
    if (!slot.id) {
      errors.push({
        index,
        code: ERROR_CODES.providerToolCallIncomplete,
        message: 'Tool call is missing an id'
      })
      continue
    }
    try {
      JSON.parse(slot.args || '{}')
    } catch {
      errors.push({
        index,
        code: ERROR_CODES.providerToolArgumentsInvalid,
        message: 'Tool call arguments are not valid JSON'
      })
      if (retainInvalid)
        calls.push({ index, id: slot.id, name: slot.name, arguments: slot.args })
      continue
    }
    calls.push({ index, id: slot.id, name: slot.name, arguments: slot.args })
  }
  return { calls, errors }
}

export function parseToolArguments(call: ToolCall): unknown {
  try {
    return JSON.parse(call.arguments || '{}')
  } catch {
    return {}
  }
}
