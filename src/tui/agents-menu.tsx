// SP007 T9：/agents 管理面板（design §4.1）。模式机 list→view→wizard；
// 列表显来源标签与被覆盖 dim，内置不可编辑删除；向导仅 Manual（Generate 延期 D10），
// saveAgentFile 'wx' 防覆盖；退出输出变更汇总。键位 ↑↓/Enter/Esc。
import { Box, Text, type Key } from 'ink'
import { useMemo, useState, type RefObject } from 'react'
import type { CommandContext } from './commands.js'
import { AGENT_COLORS, type AgentDefinition } from '../core/agent-definitions.js'
import { listAgentEntries, saveAgentFile, deleteAgentFile, invalidateAgentCache, type AgentEntry } from './agents.js'
import type { PanelInput } from './panels.js'

type Mode = 'list' | 'view' | 'wizard'
type WizardStep = 'location' | 'name' | 'description' | 'prompt' | 'tools' | 'model' | 'color' | 'confirm'
const STEPS: WizardStep[] = ['location', 'name', 'description', 'prompt', 'tools', 'model', 'color', 'confirm']
const LOCATIONS = ['project', 'user'] as const

type Draft = {
  location: 'project' | 'user'
  name: string
  description: string
  prompt: string
  tools: string
  model: string
  color: string
}

function emptyDraft(): Draft {
  return { location: 'project', name: '', description: '', prompt: '', tools: '', model: '', color: '' }
}

function usePanelInput(input: RefObject<PanelInput | undefined>, handler: (text: string, key: Key) => void, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { input.current = { key: handler, paste: () => {} } }, deps)
}

const SOURCE_LABEL: Record<string, string> = { 'built-in': '内置', user: '用户', project: '项目' }

