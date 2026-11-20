import { Box, Text, type Key } from 'ink'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { PermissionRule } from '../workspace/policy.js'
import type { CommandContext } from './commands.js'

export type RulesManagerInput = {
  key: (text: string, key: Key) => void
  paste: (text: string) => void
}

/** 0.5.4：/rules 交互管理面板，参照 /models 的对话框交互。 */
export function RulesManager({ context, close, input }: {
  context: CommandContext
  close: (notice?: string) => void
  input: RefObject<RulesManagerInput | undefined>
}) {
  const permission = context.permission
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const [version, setVersion] = useState(0)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<'list' | 'add'>('list')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const rules = useMemo(() => permission?.policy.listRules() ?? [], [permission, version])
  const shadow = useMemo(
    () => new Map((permission?.policy.shadowed() ?? []).map((entry) => [entry.ruleId, entry.shadowedBy])),
    [permission, version]
  )
  const selected = Math.min(index, Math.max(0, rules.length - 1))

  const save = (next: PermissionRule[]): boolean => {
    if (!permission) return false
    try {
      permission.store.save({ schemaVersion: 1, rules: next })
      permission.policy.setRules(next)
      setVersion((value) => value + 1)
      setNotice(pick('规则已保存并生效', 'Rules saved and active'))
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'rule rejected')
      return false
    }
  }
  const add = (): void => {
    const [kind, tool, path] = draft.trim().split(/\s+/)
    if ((kind !== 'allow' && kind !== 'deny') || !tool) {
      setNotice(pick('用法：<allow|deny> <tool|*> [路径-glob]', 'Usage: <allow|deny> <tool|*> [path-glob]'))
      return
    }
    const rule: PermissionRule = {
      id: nextRuleId(rules),
      action: kind as 'allow' | 'deny',
      tool,
      ...(path ? { path } : {})
    }
    if (save([...rules, rule])) {
      setDraft('')
      setMode('list')
    }
  }
  const remove = (): void => {
    const target = rules[selected]
    if (!target) return
    if (save(rules.filter((rule) => rule.id !== target.id))) {
      setIndex((value) => Math.max(0, value - 1))
    }
  }

  useEffect(() => {
    input.current = {
      key: (text, key) => {
        if (key.escape) {
          if (mode === 'add') {
            setMode('list')
            setDraft('')
            return
          }
          close()
          return
        }
        if (mode === 'add') {
          if (key.return) {
            add()
            return
          }
          if (key.backspace || key.delete) {
            setDraft((value) => value.slice(0, -1))
            return
          }
          if (text && !key.ctrl) setDraft((value) => value + text)
          return
        }
        if (key.upArrow) {
          setIndex((value) => Math.max(0, value - 1))
          return
        }
        if (key.downArrow) {
          setIndex((value) => Math.min(Math.max(0, rules.length - 1), value + 1))
          return
        }
        if (text === 'a' || text === 'A') {
          setMode('add')
          setDraft('')
          setNotice('')
          return
        }
        if (text === 'd' || text === 'D' || key.delete) remove()
      },
      paste: (text) => {
        if (mode === 'add') setDraft((value) => value + text)
      }
    }
    return () => {
      input.current = undefined
    }
  }, [mode, rules, selected, draft, permission])

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('权限规则管理', 'Permission rules')}</Text>
      {rules.length === 0 && <Text dimColor>{pick('暂无权限规则', 'No permission rules yet')}</Text>}
      {rules.map((rule, i) => {
        const base = `${rule.id} ${rule.action} ${rule.tool}${rule.path ? ' ' + rule.path : ''}${rule.note ? ' — ' + rule.note : ''}`
        const by = shadow.get(rule.id)
        return (
          <Text key={rule.id} color={i === selected ? '#56b6c2' : undefined}>
            {i === selected ? '❯ ' : '  '}
            {by ? base + pick(`【被 ${by} 遮蔽】`, ` [shadowed by ${by}]`) : base}
          </Text>
        )
      })}
      {mode === 'add' && (
        <Box marginTop={1}>
          <Text color="#56b6c2">{pick('新增规则 › ', 'Add rule › ')}</Text>
          <Text>{draft}</Text>
          <Text dimColor>_</Text>
        </Box>
      )}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <Text dimColor>
        {mode === 'add'
          ? pick('Enter 保存 · Esc 返回', 'Enter save · Esc back')
          : pick('↑↓ 选择 · a 新增 · d 删除 · Esc 关闭', 'up/down · a add · d delete · Esc close')}
      </Text>
    </Box>
  )
}

function nextRuleId(rules: PermissionRule[]): string {
  let max = 0
  for (const rule of rules) {
    const match = /^r-(\d+)$/.exec(rule.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `r-${max + 1}`
}
