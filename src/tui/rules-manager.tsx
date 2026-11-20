import { Box, Text, type Key } from 'ink'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { PermissionRule } from '../workspace/policy.js'
import type { CommandContext } from './commands.js'

export type RulesManagerInput = {
  key: (text: string, key: Key) => void
  paste: (text: string) => void
}

type TabType = 'recent' | 'allow' | 'ask' | 'deny' | 'workspace'
const TABS: TabType[] = ['recent', 'allow', 'ask', 'deny', 'workspace']

/** 0.5.4 /permissions：参照参考仓的分页规则面板（最近拒绝/允许/询问/拒绝/工作区 + 搜索 + 增删）。独立实现。 */
export function RulesManager({ context, close, input }: {
  context: CommandContext
  close: (notice?: string) => void
  input: RefObject<RulesManagerInput | undefined>
}) {
  const permission = context.permission
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const [version, setVersion] = useState(0)
  const [tab, setTab] = useState<TabType>('allow')
  const [index, setIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')

  const rules = useMemo(() => permission?.policy.listRules() ?? [], [permission, version])
  const denials = useMemo(() => permission?.denials() ?? [], [permission, version])
  const mode = permission?.policy.getMode() ?? 'read_only'

  const askTools = useMemo(() => {
    if (!permission) return [] as { tool: string; capability: string }[]
    const probes: { tool: string; capability: 'read' | 'write' | 'execute' | 'network' }[] = [
      { tool: 'Read', capability: 'read' }, { tool: 'Glob', capability: 'read' }, { tool: 'Grep', capability: 'read' },
      { tool: 'Write', capability: 'write' }, { tool: 'Edit', capability: 'write' },
      { tool: 'Bash', capability: 'execute' }, { tool: 'WebSearch', capability: 'network' }
    ]
    return probes.filter((probe) => permission.policy.decide({ tool: probe.tool, capability: probe.capability }).action === 'ask')
  }, [permission, version, mode])

  const matches = (text: string) => !search || text.toLowerCase().includes(search.toLowerCase())
  const rows = useMemo(() => {
    if (tab === 'allow') return rules.filter((r) => r.action === 'allow').map((r) => ({ id: r.id, label: `${r.tool}${r.path ? ' ' + r.path : ''}`, rule: r }))
    if (tab === 'deny') return rules.filter((r) => r.action === 'deny').map((r) => ({ id: r.id, label: `${r.tool}${r.path ? ' ' + r.path : ''}`, rule: r }))
    if (tab === 'ask') return askTools.map((t) => ({ id: t.tool, label: `${t.tool} (${t.capability})` }))
    if (tab === 'recent') return denials.map((d, i) => ({ id: String(i), label: `${d.tool}${d.path ? ' ' + d.path : ''} — ${d.reason}` }))
    return []
  }, [tab, rules, askTools, denials, search])
  const visible = rows.filter((row) => matches(row.label))
  const selected = Math.min(index, Math.max(0, visible.length - 1))

  const save = (next: PermissionRule[]): boolean => {
    if (!permission) return false
    try {
      permission.store.save({ schemaVersion: 1, rules: next })
      permission.policy.setRules(next)
      setVersion((v) => v + 1)
      setNotice(pick('规则已保存并生效', 'Rules saved and active'))
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'rule rejected')
      return false
    }
  }
  const add = () => {
    const [kind, tool, path] = draft.trim().split(/\s+/)
    if ((kind !== 'allow' && kind !== 'deny') || !tool) {
      setNotice(pick('用法：<allow|deny> <tool|*> [路径-glob]', 'Usage: <allow|deny> <tool|*> [path-glob]'))
      return
    }
    const rule: PermissionRule = { id: nextRuleId(rules), action: kind as 'allow' | 'deny', tool, ...(path ? { path } : {}) }
    if (save([...rules, rule])) { setDraft(''); setAdding(false) }
  }
  const remove = () => {
    const target = visible[selected] as { rule?: PermissionRule } | undefined
    if (!target?.rule) return
    if (save(rules.filter((r) => r.id !== target.rule!.id))) setIndex((v) => Math.max(0, v - 1))
  }

  useEffect(() => {
    input.current = {
      key: (text, key) => {
        if (adding) {
          if (key.escape) { setAdding(false); setDraft(''); return }
          if (key.return) { add(); return }
          if (key.backspace || key.delete) { setDraft((v) => v.slice(0, -1)); return }
          if (text && !key.ctrl) setDraft((v) => v + text)
          return
        }
        if (searching) {
          if (key.escape) { setSearching(false); setSearch(''); return }
          if (key.return) { setSearching(false); return }
          if (key.backspace || key.delete) { setSearch((v) => v.slice(0, -1)); return }
          if (text && !key.ctrl) setSearch((v) => v + text)
          return
        }
        if (key.escape) { close(); return }
        if (key.tab || key.rightArrow) { setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length]); setIndex(0); return }
        if (key.leftArrow) { setTab(TABS[(TABS.indexOf(tab) + TABS.length - 1) % TABS.length]); setIndex(0); return }
        if (key.upArrow) { setIndex((v) => Math.max(0, v - 1)); return }
        if (key.downArrow) { setIndex((v) => Math.min(Math.max(0, visible.length - 1), v + 1)); return }
        if (text === '/') { setSearching(true); return }
        if (text === 'a' || text === 'A') { setAdding(true); setDraft(''); setNotice(''); return }
        if (text === 'd' || text === 'D' || key.delete) remove()
      },
      paste: (text) => { if (adding) setDraft((v) => v + text); else if (searching) setSearch((v) => v + text) }
    }
    return () => { input.current = undefined }
  }, [adding, searching, tab, visible, selected, draft, rules, permission])

  const tabLabel = (t: TabType) => ({
    recent: pick('最近拒绝', 'Recently denied'), allow: pick('允许', 'Allow'), ask: pick('询问', 'Ask'),
    deny: pick('拒绝', 'Deny'), workspace: pick('工作区', 'Workspace')
  })[t]
  const subtitle = tab === 'ask'
    ? pick('budingx 使用这些工具前总会请求确认。', 'budingx will always ask for confirmation before using these tools.')
    : tab === 'allow' ? pick('这些工具调用被自动允许。', 'These tool calls are allowed automatically.')
    : tab === 'deny' ? pick('这些工具调用被拒绝。', 'These tool calls are denied.')
    : tab === 'recent' ? pick('最近被拒绝的调用。', 'Recently denied calls.')
    : pick('当前工作区与权限模式。', 'Current workspace and permission mode.')

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('权限', 'Permissions')}: {TABS.map((t) => (t === tab ? '[' + tabLabel(t) + ']' : tabLabel(t))).join('  ')}</Text>
      <Text dimColor>{subtitle}</Text>
      {searching || search ? <Text color="#56b6c2">{pick('搜索 › ', 'Search › ')}{search}_</Text> : null}
      {tab === 'workspace' ? (
        <Box flexDirection="column">
          <Text>{pick('模式：', 'Mode: ')}{mode}</Text>
          <Text dimColor>{permission?.workspace.root ?? ''}</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.length === 0 && <Text dimColor>{pick('（空）', '(empty)')}</Text>}
          {visible.map((row, i) => (
            <Text key={row.id} color={i === selected ? '#56b6c2' : undefined}>{i === selected ? '❯ ' : '  '}{row.label}</Text>
          ))}
        </Box>
      )}
      {adding && <Text color="#56b6c2">{pick('新增规则 › ', 'Add rule › ')}{draft}_</Text>}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <Text dimColor>{pick('Tab/←→ 分页 · ↑↓ 选择 · / 搜索 · a 新增 · d 删除 · Esc 关闭', 'Tab/←→ tabs · ↑↓ select · / search · a add · d delete · Esc close')}</Text>
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