export function AgentsMenu({ context, close, input, cwd, home }: {
  context: CommandContext
  close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
  cwd: string
  home: string
}) {
  const en = context.lang === 'en'
  const pick = (zh: string, english: string) => (en ? english : zh)
  const [version, setVersion] = useState(0)
  const entries = useMemo(() => listAgentEntries({ cwd, home }).entries, [cwd, home, version])
  const [mode, setMode] = useState<Mode>('list')
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [changes, setChanges] = useState({ created: 0, updated: 0, deleted: 0 })
  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState(0)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editing, setEditing] = useState<AgentDefinition | undefined>(undefined)
  const selected = Math.min(index, Math.max(0, entries.length - 1))
  const current = entries[selected]

  const refresh = () => { invalidateAgentCache(); setVersion((v) => v + 1) }
  const summary = () => {
    const parts: string[] = []
    if (changes.created) parts.push(pick(`新建 ${changes.created}`, `created ${changes.created}`))
    if (changes.updated) parts.push(pick(`更新 ${changes.updated}`, `updated ${changes.updated}`))
    if (changes.deleted) parts.push(pick(`删除 ${changes.deleted}`, `deleted ${changes.deleted}`))
    return parts.length ? pick('代理变更：', 'Agent changes: ') + parts.join(' · ') : pick('没有代理变更', 'No agent changes')
  }

  const startWizard = (prefill?: AgentDefinition) => {
    setEditing(prefill)
    setDraft(prefill
      ? { location: prefill.source === 'user' ? 'user' : 'project', name: prefill.name, description: prefill.description, prompt: prefill.body, tools: prefill.tools?.join(', ') ?? '', model: prefill.model && prefill.model !== 'inherit' ? prefill.model : '', color: prefill.color ?? '' }
      : emptyDraft())
    setStep(0)
    setChoice(0)
    setMode('wizard')
    setNotice('')
  }

  const saveDraft = async () => {
    const name = draft.name.trim()
    if (!name || !draft.description.trim() || !draft.prompt.trim()) {
      setNotice(pick('名称、描述、提示词均必填', 'Name, description and prompt are required'))
      return
    }
    const tools = draft.tools.trim()
    const definition: AgentDefinition = {
      name,
      description: draft.description.trim(),
      source: draft.location,
      body: draft.prompt,
      model: draft.model.trim() || 'inherit',
      ...(tools && tools !== '*' ? { tools: tools.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
      ...(draft.color ? { color: draft.color as AgentDefinition['color'] } : {})
    }
    try {
      if (editing?.filePath) {
        await deleteAgentFile(editing)
        setChanges((c) => ({ ...c, updated: c.updated + 1 }))
      } else {
        setChanges((c) => ({ ...c, created: c.created + 1 }))
      }
      const path = await saveAgentFile({ location: draft.location, cwd, home, definition })
      refresh()
      setMode('list')
      setEditing(undefined)
      setNotice(pick(`已保存 ${name} → ${path}`, `Saved ${name} → ${path}`))
    } catch (error) {
      const message = String((error as Error).message)
      if (message.includes('EEXIST') || message.includes('file already exists')) {
        setNotice(pick(`文件已存在：${name}.md（未覆盖）`, `File exists: ${name}.md (not overwritten)`))
        setChanges((c) => ({ ...c, created: Math.max(0, c.created - (editing ? 0 : 1)), updated: Math.max(0, c.updated - (editing ? 1 : 0)) }))
      } else {
        setNotice(pick('保存失败：', 'Save failed: ') + message)
      }
    }
  }

  const removeSelected = async () => {
    if (!current) return
    if (current.source === 'built-in') {
      setNotice(pick('内置代理不可删除', 'Built-in agents cannot be deleted'))
      return
    }
    try {
      await deleteAgentFile(current)
      setChanges((c) => ({ ...c, deleted: c.deleted + 1 }))
      refresh()
      setNotice(pick(`已删除 ${current.name}`, `Deleted ${current.name}`))
    } catch (error) {
      setNotice(pick('删除失败：', 'Delete failed: ') + String((error as Error).message))
    }
  }

  usePanelInput(input, (text, key) => {
    if (mode === 'list') {
      if (key.escape) return close(summary())
      if (key.upArrow) return setIndex((v) => Math.max(0, v - 1))
      if (key.downArrow) return setIndex((v) => Math.min(Math.max(0, entries.length - 1), v + 1))
      if (key.return && current) { setMode('view'); setNotice(''); return }
      if (text === 'n') return startWizard()
      if (text === 'd') { void removeSelected(); return }
      return
    }
    if (mode === 'view') {
      if (key.escape) { setMode('list'); return }
      if (text === 'e' && current && current.source !== 'built-in') { startWizard(current); return }
      if (text === 'e' && current?.source === 'built-in') setNotice(pick('内置代理不可编辑', 'Built-in agents cannot be edited'))
      return
    }
    // wizard
    const stepName = STEPS[step]
    if (key.escape) {
      if (step === 0) { setMode('list'); setEditing(undefined) } else setStep((s) => s - 1)
      return
    }
    if (stepName === 'location' || stepName === 'color') {
      const options = stepName === 'location' ? LOCATIONS : ['', ...AGENT_COLORS]
      if (key.upArrow) return setChoice((v) => Math.max(0, v - 1))
      if (key.downArrow) return setChoice((v) => Math.min(options.length - 1, v + 1))
      if (key.return) {
        if (stepName === 'location') setDraft((d) => ({ ...d, location: LOCATIONS[choice] }))
        else setDraft((d) => ({ ...d, color: options[choice] }))
        setStep((s) => s + 1)
        setChoice(0)
      }
      return
    }
    if (stepName === 'confirm') {
      if (key.return) void saveDraft()
      return
    }
    // text steps
    if (key.return) { setStep((s) => s + 1); setChoice(0); return }
    if (key.backspace || key.delete) {
      setDraft((d) => ({ ...d, [stepName]: String(d[stepName as keyof Draft]).slice(0, -1) }))
      return
    }
    if (text && text.length === 1 && !key.ctrl && !key.meta) {
      setDraft((d) => ({ ...d, [stepName]: String(d[stepName as keyof Draft]) + text }))
    }
  }, [mode, entries, selected, step, choice, draft, editing, changes])

  if (mode === 'wizard') {
    const stepName = STEPS[step]
    const label: Record<WizardStep, string> = {
      location: pick('保存位置', 'Location'), name: pick('名称', 'Name'), description: pick('描述（何时使用）', 'Description (when to use)'),
      prompt: pick('系统提示词', 'System prompt'), tools: pick('工具（逗号分隔，留空＝全部）', 'Tools (comma-separated, empty = all)'),
      model: pick('模型（留空＝inherit）', 'Model (empty = inherit)'), color: pick('颜色', 'Color'), confirm: pick('确认保存', 'Confirm')
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>{pick('创建子代理（手动配置）', 'Create agent (manual)')} · {step + 1}/{STEPS.length}</Text>
        <Text dimColor>{pick('Generate with budingX 暂未提供（延期）', 'Generate with budingX is deferred')}</Text>
        <Text bold>{label[stepName]}</Text>
        {stepName === 'location' && LOCATIONS.map((loc, i) => (
          <Text key={loc} color={i === choice ? '#56b6c2' : undefined}>{i === choice ? '❯ ' : '  '}{loc === 'project' ? pick('项目 (.budingx/agents/)', 'Project (.budingx/agents/)') : pick('个人 (~/.budingx/agents/)', 'Personal (~/.budingx/agents/)')}</Text>
        ))}
        {stepName === 'color' && ['', ...AGENT_COLORS].map((c, i) => (
          <Text key={c || 'none'} color={i === choice ? '#56b6c2' : undefined}>{i === choice ? '❯ ' : '  '}{c || pick('无', 'none')}</Text>
        ))}
        {stepName !== 'location' && stepName !== 'color' && stepName !== 'confirm' && (
          <Text>{String(draft[stepName as keyof Draft]) || pick('（输入中…）', '(typing…)')}</Text>
        )}
        {stepName === 'confirm' && (
          <Box flexDirection="column">
            <Text>{pick('名称：', 'Name: ')}{draft.name}</Text>
            <Text>{pick('位置：', 'Location: ')}{draft.location}</Text>
            <Text>{pick('描述：', 'Description: ')}{draft.description}</Text>
            <Text>{pick('模型：', 'Model: ')}{draft.model || 'inherit'}</Text>
            <Text>{pick('工具：', 'Tools: ')}{draft.tools || pick('全部', 'all')}</Text>
            <Text>{pick('颜色：', 'Color: ')}{draft.color || pick('无', 'none')}</Text>
          </Box>
        )}
        {notice ? <Text color="yellow">{notice}</Text> : null}
        <Text dimColor>{pick('Enter 下一步/保存 · Esc 上一步/取消', 'Enter next/save · Esc back/cancel')}</Text>
      </Box>
    )
  }

  if (mode === 'view' && current) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>{current.name}</Text>
        <Text>{pick('来源：', 'Source: ')}{SOURCE_LABEL[current.source] ?? current.source}{current.source === 'built-in' ? pick('（不可编辑/删除）', ' (read-only)') : ''}</Text>
        <Text>{pick('描述：', 'Description: ')}{current.description}</Text>
        <Text>{pick('模型：', 'Model: ')}{current.model ?? 'inherit'}</Text>
        <Text>{pick('工具：', 'Tools: ')}{current.tools?.join(', ') ?? pick('全部', 'all')}</Text>
        {current.filePath ? <Text dimColor>{current.filePath}</Text> : null}
        {notice ? <Text color="yellow">{notice}</Text> : null}
        <Text dimColor>{current.source === 'built-in' ? pick('Esc 返回', 'Esc back') : pick('e 编辑 · Esc 返回', 'e edit · Esc back')}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('子代理', 'Agents')}</Text>
      {entries.length === 0 && <Text dimColor>{pick('没有可用的子代理', 'No agents available')}</Text>}
      {entries.map((entry: AgentEntry, i) => (
        <Text key={entry.name + entry.source + i} color={i === selected ? '#56b6c2' : undefined} dimColor={entry.overridden}>
          {i === selected ? '❯ ' : '  '}{entry.name} · {SOURCE_LABEL[entry.source] ?? entry.source}{entry.overridden ? pick('（被覆盖）', ' (overridden)') : ''}
        </Text>
      ))}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <Text dimColor>{pick('↑↓ 选择 · Enter 查看 · n 新建 · d 删除 · Esc 关闭', 'up/down · Enter view · n new · d delete · Esc close')}</Text>
    </Box>
  )
}
