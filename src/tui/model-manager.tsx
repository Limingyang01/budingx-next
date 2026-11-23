import { Box, Text, type Key } from 'ink'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ModelProfile } from '../storage/config-store.js'
import { profileCredentialBinding, profileCredentialRef, startupProfile } from '../storage/profiles.js'
import type { CommandContext } from './commands.js'
import {
  loadModelIds, providerTemplates, removeModel, saveModel, selectProfile, testProfile,
  type ModelDraft
} from './model-management.js'

type View = 'list' | 'templates' | 'form' | 'models' | 'delete' | 'orphans'
const fields = ['baseUrl', 'model', 'label', 'apiKey', 'contextWindow', 'tools', 'startupDefault',
  'discover', 'test', 'save', 'use'] as const
type Field = (typeof fields)[number]
type TextField = 'label' | 'baseUrl' | 'model' | 'apiKey' | 'contextWindow'

function textField(field: Field): field is TextField {
  return field === 'label' || field === 'baseUrl' || field === 'model' || field === 'apiKey' || field === 'contextWindow'
}

export type ModelManagerInput = {
  key: (text: string, key: Key) => void
  paste: (text: string) => void
}

export function ModelManager({
  context,
  close,
  input,
  readClipboard
}: {
  context: CommandContext
  close: (notice?: string) => void
  input: RefObject<ModelManagerInput | undefined>
  readClipboard: () => string | undefined
}) {
  const [view, setView] = useState<View>('list')
  const [index, setIndex] = useState(0)
  const [fieldIndex, setField] = useState(0)
  const [caret, setCaret] = useState(0)
  const [draft, setDraft] = useState<ModelDraft | undefined>()
  const [modelIds, setModelIds] = useState<string[]>([])
  const [marked, setMarked] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [suggested, setSuggested] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [orphanCount, setOrphanCount] = useState(0)
  const action = useRef<AbortController | undefined>(undefined)
  const automaticDiscovery = useRef(false)
  const returnIndex = useRef(0)
  const pick = (zh: string, en: string) => context.lang === 'zh' ? zh : en
  const [file, setFile] = useState(() => context.configStore.load())
  const refresh = () => {
    const next = context.configStore.load()
    setFile(next)
    setIndex((value) => Math.min(value, Math.max(0, next.models.length - 1)))
  }
  const config = context.getConfig()
  const effectiveDefault = startupProfile(file)?.id
  const grouped = new Map<string, ModelProfile[]>()
  for (const item of file.models) {
    const ref = profileCredentialRef(item)
    const group = grouped.get(ref)
    if (group) group.push(item)
    else grouped.set(ref, [item])
  }
  const profiles = Array.from(grouped.values()).flat()
  const profile = profiles[Math.min(index, profiles.length - 1)]
  const editedProfile = file.models.find((item) => item.id === (draft?.id ?? draft?.attachTo))
  const sharedCount = editedProfile ? grouped.get(profileCredentialRef(editedProfile))?.length ?? 0 : 0
  const alternatives = file.models.filter((item) => item.id !== draft?.id)
  const filtered = modelIds.filter((id) => id.toLowerCase().includes(filter.toLowerCase()))
  const field = fields[fieldIndex]

  useEffect(() => () => action.current?.abort(), [])

  function run(work: (signal: AbortSignal) => Promise<void>) {
    if (action.current) return
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setNotice(pick('正在请求…', 'Requesting…'))
    void work(controller.signal).catch((error) => {
      if (controller.signal.aborted) return
      const status = /^HTTP \d+$/.test(error?.message ?? '') ? String(error.message) : ''
      setNotice(status === 'HTTP 401' || status === 'HTTP 403'
        ? pick('鉴权失败，请检查 API Key、端点和套餐', 'Authentication failed; check API key, endpoint and plan')
        : pick('请求失败，可重试或手动输入模型 ID', 'Request failed; retry or enter the model ID manually')
          + (status ? ' (' + status + ')' : ''))
    }).finally(() => {
      if (action.current === controller) {
        action.current = undefined
        setBusy(false)
      }
    })
  }

  function cancelRequest() {
    action.current?.abort()
    action.current = undefined
    setBusy(false)
    setNotice(pick('请求已取消', 'Request cancelled'))
  }

  function list() {
    setView('list')
    setDraft(undefined)
    setIndex(Math.min(returnIndex.current, Math.max(0, file.models.length - 1)))
    setNotice('')
  }

  function profileDraft(item?: ModelProfile, baseUrl = ''): ModelDraft {
    return {
      id: item?.id, updatedAt: item?.updatedAt, label: item?.label ?? '', baseUrl: item?.baseUrl ?? baseUrl,
      model: item?.model ?? '', apiKey: '', tools: item?.capabilities.tools ?? true,
      startupDefault: item ? item.id === effectiveDefault : file.models.length === 0,
      contextWindow: item?.contextWindow !== undefined ? String(item.contextWindow) : ''
    }
  }

  function form(value: ModelDraft, focus: number, auto = false) {
    automaticDiscovery.current = auto
    setDraft(value)
    setField(focus)
    setCaret(0)
    setView('form')
    setNotice('')
  }

  function setFocus(next: number) {
    const position = (next + fields.length) % fields.length
    const nextField = fields[position]
    setField(position)
    setCaret(draft && textField(nextField) ? Array.from(draft[nextField] ?? '').length : 0)
  }

  function insert(text: string) {
    if (action.current) return
    if (view === 'form' && field === 'apiKey') text = text.trim()
    if (/[\x00-\x1f\x7f]/.test(text)) {
      setNotice(pick('请粘贴单行文本', 'Paste a single line of text'))
      return
    }
    if (view === 'models') {
      setFilter((value) => (value + text).slice(0, 256))
      setIndex(0)
      return
    }
    if (view !== 'form' || !draft || !textField(field)) return
    if (draft.attachTo && (field === 'baseUrl' || field === 'apiKey')) return
    const chars = Array.from(draft[field] ?? '')
    const added = Array.from(text).slice(0, Math.max(0, 4096 - chars.length))
    chars.splice(caret, 0, ...added)
    setDraft({ ...draft, [field]: chars.join('') })
    setCaret(caret + added.length)
  }

  function loadModels(value: ModelDraft) {
    run(async (signal) => {
      const result = await loadModelIds(context, value, signal)
      const models = result.models
      if (signal.aborted) return
      if (models.length === 0) {
        setNotice(pick('没有可选模型，请手动填写模型 ID', 'No models available; enter an ID manually'))
        setFocus(1)
        return
      }
      setModelIds(models)
      setMarked((value.modelIds ?? []).filter((model) => models.includes(model)))
      setSuggested(result.suggested)
      // SP009 0.9.1 LC-01：把服务端报告的上下文窗口随草稿保存，落盘时写入档案。
      setDraft((current) => current ? { ...current, discoveredContextWindows: result.contextWindows } : current)
      setFilter('')
      setIndex(0)
      setNotice('')
      setView('models')
    })
  }

  function test(value: ModelDraft) {
    run(async (signal) => {
      const result = await testProfile(context, value, signal)
      if (signal.aborted) return
      if (result.errorClass === 'auth') {
        setNotice(pick('鉴权失败，请检查 API Key、端点和套餐', 'Authentication failed; check API key, endpoint and plan'))
        if (view === 'form') setFocus(3)
      } else if (result.reasoningOnly) {
        setNotice(pick('已连接，探测仅返回思考内容。可保存后试聊。', 'Connected; probe returned reasoning only. Save and try a chat.'))
      } else if (result.errorClass === 'tool_unsupported' && result.supportsTools === false) {
        setNotice(pick('聊天已连接，工具调用未通过', 'Chat connected; tool calls did not pass'))
      } else if (result.ok) {
        const toolsMissing = value.tools && result.supportsTools === false
        setNotice(toolsMissing
          ? pick('连接成功，工具调用未通过', 'Connection succeeded; tool calls failed')
          : pick('连接成功', 'Connection succeeded'))
      } else {
        setNotice(pick('连接失败，请检查模型 ID 或端点', 'Connection failed; check model ID or endpoint')
          + (result.errorClass ? ' (' + result.errorClass + ')' : ''))
      }
    })
  }

  function save(value: ModelDraft, use: boolean) {
    try {
      saveModel(context, value, use)
      if (use) close(pick('已保存并切换模型', 'Model saved and selected'))
      else {
        refresh()
        list()
        setNotice(pick('模型档案已保存', 'Model profile saved'))
      }
    } catch (error) {
      setNotice(pick('无法保存：', 'Could not save: ') + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  function handleKey(text: string, key: Key) {
    if (key.escape || key.ctrl && text === 'c') {
      if (action.current) { cancelRequest(); return }
      if (view === 'models') {
        setView('form')
        setFocus(1)
      } else if (view === 'list') close()
      else list()
      return
    }
    if (action.current) return
    if (key.ctrl && text === 'v') {
      try { insert(readClipboard() ?? '') }
      catch { setNotice(pick('无法读取剪贴板', 'Clipboard read failed')) }
      return
    }
    const delta = key.upArrow ? -1 : key.downArrow ? 1 : 0

    if (view === 'templates' || view === 'models' || view === 'delete') {
      const count = view === 'templates' ? providerTemplates.length : view === 'models'
        ? filtered.length : alternatives.length + 1
      if (delta || key.home || key.end) {
        setIndex(Math.max(0, Math.min(count - 1, key.home ? 0 : key.end ? count - 1 : index + delta)))
      } else if (key.return && view === 'templates') {
        const template = providerTemplates[index]
        form(profileDraft(undefined, template.baseUrl), template.baseUrl ? 3 : 0, Boolean(template.baseUrl))
      } else if (view === 'models' && text === ' ' && filtered[index] && !key.ctrl && !key.meta) {
        const id = filtered[index]
        setMarked((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id])
      } else if (key.return && view === 'models' && draft && (marked.length || filtered[index])) {
        const picks = marked.length ? marked : [filtered[index]]
        const model = draft.id && marked.length && draft.model ? draft.model : picks[0]
        setDraft({ ...draft, model, modelIds: picks.filter((item) => item !== model) })
        setView('form')
        setField(fields.indexOf('use'))
      } else if (key.return && view === 'delete' && draft?.id) {
        try {
          removeModel(context, draft.id, alternatives[index - 1]?.id)
          refresh()
          list()
          setNotice(pick('模型档案已删除', 'Model profile deleted'))
        } catch {
          setNotice(pick('删除失败，请重新打开面板', 'Delete failed; reopen the panel'))
        }
      } else if (view === 'models' && key.backspace) {
        setFilter((value) => Array.from(value).slice(0, -1).join(''))
        setIndex(0)
      } else if (view === 'models' && !key.ctrl && !key.meta) insert(text)
      return
    }

    if (view === 'orphans') {
      if (key.return) {
        try {
          for (const id of context.credentialStore.orphanIds(context.configStore.load().models.map(profileCredentialRef))) {
            context.credentialStore.remove(id)
          }
          list()
          setNotice(pick('孤儿凭据已清理', 'Orphan credentials removed'))
        } catch {
          setNotice(pick('无法清理凭据', 'Could not clean up credentials'))
        }
      }
      return
    }

    if (view === 'list') {
      if (delta) {
        setIndex(Math.max(0, Math.min(file.models.length - 1, index + delta)))
        return
      }
      if (key.ctrl || key.meta) return
      const command = text.toLowerCase()
      if (command === 'n') {
        returnIndex.current = index
        setIndex(0)
        setView('templates')
      } else if (command === 'o') {
        try {
          setOrphanCount(context.credentialStore.orphanIds(file.models.map(profileCredentialRef)).length)
          setView('orphans')
        } catch { setNotice(pick('无法读取凭据', 'Could not read credentials')) }
      } else if (profile) {
        returnIndex.current = index
        if (key.return) {
          try {
            selectProfile(context, profile)
            close(pick('已切换模型', 'Model selected'))
          } catch { setNotice(pick('无法读取档案凭据', 'Could not read profile credentials')) }
        } else if (command === 'e') form(profileDraft(profile), 1)
        else if (command === 'a') {
          const next = { ...profileDraft(), attachTo: profile.id, updatedAt: profile.updatedAt,
            baseUrl: profile.baseUrl, startupDefault: false, tools: profile.capabilities.tools }
          form(next, 1)
          loadModels(next)
        } else if (command === 't') test(profileDraft(profile))
        else if (command === 's') {
          try {
            const saved = context.configStore.load()
            if (!saved.models.some((item) => item.id === profile.id)) throw new Error('Profile no longer exists')
            context.configStore.save({ ...saved, defaultModelId: profile.id })
            refresh()
          } catch { setNotice(pick('无法设置默认模型', 'Could not set startup default')) }
        } else if (command === 'd') {
          setDraft(profileDraft(profile))
          setIndex(0)
          setView('delete')
        }
      }
      return
    }

    if (!draft) return
    if (key.tab || delta) {
      setFocus(fieldIndex + (key.shift ? -1 : delta || 1))
      return
    }
    if (key.return) {
      if (field === 'discover' || field === 'apiKey' && automaticDiscovery.current && !draft.model && draft.apiKey.trim()) {
        loadModels(draft)
      } else if (field === 'test') test(draft)
      else if (field === 'save' || field === 'use') save(draft, field === 'use')
      else if (field === 'tools' || field === 'startupDefault') setDraft({ ...draft, [field]: !draft[field] })
      else setFocus(fieldIndex + 1)
      return
    }
    if (field === 'tools' || field === 'startupDefault') {
      if (text === ' ') setDraft({ ...draft, [field]: !draft[field] })
      return
    }
    if (!textField(field) || draft.attachTo && (field === 'baseUrl' || field === 'apiKey')) return
    const chars = Array.from(draft[field] ?? '')
    if (key.leftArrow || key.rightArrow || key.home || key.end) {
      setCaret(key.home ? 0 : key.end ? chars.length : Math.max(0,
        Math.min(chars.length, caret + (key.leftArrow ? -1 : 1))))
    } else if (key.backspace || key.delete || key.ctrl && text === 'u') {
      if (key.ctrl) {
        setDraft({ ...draft, [field]: '' })
        setCaret(0)
      } else if (key.delete && caret < chars.length || key.backspace && caret > 0) {
        const start = key.backspace ? caret - 1 : caret
        chars.splice(start, 1)
        setDraft({ ...draft, [field]: chars.join('') })
        setCaret(start)
      }
    } else if (!key.ctrl && !key.meta) insert(text)
  }

  // The app retains its terminal subscriptions. Register this modal's
  // handlers during layout, before a rendered panel can receive input.
  useLayoutEffect(() => {
    input.current = { key: handleKey, paste: insert }
    return () => { input.current = undefined }
  })

  const label: Record<Field, string> = {
    baseUrl: pick('API 端点', 'API endpoint'), model: 'Model ID',
    label: pick('名称（可选）', 'Label (optional)'), apiKey: 'API Key',
    contextWindow: pick('上下文窗口（留空=自动）', 'Context window (blank=auto)'),
    tools: pick('工具调用', 'Tool calls'), startupDefault: pick('启动默认', 'Startup default'),
    discover: pick('拉取模型列表', 'Fetch model list'), test: pick('测试连接', 'Test connection'),
    save: pick('保存', 'Save'), use: pick('保存并使用', 'Save and use')
  }

  const formValue = (fieldName: Field) => {
    if (!draft) return ''
    if (fieldName === 'apiKey') {
      if (draft.apiKey) return pick('已输入（隐藏）', 'Entered (hidden)')
      try {
        const configured = editedProfile && context.credentialStore.get(
          profileCredentialRef(editedProfile), profileCredentialBinding(editedProfile, draft.baseUrl)
        )
        return configured
          ? pick('已设置', 'Configured')
          : pick('粘贴密钥', 'Paste key')
      } catch { return pick('粘贴密钥', 'Paste key') }
    }
    if (fieldName === 'startupDefault' || fieldName === 'tools') {
      return draft[fieldName] ? pick('开启', 'On') : pick('关闭', 'Off')
    }
    return textField(fieldName) ? (draft[fieldName] ?? '') : ''
  }

  function choices(items: string[]) {
    const from = Math.max(0, Math.min(index - 3, items.length - 8))
    return items.slice(from, from + 8).map((value, offset) => (
      <Text key={from + offset} wrap="truncate-end" inverse={index === from + offset}>
        {index === from + offset ? '> ' : '  '}{value}
      </Text>
    ))
  }

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>{pick('模型管理', 'Model management')}</Text>
      {view === 'list' && <>
        {file.models.length === 0 && <Text dimColor>{pick('暂无模型档案', 'No profiles yet')}</Text>}
        {choices(profiles.map((model) => {
          const members = grouped.get(profileCredentialRef(model)) ?? []
          const shared = members.length > 1
            ? pick(' [共享 · ', ' [shared · ') + members[0].label + ']'
            : ''
          return model.label + ' · ' + model.model + shared
            + (config.profileId === model.id ? pick(' [当前]', ' [current]') : '')
            + (effectiveDefault === model.id ? pick(' [默认]', ' [default]') : '')
        }))}
        <Text wrap="wrap" dimColor>{pick(
          '↑↓ 选择  Enter 使用  N 新建  E 编辑  D 删除',
          '↑↓ Select  Enter Use  N New  E Edit  D Delete'
        )}</Text>
        <Text wrap="wrap" dimColor>{pick(
          'A 添加同组模型  T 测试  S 设为默认  O 孤儿凭据  Esc 返回',
          'A Add to provider  T Test  S Set default  O Orphan keys  Esc Back'
        )}</Text>
      </>}
      {view === 'templates' && <>
        <Text>{pick('选择供应商（End 到 Custom）', 'Choose provider (End for Custom)')}</Text>
        {choices(providerTemplates.map((item) => item.name))}
        <Text dimColor>{pick('↑↓ 选择  Enter 确认  Esc 返回', '↑↓ Select  Enter Confirm  Esc Back')}</Text>
      </>}
      {view === 'form' && draft && <>
        <Text>{draft.attachTo ? pick('添加同组模型（沿用已存端点与密钥）', 'Add to provider (uses saved endpoint and key)')
          : draft.id ? pick('编辑模型', 'Edit model') : pick('新增模型', 'Add model')}</Text>
        {draft.id && sharedCount > 1 && (
          <Text dimColor>{pick('端点和密钥供同组模型共享', 'Endpoint and key are shared by this group')}: {sharedCount}
          </Text>
        )}
        {Boolean(draft.modelIds?.length) && (
          <Text wrap="truncate-end">{pick('同时添加', 'Also add')}: {draft.modelIds?.join(', ')}</Text>
        )}
        {fields.map((fieldName, i) => (
          <Text key={fieldName} wrap="truncate-end" inverse={fieldIndex === i}>
            {fieldIndex === i ? '> ' : '  '}{label[fieldName]}{formValue(fieldName) && '  ' + formValue(fieldName)}
          </Text>
        ))}
        {editedProfile && draft.baseUrl && (() => {
          try { return profileCredentialBinding(editedProfile, new URL(draft.baseUrl).toString().replace(/\/+$/, '')) !== profileCredentialBinding(editedProfile) } catch { return false }
        })() && <Text>{pick('端点主机已变化，请录入新密钥', 'Endpoint host changed; enter the new key')}</Text>}
        <Text wrap="wrap" dimColor>{pick('Tab / ↑↓ 移动  Enter 确认  Esc 返回', 'Tab / ↑↓ Move  Enter Confirm  Esc Back')}</Text>
      </>}
      {view === 'models' && <>
        {suggested && <Text dimColor>{pick('该端点未提供模型列表，以下为建议 ID', 'This endpoint does not list models; these are suggested IDs')}</Text>}
        <Text wrap="truncate-end">{pick('筛选', 'Filter')} ({filtered.length}/{modelIds.length}): {filter}</Text>
        {choices(filtered.map((id) => (marked.includes(id) ? '[x] ' : '[ ] ') + id))}
        <Text dimColor>{pick('输入筛选  空格多选  Enter 确认  Esc 手填', 'Type to filter  Space marks  Enter Confirm  Esc Manual')} ({marked.length})</Text>
      </>}
      {view === 'delete' && draft && <>
        <Text wrap="truncate-end">{sharedCount > 1
          ? pick('删除模型，共享密钥继续供其他模型使用', 'Delete model; the shared key remains')
          : pick('删除档案和密钥', 'Delete profile and key')}: {draft.label}</Text>
        {(config.profileId === draft.id || effectiveDefault === draft.id)
          ? choices([pick('不使用替代', 'No replacement'), ...alternatives.map((item) => item.label)])
          : choices([pick('确认删除', 'Confirm deletion')])}
        <Text dimColor>{pick('Enter 确认删除  Esc 取消', 'Enter Confirm deletion  Esc Cancel')}</Text>
      </>}
      {view === 'orphans' && <>
        <Text>{pick('清理未绑定档案的凭据', 'Remove keys without a profile')}: {orphanCount}</Text>
        <Text dimColor>{pick('Enter 确认清理  Esc 取消', 'Enter Confirm cleanup  Esc Cancel')}</Text>
      </>}
      {notice && <Text wrap="wrap">{notice}</Text>}
      {busy && <Text dimColor>{pick('Esc 取消请求', 'Esc Cancel request')}</Text>}
    </Box>
  )
}
