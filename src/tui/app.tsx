import {
  Box,
  Text,
  useApp,
  useInput,
  useStdout,
  useBoxMetrics,
  usePaste,
  useCursor,
  measureElement,
  type DOMElement
} from 'ink'
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { SessionEvent } from '../core/events.js'
import type { Session } from '../core/session.js'
import type { InkApprovalGateway } from './approval.js'
import { runCommand, type CommandContext } from './commands.js'
import { EditorBuffer } from './editor/buffer.js'
import { applyKey } from './editor/keys.js'
import { reduceFrame, renderTextLines } from './render/reducer.js'
import { ACCENT, renderHeader, sessionTopic, setupHint, terminalStrategy, terminalTitle } from './render/header.js'
import { initialFrame } from './render/types.js'
import { diffStats, diffViewLines } from './render/diff-view.js'
import {
  activeToken,
  applyCompletion,
  commandCandidates,
  fileCandidates,
  longestCommonPrefix
} from './render/completion.js'
import { workspacePromptOptions } from './runtime.js'
import { ModelManager, type ModelManagerInput } from './model-manager.js'
import { readClipboard } from './editor/clipboard.js'
import { MODES_EN, MODES_ZH, nextMode } from '../workspace/policy.js'
import { walkWorkspaceFiles } from '../workspace/search.js'
import { changeDiffs } from '../workspace/checkpoint.js'
import { gitWorkspaceChanges, hasGitWorkspace } from '../workspace/git-diff.js'

export type AppProps = {
  session: Session
  gateway: InkApprovalGateway
  commandContext: Omit<CommandContext, 'session'>
  version: string
  cwd?: string
  fullScreen?: boolean
  onExit: () => void
}

type DiffDialog = {
  view: 'list' | 'detail'
  index: number
  /** 'current' or a turn id; aligned with the reference Current + T1..Tn. */
  source: string
}

