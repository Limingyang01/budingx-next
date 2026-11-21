// SP007 §4.5：断言求值。
// 断言只依据可观测事实（终态、事件、文件、退出码、请求计数），不以模型自报为准。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchesAny } from './util.mjs'

/**
 * 求值单条断言。
 * ctx: { events, toolNames, changed, workspaceDir, state, result, run }
 */
export function evaluateCheck(check, ctx) {
  const kind = check.kind
  switch (kind) {
    case 'outcome':
      return result(
        ctx.result.outcome === check.outcome,
        '终态应为 ' + check.outcome + '，实际 ' + ctx.result.outcome,
        'outcome'
      )
    case 'error':
      return result(
        matchesError(ctx.result.error, check),
        '错误信息不匹配：' + JSON.stringify(ctx.result.error ?? null),
        'error'
      )
    case 'notice':
      return result(
        ctx.events.some(
          (event) => event.type === 'notice' && event.code === check.code
        ),
        '缺少 notice：' + check.code,
        'notice'
      )
    case 'event':
      return result(
        ctx.events.filter((event) => event.type === check.type).length >= (check.min ?? 1),
        '缺少事件：' + check.type,
        'event'
      )
    case 'tool_called':
      return result(
        ctx.events.filter(
          (event) =>
            event.type === 'tool_call_completed' &&
            (check.name ? event.name === check.name : true)
        ).length >= (check.min ?? 1),
        '工具未被调用：' + (check.name ?? '*'),
        'tool_called'
      )
    case 'tool_result': {
      const matches = ctx.toolResults.filter((item) => {
        if (check.name && item.name !== check.name) return false
        if (check.isError !== undefined && item.isError !== check.isError) return false
        if (check.contains && !item.content.includes(check.contains)) return false
        return true
      })
      return result(
        matches.length >= (check.min ?? 1),
        '工具结果不满足断言：' + JSON.stringify(check),
        'tool_result'
      )
    }
    case 'denial':
      return result(
        ctx.events.some(
          (event) =>
            event.type === 'denial_recorded' &&
            (check.tool ? event.denial.tool === check.tool : true)
        ),
        '缺少拒绝记录：' + (check.tool ?? '*'),
        'denial'
      )
    case 'file_exists': {
      const path = join(ctx.workspaceDir, check.path)
      const ok = existsSync(path)
      const content = ok ? readFileSync(path, 'utf8') : ''
      return result(
        ok && (check.contains ? content.includes(check.contains) : true),
        '文件缺失或不符：' + check.path,
        'file_exists'
      )
    }
    case 'file_content': {
      const path = join(ctx.workspaceDir, check.path)
      const content = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (content === null) {
        return result(false, '文件缺失：' + check.path, 'file_content')
      }
      if (check.equals !== undefined && content !== check.equals) {
        return result(false, '文件内容不等于期望：' + check.path, 'file_content')
      }
      if (check.contains && !content.includes(check.contains)) {
        return result(false, '文件内容不含期望片段：' + check.path, 'file_content')
      }
      if (check.not_contains && content.includes(check.not_contains)) {
        return result(false, '文件内容含禁止片段：' + check.path, 'file_content')
      }
      return result(true, '文件内容符合断言：' + check.path, 'file_content')
    }
    case 'request_tools': {
      const request = ctx.state.requests?.[check.index]
      const names = (request?.tools ?? []).map((tool) => tool.name)
      if (check.includes && !check.includes.every((name) => names.includes(name))) {
        return result(false, '第 ' + check.index + ' 次请求缺少工具：' + JSON.stringify(names), 'request_tools')
      }
      if (check.excludes && check.excludes.some((name) => names.includes(name))) {
        return result(false, '第 ' + check.index + ' 次请求含被隐藏工具：' + JSON.stringify(names), 'request_tools')
      }
      return result(true, '第 ' + check.index + ' 次请求工具集符合断言', 'request_tools')
    }
    case 'request_images': {
      const request = ctx.state.requests?.[check.index]
      const hasImage = hasImagePart(request)
      return result(
        hasImage === check.equals,
        '第 ' + check.index + ' 次请求图片标记为 ' + hasImage + '，期望 ' + check.equals,
        'request_images'
      )
    }
    case 'notification':
      return result(
        ctx.events.filter((event) => event.type === 'input_injected' && event.notification).length >= (check.min ?? 1),
        '缺少后台子代理通知事件',
        'notification'
      )
    case 'file_absent':
      return result(
        !existsSync(join(ctx.workspaceDir, check.path)),
        '文件不应存在：' + check.path,
        'file_absent'
      )
    case 'scope':
      return result(
        evaluateScope(check, ctx.changed),
        '改动越界：' + JSON.stringify(ctx.changed),
        'scope'
      )
    case 'request_count':
      return result(
        ctx.result.requestCount >= (check.min ?? 0) &&
          ctx.result.requestCount <= (check.max ?? Number.MAX_SAFE_INTEGER),
        '请求数越界：' + ctx.result.requestCount,
        'request_count'
      )
    case 'budget_exceeded':
      return result(
        ctx.result.budgetExceeded === check.resource,
        '预算未按预期触发：' + JSON.stringify(ctx.result.budgetExceeded),
        'budget_exceeded'
      )
    case 'agent': {
      const agents = ctx.state.agents ?? []
      const matched = agents.filter(
        (agent) =>
          (!check.state || agent.state === check.state) &&
          (!check.agentType || agent.agentType === check.agentType)
      )
      return result(
        matched.length >= (check.min ?? 1),
        '子代理状态不匹配：' + JSON.stringify(agents),
        'agent'
      )
    }
    case 'state':
      return result(
        deepEqual(resolvePath(ctx.state, check.key), check.equals),
        '状态不匹配：' + check.key + ' = ' + JSON.stringify(resolvePath(ctx.state, check.key)),
        'state'
      )
    case 'command':
      return result(
        ctx.result.commandExitCode === check.code,
        '命令退出码应为 ' + check.code + '，实际 ' + ctx.result.commandExitCode,
        'command'
      )
    case 'stdout':
      return result(
        (ctx.result.commandOutput ?? '').includes(check.contains),
        '命令输出不含期望内容',
        'stdout'
      )
    default:
      return result(false, '未知断言类型：' + kind, 'unknown')
  }
}

/** 求值一组断言。 */
export function evaluateChecks(checks, ctx) {
  return checks.map((check) => evaluateCheck(check, ctx))
}

function evaluateScope(check, changed) {
  const touched = [...changed.added, ...changed.modified, ...changed.removed]
  if (check.deny && touched.some((file) => matchesAny(file, check.deny))) return false
  if (check.allow && touched.length > 0) {
    return touched.every((file) => matchesAny(file, check.allow))
  }
  return true
}

function matchesError(error, check) {
  if (!error) return false
  if (check.class && error.class !== check.class) return false
  if (check.code && error.code !== check.code) return false
  if (check.message_contains && !String(error.message).includes(check.message_contains)) {
    return false
  }
  return true
}

/** 点号路径取值（ctx.state.requests.0 之类）。 */
function resolvePath(source, key) {
  if (!key) return undefined
  let current = source
  for (const part of String(key).split('.')) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}

/** 请求消息里是否带图片块。 */
function hasImagePart(request) {
  const messages = request?.messages ?? []
  return messages.some((message) => {
    const content = message?.content
    if (!Array.isArray(content)) return false
    return content.some((part) => part?.type === 'image_url')
  })
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function result(ok, message, kind) {
  return { ok, message, kind }
}