const COMMAND_NAMES = [
  'help',
  'config',
  'models',
  'model',
  'permission',
  'rules',
  'diff',
  'undo',
  'denials',
  'clear',
  'exit',
  'quit'
]
const STATUS_ZH: Record<string, string> = {
  idle: '就绪',
  requesting: '请求中…',
  streaming: '流式输出中…',
  awaiting_approval: '等待审批',
  tool_running: '工具执行中…',
  cancelling: '取消中…'
}
export function App({
  session,
  gateway,
  commandContext,
  version,
  cwd,
  fullScreen = false,
  onExit
}: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const terminal = stdout as NodeJS.WriteStream
  const [{ width, rows }, setSize] = useState(() => ({
    width: terminal.columns || 80,
    rows: terminal.rows || 24
  }))
  useEffect(() => {
    const resize = () => setSize({ width: terminal.columns || 80, rows: terminal.rows || 24 })
    stdout.on('resize', resize)
    return () => {
      stdout.off('resize', resize)
    }
  }, [stdout])
  const strategy = useMemo(() => terminalStrategy(process.env, process.platform), [])
  const zh = strategy === 'pixel'
  const [frame, dispatch] = useReducer(
    (state: ReturnType<typeof initialFrame>, event: SessionEvent) =>
      reduceFrame(state, event, { width, english: !zh }),
    commandContext.permission?.policy.getMode(),
    (mode) => initialFrame(mode ?? 'read_only')
  )
  const [input, setInput] = useState('')
  const [topic, setTopic] = useState<string>()
  const [scrollTop, setScrollTop] = useState<number>()
  const transcriptBox = useRef<DOMElement>(null)
  const transcriptContent = useRef<DOMElement>(null)
  const viewport = useBoxMetrics(transcriptBox)
  const contentMetrics = useBoxMetrics(transcriptContent)
  const maxScroll = Math.max(0, contentMetrics.height - viewport.clientHeight)
  const offset = Math.min(scrollTop ?? maxScroll, maxScroll)
  const scrolled = fullScreen && offset < maxScroll
  const working = frame.status.state !== 'idle'
  const thinking = frame.thinking &&
    (frame.status.state === 'requesting' || frame.status.state === 'streaming')
  useEffect(() => {
    if (fullScreen) stdout.write(terminalTitle(topic, working))
  }, [stdout, fullScreen, topic, working])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (frame.startedAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [frame.startedAt])
  const [hint, setHint] = useState('')
  const [dialog, setDialog] = useState<DiffDialog | null>(null)
  const [gitAvailable, setGitAvailable] = useState(false)
  const [detailScroll, setDetailScroll] = useState(0)
  const [approvalScroll, setApprovalScroll] = useState(0)
  useEffect(() => setApprovalScroll(0), [frame.approval?.requestId])
  const [overlayDismissed, setOverlayDismissed] = useState(false)
  const [completionIndex, setCompletionIndex] = useState(0)
  const fileCache = useRef<string[] | null>(null)
  // SP003 T18c: rejection may carry feedback back to the model, like the
  // reference's "and tell budingx what to do differently" path.
  const [rejectEntry, setRejectEntry] = useState<{ requestId: string; text: string } | null>(null)
  const editor = useMemo(() => new EditorBuffer(), [])
  const [, bumpEditor] = useReducer((n: number) => n + 1, 0)
  const ctrlC = useRef(0)
  const pick = (a: string, b: string) => (zh ? a : b)
  const suggestion = !working && !input && frame.suggestFollowUp
    ? followUp(frame.lastQuestion ?? '', frame.lastAnswer ?? '', zh)
    : ''
  const inputBox = useRef<DOMElement>(null)
  const { setCursorPosition } = useCursor()
  const [cursorPosition, setPosition] = useState<{ x: number; y: number } | undefined>(
    undefined
  )
  setCursorPosition(cursorPosition)
  const commands = useRef<string[]>([])
  const [commandCount, setCommandCount] = useState(0)
  const chain = useRef(Promise.resolve())
  const pendingActions = useRef(0)
  const managerDone = useRef<(() => void) | undefined>(undefined)
  const managerInput = useRef<ModelManagerInput | undefined>(undefined)
  const [modelManagerOpen, setModelManagerOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const markTyping = () => {
    setTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setTyping(false), 700)
  }
  useEffect(
    () => () => {
      mounted.current = false
      clearTimeout(typingTimer.current)
      managerDone.current?.()
      gateway.cancelAll()
    },
    [gateway]
  )
  const [, bumpConfig] = useReducer((n: number) => n + 1, 0)
  const context = {
    ...commandContext,
    lang: (zh ? 'zh' : 'en') as 'zh' | 'en',
    setConfig: (next: Parameters<CommandContext['setConfig']>[0]) => {
      commandContext.setConfig(next)
      bumpConfig()
    }
  }
  const leave = () => {
    gateway.cancelAll()
    onExit()
    exit()
  }
  const schedule = (action: () => void | Promise<void>) => {
    pendingActions.current++
    session.setQueuePaused(true)
    chain.current = chain.current
      .then(() => {
        if (mounted.current) return action()
      })
      .catch(() => setHint(pick('命令执行失败', 'Command failed')))
      .finally(() => {
        if (--pendingActions.current === 0 && mounted.current)
          session.setQueuePaused(false)
      })
  }
  const execute = (text: string) => {
    fileCache.current = null
    schedule(async () => {
      if (session.isBusy) {
        await new Promise<void>((resolve) => {
          const off = session.on((event) => {
            if (event.type === 'turn_finalized') {
              off()
              resolve()
            }
          })
        })
      }
      if (!mounted.current) return
      const result = await runCommand(text, { ...context, session, interactive: true })
      if (result.exit) {
        leave()
        return
      }
      if (result.openModels) {
        setPosition(undefined)
        setModelManagerOpen(true)
        await new Promise<void>((resolve) => {
          managerDone.current = resolve
        })
      } else setHint(result.error ?? result.message ?? '')
    })
  }
  const executeRef = useRef(execute)
  executeRef.current = execute
  // SP003: diff dialog and @ / completion overlay data (design §3.6/§3.7).
  const permissionHandles = commandContext.permission
  const turnIds = useMemo(() => {
    const ids: string[] = []
    for (const record of permissionHandles?.checkpointChanges() ?? []) {
      if (record.turnId && !ids.includes(record.turnId)) ids.push(record.turnId)
    }
    return ids
  }, [frame.changes.length, permissionHandles])
  const sourceList = ['current', ...(gitAvailable ? ['git'] : []), ...turnIds]
  const sourceLabel = (source: string) =>
    source === 'current'
      ? pick('当前差异', 'Current')
      : source === 'git'
        ? pick('Git 工作区差异', 'Git working tree')
        : pick(`第 ${turnIds.indexOf(source) + 1} 回合差异`, `turn ${turnIds.indexOf(source) + 1} diff`)
  const cycleSource = (current: string, delta: number): string => {
    const list = sourceList.length > 0 ? sourceList : ['current']
    const index = Math.max(0, list.indexOf(current))
    return list[(index + delta + list.length) % list.length]
  }
  const gitDiff = useMemo(() => dialog?.source === 'git' && permissionHandles
    ? gitWorkspaceChanges(permissionHandles.workspace, (path) =>
        permissionHandles.policy.decide({ tool: 'Read', capability: 'read', path }).action !== 'allow'
      )
    : undefined, [dialog?.source, permissionHandles, frame.changes.length])
  const dialogEntries = gitDiff?.files ?? (dialog && permissionHandles
    ? changeDiffs(
        permissionHandles.workspace,
        permissionHandles.checkpointChanges(),
        dialog.source === 'current' ? undefined : dialog.source
      )
    : [])
  const completion = useMemo(() => {
    if (dialog || frame.approval || overlayDismissed || modelManagerOpen) return null
    const lineText = editor.lines[editor.cursor.line] ?? ''
    const token = activeToken(lineText, editor.cursor.col, COMMAND_NAMES)
    if (!token) return null
    if (token.kind === 'command') {
      const candidates = commandCandidates(token.token, COMMAND_NAMES)
      return candidates.length > 0 ? { token, candidates } : null
    }
    if (!permissionHandles) return null
    if (!fileCache.current) {
      fileCache.current = walkWorkspaceFiles(
        permissionHandles.workspace,
        permissionHandles.workspace.root,
        { exclude: (path) => permissionHandles.policy.decide({ tool: 'Read', capability: 'read', path }).action !== 'allow' }
      ).relative
    }
    const candidates = fileCandidates(token.token, fileCache.current)
    return candidates.length > 0 ? { token, candidates } : null
  }, [
    input,
    editor.cursor.line,
    editor.cursor.col,
    dialog,
    frame.approval,
    overlayDismissed,
    modelManagerOpen,
    editor,
    permissionHandles
  ])
  const completionIndexSafe = Math.min(
    completionIndex,
    Math.max(0, (completion?.candidates.length ?? 1) - 1)
  )
  useEffect(() => {
    setCompletionIndex(0)
  }, [completion?.token.token, completion?.token.kind])
  const approvalPageSize = Math.max(1, Math.min(10, rows - 13))
  const submitPrompt = (text: string) => {
    if (!context.getConfig().model.trim()) {
      setHint(pick('请先配置并选择模型', 'Configure and select a model first'))
      return
    }
    const permission = commandContext.permission
    setTopic((previous) => previous ?? sessionTopic(text, context.getConfig().apiKey))
    session.submit(text, permission
      ? workspacePromptOptions(text, permission.workspace, permission.policy)
      : undefined)
  }
  useEffect(
    () =>
      session.on((event) => {
        dispatch(event)
        if (event.type === 'conversation_cleared') {
          setTopic(undefined)
          setScrollTop(undefined)
        }
        if (event.type === 'turn_finalized' || event.type === 'change_set') {
          // Files may have appeared or disappeared; refresh completion.
          fileCache.current = null
        }
        if (event.type === 'turn_finalized') {
          gateway.cancelAll()
          const pending = commands.current.splice(0)
          setCommandCount(0)
          for (const command of pending) executeRef.current(command)
          if (event.restoreText && editor.isEmpty) {
            editor.setText(event.restoreText)
            setInput(editor.text)
          }
        }
      }),
    [session, gateway, editor]
  )
  usePaste((text) => {
    if (managerDone.current) {
      managerInput.current?.paste(text)
      return
    }
    editor.insert(text.replace(/\r\n?/g, '\n'))
    setInput(editor.text)
    markTyping()
  })
  const beforeCursor = editor.lines
    .slice(0, editor.cursor.line)
    .concat(Array.from(editor.lines[editor.cursor.line]).slice(0, editor.cursor.col).join(''))
    .join('\n')
  const cursorLines = renderTextLines('> ' + beforeCursor, width)
  const draftLines = fullScreen ? renderTextLines('> ' + input, width) : []
  const composerRows = Math.max(1, Math.min(4, Math.floor(rows / 6)))
  const draftStart = fullScreen
    ? Math.max(0, Math.min(draftLines.length - composerRows, cursorLines.length - composerRows))
    : 0
  useLayoutEffect(() => {
    if (!inputBox.current) return
    const box = measureElement(inputBox.current)
    const next = {
      x: box.x + stringWidth(cursorLines.at(-1) ?? '') % width,
      y: box.y + cursorLines.length - 1 - draftStart
    }
    setPosition((previous) =>
      previous?.x === next.x && previous.y === next.y ? previous : next
    )
  })
  useInput((text, key) => {
    if (managerDone.current) {
      managerInput.current?.key(text, key)
      return
    }
    // Ctrl+V paste fallback for terminals without bracketed-paste support
    // (legacy Windows conhost / cmd). Ink's usePaste relies on DEC 2004
    // which these terminals ignore, so Ctrl+V arrives as a plain ctrl+v
    // keypress. Read the system clipboard and insert it directly.
    if (key.ctrl && text === 'v' && !rejectEntry && !dialog) {
      try {
        const clip = readClipboard()
        if (clip) {
          editor.insert(clip)
          setInput(editor.text)
          bumpEditor()
          markTyping()
        }
      } catch {
        setHint(pick('无法读取剪贴板', 'Clipboard read failed'))
      }
      return
    }
    if (rejectEntry) {
      if (key.escape) {
        gateway.resolve(rejectEntry.requestId, 'deny')
        setRejectEntry(null)
        setHint(pick('已拒绝', 'Denied'))
        return
      }
      if (key.return) {
        gateway.resolve(
          rejectEntry.requestId,
          'deny',
          'user',
          rejectEntry.text.trim() || undefined
        )
        setRejectEntry(null)
        setHint(
          rejectEntry.text.trim()
            ? pick('已拒绝并附上反馈', 'Denied with feedback')
            : pick('已拒绝', 'Denied')
        )
        return
      }
      if (key.backspace) {
        setRejectEntry({ ...rejectEntry, text: rejectEntry.text.slice(0, -1) })
        return
      }
      if (!key.ctrl && !key.meta && text) {
        setRejectEntry({ ...rejectEntry, text: rejectEntry.text + text })
      }
      return
    }
    if (dialog && permissionHandles) {
      // The dialog owns the keyboard while open (SP003 AC CP-07).
      if (key.escape || (key.ctrl && text === 'c')) {
        setDialog(null)
        return
      }
      if (dialog.view === 'list') {
        if (key.upArrow)
          setDialog({ ...dialog, index: Math.max(0, dialog.index - 1) })
        else if (key.downArrow)
          setDialog({
            ...dialog,
            index: Math.min(dialogEntries.length - 1, dialog.index + 1)
          })
        else if (key.return && dialogEntries[dialog.index]) {
          setDialog({ view: 'detail', index: dialog.index, source: dialog.source })
          setDetailScroll(0)
        } else if (key.rightArrow || key.leftArrow) {
          setDialog({
            ...dialog,
            source: cycleSource(dialog.source, key.rightArrow ? 1 : -1)
          })
        }
        return
      }
      if (key.return) {
        setDialog({ view: 'list', index: dialog.index, source: dialog.source })
      } else if (key.rightArrow || key.leftArrow) {
        setDialog({
          ...dialog,
          source: cycleSource(dialog.source, key.rightArrow ? 1 : -1)
        })
      } else if (key.upArrow) {
        setDetailScroll((s) => Math.max(0, s - 1))
      } else if (key.downArrow) {
        setDetailScroll((s) => s + 1)
      }
      return
    }
    if (fullScreen && (key.pageUp || key.pageDown)) {
      const page = Math.max(1, viewport.clientHeight - 1)
      const next = Math.max(0, Math.min(maxScroll, offset + (key.pageUp ? -page : page)))
      setScrollTop(next === maxScroll ? undefined : next)
      return
    }
    const approval = frame.approval
    const previewLength = approval?.preview?.length ?? 0
    if (previewLength > 0 && !typing && (key.upArrow || key.downArrow)) {
      setApprovalScroll((offset) => Math.max(0, Math.min(
        Math.max(0, previewLength - approvalPageSize),
        offset + (key.upArrow ? -1 : 1)
      )))
      return
    }
    if (completion && !approval) {
      // @ / overlay keys (SP003 AC FC-01…03).
      if (key.upArrow) {
        setCompletionIndex(Math.max(0, completionIndexSafe - 1))
        return
      }
      if (key.downArrow) {
        setCompletionIndex(
          Math.min(completion.candidates.length - 1, completionIndexSafe + 1)
        )
        return
      }
      if (key.tab && !key.shift) {
        // SP003 T18e: Tab first extends to the longest common prefix,
        // like the reference typeahead; only exhausted picks apply fully.
        const lineText = editor.lines[editor.cursor.line] ?? ''
        const values = completion.candidates.map((candidate) => candidate.value)
        const prefix = longestCommonPrefix(values)
        const usePrefix =
          completion.candidates.length > 1 &&
          prefix.length > completion.token.token.length
        const chosen = usePrefix
          ? {
              value: prefix,
              kind: completion.token.kind,
              directory: !/[.]/.test(prefix.split('/').at(-1) ?? '')
            }
          : completion.candidates[completionIndexSafe]
        if (chosen) {
          editor.lines[editor.cursor.line] = applyCompletion(
            lineText,
            completion.token,
            chosen,
            usePrefix
          )
          editor.cursor.col = Array.from(editor.lines[editor.cursor.line]).length -
            (Array.from(lineText).length - completion.token.start - completion.token.length)
          setInput(editor.text)
          bumpEditor()
        }
        return
      }
      if (key.escape) {
        setOverlayDismissed(true)
        return
      }
    }
    if (approval && !typing && key.escape) {
      gateway.resolve(approval.requestId, 'deny')
      return
    }
    if (approval && !typing && editor.isEmpty && /^[123]$/.test(text)) {
      // SP003 AC PC-06: 1 allow once, 2 allow for session, 3 deny (+feedback).
      if (text === '3') {
        setRejectEntry({ requestId: approval.requestId, text: '' })
        return
      }
      gateway.resolve(approval.requestId, text === '1' ? 'allow' : 'allow_session')
      return
    }
    if (approval && !typing && editor.isEmpty && /^[yn]$/i.test(text)) {
      if (text.toLowerCase() === 'n') {
        setRejectEntry({ requestId: approval.requestId, text: '' })
        return
      }
      gateway.resolve(approval.requestId, 'allow')
      return
    }
    if (key.shift && key.tab && permissionHandles) {
      // SP003 design §3.8: cycle the three fixed modes.
      const next = nextMode(permissionHandles.policy.getMode())
      permissionHandles.policy.setMode(next)
      setHint(
        pick(`权限模式：${MODES_ZH[next]}`, `Permission mode: ${MODES_EN[next]}`)
      )
      return
    }
    if (suggestion && !session.isBusy && editor.isEmpty && key.tab && !key.shift && !approval) {
      editor.insert(suggestion)
      setInput(editor.text)
      bumpEditor()
      return
    }
    const action = applyKey(editor, text, key, { busy: session.isBusy })
    if (!action.handled) return
    bumpEditor()
    if (action.interrupt) {
      session.interrupt('user')
      setHint(pick('已请求打断', 'Interrupt requested'))
      return
    }
    if (action.exit) {
      if (++ctrlC.current >= 2) leave()
      else setHint(pick('再按一次 Ctrl+C 退出', 'Press Ctrl+C again to exit'))
      return
    }
    ctrlC.current = 0
    if (action.escape) {
      const recycled = [...session.recycleQueued(), ...commands.current.splice(0)]
      setCommandCount(0)
      if (recycled.length) {
        editor.setText(recycled.join('\n'))
        setInput(editor.text)
      }
      return
    }
    if (action.submit) {
      const submitted = editor.text.trim()
      if (!submitted) return
      setScrollTop(undefined)
      editor.commit(submitted)
      editor.clear()
      setInput('')
      setHint('')
      setTyping(false)
      if (submitted.startsWith('/')) {
        // Interactive /diff opens the two-level dialog (SP003 AC CP-07);
        // pipe and non-workspace hosts keep the text output.
        if (permissionHandles && /^\/diff(\s|$)/.test(submitted)) {
          const arg = submitted.slice(5).trim()
          let index = 0
          let source = turnIds.at(-1) ?? 'current'
          if (arg) {
            const changes = permissionHandles.checkpointChanges()
            const matching = changes.findLastIndex((entry) => entry.path === arg)
            source = changes[matching]?.turnId ?? 'current'
            const found = changeDiffs(
              permissionHandles.workspace,
              changes,
              source === 'current' ? undefined : source
            ).findIndex((entry) => entry.path === arg)
            if (found < 0) {
              // Unknown path: fall back to the text command error.
              if (!session.isBusy) execute(submitted)
              else {
                commands.current.push(submitted)
                setCommandCount(commands.current.length)
              }
              return
            }
            index = found
          }
          // Open on the newest turn diff, fall back to Current.
          setGitAvailable(hasGitWorkspace(permissionHandles.workspace))
          setDialog({
            view: arg ? 'detail' : 'list',
            index,
            source
          })
          setDetailScroll(0)
          fileCache.current = null
          return
        }
        if (!session.isBusy) execute(submitted)
        else {
          commands.current.push(submitted)
          setCommandCount(commands.current.length)
          setHint(
            pick(
              '命令已排队，将在回合结束后执行',
              'Command queued until the turn boundary'
            )
          )
        }
      } else if (pendingActions.current) schedule(() => submitPrompt(submitted))
      else submitPrompt(submitted)
      return
    }
    setInput(editor.text)
    if (overlayDismissed && (text || key.backspace)) setOverlayDismissed(false)
    if (text || key.backspace || key.delete) markTyping()
  })
  const config = commandContext.getConfig()
  const historyLines = useMemo(
    () => frame.transcript.flatMap((line) => renderTextLines(line, width)),
    [frame.transcript, width]
  )
  const liveText = frame.liveText
  if (modelManagerOpen) {
    return <ModelManager context={{ ...context, session }} input={managerInput} readClipboard={readClipboard} close={(notice) => {
      const done = managerDone.current
      setModelManagerOpen(false)
      setHint(notice ?? '')
      managerDone.current = undefined
      done?.()
    }} />
  }
  if (dialog && permissionHandles) {
    // SP003 AC CP-07/CP-08: two-level dialog, source switch, single column
    // in every width (a split column would cut hunks on narrow terminals).
    const entry = dialogEntries[dialog.index]
    if (dialog.view === 'list') {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray">
          <Text bold>
            {pick('本会话改动', 'Session changes')} · {sourceLabel(dialog.source)}
          </Text>
          {gitDiff && (gitDiff.incomplete || gitDiff.skipped > 0) && (
            <Text dimColor>
              {pick('Git 差异未完整显示，跳过文件数', 'Git diff is incomplete, files skipped')}: {gitDiff.skipped}
            </Text>
          )}
          {dialogEntries.length === 0 && (
            <Text dimColor>{pick('无改动', 'no changes')}</Text>
          )}
          {dialogEntries.map((item, index) => {
            const stat = diffStats(item.hunks)
            return (
              <Text key={item.path} inverse={index === dialog.index}>
                {' '}
                {item.path} {`+${stat.additions}/-${stat.removals}`}{' '}
                {item.operation === 'create' ? pick('新建', 'new')
                  : item.operation === 'delete' ? pick('删除', 'deleted') : pick('修改', 'edited')}
              </Text>
            )
          })}
          <Text dimColor>
            {pick(
              '↑↓ 选择 · Enter 详情 · ←/→ 切源 · Esc 关闭',
              'up/down select · enter detail · left/right source · esc close'
            )}
          </Text>
        </Box>
      )
    }
    const hunks = entry?.hunks ?? []
    const lines = diffViewLines(hunks, width)
    const visible = lines.slice(detailScroll, detailScroll + 24)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>
          ── {entry?.path ?? ''} · {sourceLabel(dialog.source)} ──
        </Text>
        {visible.map((line, index) => (
          <Text key={detailScroll + index}>
            {line.spans.map((span, j) => (
              <Text
                key={j}
                color={
                  span.kind === 'add'
                    ? 'green'
                    : span.kind === 'remove'
                      ? 'red'
                      : span.kind === 'header'
                        ? 'cyan'
                        : undefined
                }
                dimColor={span.kind === 'gutter' || span.kind === 'context'}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ))}
        {visible.length === 0 && (
          <Text dimColor>{pick('（无差异）', '(no differences)')}</Text>
        )}
        <Text dimColor>
          {pick(
            '↑↓ 滚动 · Enter 列表 · ←/→ 切源 · Esc 关闭',
            'up/down scroll · enter list · left/right source · esc close'
          )}
        </Text>
      </Box>
    )
  }
  const completionMenu = completion && (
    <Box flexDirection="column">
      {completion.candidates.map((candidate, index) => (
        <Text key={candidate.value} inverse={index === completionIndexSafe}>
          {(completion.token.kind === 'command' ? '/' : '@') + candidate.value}
          {candidate.directory
            ? pick('  [目录]', '  [dir]')
            : candidate.kind === 'command'
              ? pick('  [命令]', '  [cmd]')
              : ''}
        </Text>
      ))}
      <Text dimColor>
        {pick('↑↓ 选择 · Tab 插入 · Esc 关闭', 'up/down select · tab insert · esc dismiss')}
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column" height={fullScreen ? rows : undefined}>
      <Box flexDirection="column" flexShrink={0}>
        {renderHeader({
          version,
          model: config.model,
          baseUrl: config.baseUrl,
          keyPresent: !!config.apiKey.trim(),
          cwd,
          columns: width,
          strategy,
          compact: fullScreen
        }).slice(0, fullScreen && rows < 18 ? 1 : undefined).map((line, i) => (
          <Text key={i} wrap={fullScreen ? 'truncate-end' : 'wrap'}>
            {line.map((span, j) => (
              <Text
                key={j}
                color={span.color}
                dimColor={span.dim}
                bold={span.bold}
                italic={span.italic}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box
        ref={transcriptBox}
        flexDirection="column"
        flexGrow={fullScreen ? 1 : undefined}
        flexBasis={fullScreen ? 0 : undefined}
        overflowY={fullScreen ? 'hidden' : undefined}
        contentOffsetY={fullScreen ? offset : undefined}
      >
        <Box ref={transcriptContent} flexDirection="column" flexShrink={0}>
          {historyLines.map((line, i) => (
            <Text key={'history-' + i}>{line}</Text>
          ))}
          {liveText &&
            renderTextLines(liveText, width).map((line, i) => (
              <Text key={'live-' + i}>{line}</Text>
            ))}
          {frame.notices.map((notice, i) => (
            <Text key={'notice-' + i} color={notice.level === 'error' ? 'red' : 'yellow'}>
              {notice.text}
            </Text>
          ))}
          {commandCount > 0 && (
            <Text color="yellow">
              {pick('排队命令：', 'Queued commands: ')}
              {commandCount}
            </Text>
          )}
          {frame.queue.map((item) => (
            <Text key={item.id} color="yellow">
              {pick('⧗ 排队：', '[queued] ')}
              {item.preview}
            </Text>
          ))}
          {fullScreen && frame.error && <Text color="red">{frame.error}</Text>}
          {fullScreen && hint && <Text>{hint}</Text>}
        </Box>
      </Box>
      {rejectEntry && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">
            {pick('拒绝反馈（可选，将随拒绝发回模型）', 'Rejection feedback (optional, sent back to the model)')}
          </Text>
          <Text> &gt; {rejectEntry.text}</Text>
          <Text dimColor>
            {pick(
              'Enter 提交拒绝与反馈 · Esc 仅拒绝',
              'Enter denies with feedback · Esc denies silently'
            )}
          </Text>
        </Box>
      )}
      {frame.approval && !typing && !rejectEntry && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">
            {pick('需要审批', 'Approval needed')}: {frame.approval.name}
          </Text>
          <Text>{frame.approval.summary}</Text>
          {frame.approval.preview?.slice(approvalScroll, approvalScroll + approvalPageSize).map((line, index) => (
            <Text
              key={approvalScroll + index}
              color={line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : undefined}
              wrap="truncate-end"
            >
              {line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')}
            </Text>
          ))}
          {(frame.approval.preview?.length ?? 0) > approvalPageSize && (
            <Text dimColor>
              {pick('↑↓ 滚动差异', '↑↓ scroll diff')} · {approvalScroll + 1}–{approvalScroll + approvalPageSize}/{frame.approval.preview?.length}
            </Text>
          )}
          <Text>
            {permissionHandles
              ? pick(
                  '1 允许一次 · 2 本会话记住 · 3 拒绝（或 Esc）',
                  '1 allow once · 2 allow for session · 3 deny (or Esc)'
                )
              : pick('y 允许，n 或 Esc 拒绝', 'y allows; n or Esc denies')}
            {!editor.isEmpty
              ? pick(
                  '；先清空或提交输入后再按键',
                  '; clear or submit the draft before pressing keys'
                )
              : ''}
          </Text>
        </Box>
      )}
      {!fullScreen && frame.error && <Text color="red">{frame.error}</Text>}
      <Box flexDirection="column" flexShrink={0}>
        {fullScreen && completionMenu}
        {fullScreen && (
          <Box
            height={1}
            borderStyle="single"
            borderColor={ACCENT}
            borderLeft={false}
            borderRight={false}
            borderBottom={false}
          />
        )}
        <Box ref={inputBox}>
          {suggestion ? (
            <Text wrap="truncate-end">
              {'> '}<Text dimColor>{pick('Tab 填入', 'Tab to fill')} · {suggestion}</Text>
            </Text>
          ) : (
            <Text>{fullScreen ? draftLines.slice(draftStart, draftStart + composerRows).join('\n') : `> ${input}`}</Text>
          )}
        </Box>
        {!fullScreen && completionMenu}
        <Text dimColor wrap={fullScreen ? 'truncate-end' : 'wrap'}>
          {fullScreen && <Text color={working ? ACCENT : undefined}>{working ? '● ' : '○ '}</Text>}
          {thinking
            ? pick('思考中', 'thinking')
            : zh ? STATUS_ZH[frame.status.state] : frame.status.state}
          {frame.startedAt !== undefined && ` ${Math.max(0, Math.floor((now - frame.startedAt) / 1000))}${pick(' 秒', 's')}`}
          {permissionHandles
            ? ` · ${pick(
                MODES_ZH[frame.permissionMode],
                MODES_EN[frame.permissionMode]
              )} · Shift+Tab ${pick('切换模式', 'cycle mode')}`
            : ''}
          {!fullScreen && hint ? ` — ${hint}` : ''}
        </Text>
        {scrolled && (
          <Text dimColor wrap="truncate-end">
            {pick('浏览历史 · PageDown 向下', 'History · PageDown to scroll down')}
          </Text>
        )}
        {setupHint(config, strategy) && (
          <Text color="yellow" wrap={fullScreen ? 'truncate-end' : 'wrap'}>{setupHint(config, strategy)}</Text>
        )}
      </Box>
    </Box>
  )
}

function followUp(question: string, answer: string, zh: boolean): string {
  if (/你好|你是谁|who are you|^hello/i.test(question)) {
    return zh ? '介绍这个项目的主要功能' : 'Describe the main features of this project'
  }
  if (/修复|错误|报错|error|fix|bug/i.test(question + answer)) {
    return zh ? '如何验证这个修复？' : 'How can I verify this fix?'
  }
  return zh ? '结合项目给我一个具体示例' : 'Show me a concrete example from this project'
}
