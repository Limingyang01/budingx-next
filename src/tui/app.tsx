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
  type DOMElement,
  type Key
} from 'ink'
import { createHash } from 'node:crypto'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import stringWidth from 'string-width'
/**
 * Stream deltas are coalesced into one paint per frame.
 *
 * A real model sends several deltas per millisecond; rendering every one of
 * them paints the same frame many times per visible change, which is what
 * made a long session feel stuck (SP005 review, 0.5.2 lag fix).
 */
const STREAM_FRAME_MS = 16

import type { SessionEvent } from '../core/events.js'
import type { Session } from '../core/session.js'
import type { InkApprovalGateway } from './approval.js'
import { changePermissionMode, discoverSkillCommands, effortDisplayLabel, formatTokens, interactiveModeLabel, runCommand, type CommandContext } from './commands.js'
import { EditorBuffer } from './editor/buffer.js'
import { useWheel } from './editor/mouse.js'
import { applyKey } from './editor/keys.js'
import { formatDuration, reduceFrame, renderTextLines } from './render/reducer.js'
import { ACCENT, renderHeader, sessionTopic, setupHint, terminalStrategy, terminalTitle } from './render/header.js'
import { initialFrame, type TranscriptEntry } from './render/types.js'
import { diffStats, diffViewLines } from './render/diff-view.js'
import {
  activeCommandCard,
  commandCardLines,
  planCardLines,
  questionCardLines,
  todoCardLines
} from './render/cards.js'
import {
  activeToken,
  applyCompletion,
  commandCandidates,
  commandDescription,
  fileCandidates,
  longestCommonPrefix
} from './render/completion.js'
import { collapseReadSearch, HistoryWindow } from './render/history-window.js'
import { TranscriptMessage } from './render/transcript.js'
import { workspacePromptOptions } from './runtime.js'
import { ModelManager } from './model-manager.js'
import { RulesManager } from './rules-manager.js'
import { ResumePicker, RewindPicker, ContextGrid, ExportPicker } from './panels.js'
import { AgentsMenu } from './agents-menu.js'
import { StatusDialog } from './diagnostics/status-dialog.js'
import { StatsDialog } from './diagnostics/stats-dialog.js'
import { DoctorDialog } from './diagnostics/doctor-dialog.js'
import { homedir } from 'node:os'
import { agentCardLines, agentTreeLines, type AgentCardInput } from './render/agent-card.js'
import { readClipboardImage, readImageFile, extractImagePaths } from './image-paste.js'
import { prepareImage } from './image-resize.js'
import { readClipboard } from './editor/clipboard.js'
import { nextMode } from '../workspace/policy.js'
import { walkWorkspaceFiles } from '../workspace/search.js'
import { changeDiffs } from '../workspace/checkpoint.js'
import { gitWorkspaceChanges, hasGitWorkspace } from '../workspace/git-diff.js'
import { join } from 'node:path'
import { sessionDirectory } from '../storage/private-file.js'
import { TRANSCRIPT_FILE } from '../storage/session-transcript.js'
import { planLayout, regionsFor } from './render/layout.js'
import { useStatusLine } from './use-statusline.js'

export type AppProps = {
  session: Session
  gateway: InkApprovalGateway
  commandContext: Omit<CommandContext, 'session'>
  version: string
  cwd?: string
  fullScreen?: boolean
  /**
   * SP006 波次 G：输入框「下一句」建议的生成端口。
   * 交互式宿主注入真实模型调用；未注入时输入框不显示建议。
   */
  suggestNextPrompt?: (signal: AbortSignal) => Promise<string | undefined>
  /** SP007 MM-06：图片缓存（粘贴/路径附件落盘供重显链接）。 */
  imageCache?: import('../storage/image-cache.js').ImageCache
  onExit: () => void
}

type DiffDialog = {
  view: 'list' | 'detail'
  index: number
  /** 'current' or a turn id; aligned with the reference Current + T1..Tn. */
  source: string
}

export const COMMAND_NAMES = [
  'help',
  'models',
  'permissions',
  'diff',
  'rewind',
  'denials',
  'clear',
  'resume',
  'sessions',
  'context',
  'compact',
  'cost',
  'plan',
  'memory',
  'effort',
  'exit',
  // SP006 扩展命令（补全注册表全名）＋SP007 新命令。
  'init',
  'btw',
  'worktree',
  'tasks',
  'mcp',
  'skills',
  'export',
  'agents',
  'agent',
  'status',
  'stats',
  'doctor',
  // SP007 MM-01 补：终端无关的图片附件入口（VS Code 会吞掉 alt+v）。
  'image'
]
// 0.5.4：请求/流式阶段统一显示「正在思考」，不再暴露「流式输出」这类实现措辞。
const STATUS_ZH: Record<string, string> = {
  requesting: '正在思考…',
  streaming: '正在思考…',
  awaiting_approval: '等待审批',
  tool_running: '工具执行中…',
  cancelling: '取消中…'
}
const STATUS_EN: Record<string, string> = {
  requesting: 'Thinking…',
  streaming: 'Thinking…',
  awaiting_approval: 'Awaiting approval',
  tool_running: 'Running tool…',
  cancelling: 'Cancelling…'
}
export function App({
  session,
  gateway,
  commandContext,
  version,
  cwd,
  fullScreen = false,
  suggestNextPrompt,
  imageCache,
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
    (state: ReturnType<typeof initialFrame>, action: { event: SessionEvent; toolElapsedMs?: number }) =>
      reduceFrame(state, action.event, { width, english: !zh, toolElapsedMs: action.toolElapsedMs }),
    commandContext.permission?.policy.getMode(),
    (mode) => initialFrame(mode ?? 'read_only')
  )
  const [input, setInput] = useState('')
  // SP006 波次 G：输入框「下一句」建议。文本由模型生成，这里只保存结果与取消句柄。
  const [suggestionText, setSuggestionText] = useState('')
  const suggestionAbort = useRef<AbortController | undefined>(undefined)
  const [previewTools, setPreviewTools] = useState<readonly string[]>([])
  useEffect(() => session.onToolPreview(setPreviewTools), [session])
  const [topic, setTopic] = useState<string>()
  const [scrollTop, setScrollTop] = useState<number>()
  const [transcriptMode, setTranscriptMode] = useState(false)
  const [search, setSearch] = useState<{ text: string; index: number }>()
  const displayedHistory = useMemo(
    () => transcriptMode || !fullScreen ? frame.transcript : collapseReadSearch(frame.transcript, !zh),
    [frame.transcript, fullScreen, transcriptMode, zh]
  )
  // The live assistant message must keep a stable object identity: a fresh
  // literal on every render broke the memo of TranscriptMessage and the
  // markdown token cache with it (SP005 review, 0.5.2 lag fix).
  const liveEntry = useMemo<TranscriptEntry | undefined>(
    () => (frame.liveText ? { kind: 'assistant', text: frame.liveText } : undefined),
    [frame.liveText]
  )
  const [historyCountAtScroll, setHistoryCountAtScroll] = useState(0)
  const transcriptHeader = useRef<DOMElement>(null)
  const headerMetrics = useBoxMetrics(transcriptHeader)
  const revealHistory = useCallback((row: number) => {
    setScrollTop(row + headerMetrics.height)
  }, [headerMetrics.height])
  const correctPriorRows = useCallback((delta: number) => {
    setScrollTop((row) => row === undefined ? undefined : Math.max(0, row + delta))
  }, [])
  const transcriptBox = useRef<DOMElement>(null)
  const transcriptContent = useRef<DOMElement>(null)
  const viewport = useBoxMetrics(transcriptBox)
  // 0.5.4：内容盒高度不再用 Ink 的 useBoxMetrics（其内部是无依赖数组的
  // useEffect）。内容高度随虚拟列表测量逐帧微调时，会形成
  // 「测量 → setState → 重渲染 → 高度再变」的同步链，长会话下抛
  // React「Maximum update depth exceeded」。这里用「布局后测量 + 宏任务合并
  // 一次 setState」：既保留贴底/滚动所需的精确高度，又打断同步嵌套链。
  const [contentHeight, setContentHeight] = useState(0)
  const contentHeightRef = useRef(0)
  const contentMeasureScheduled = useRef(false)
  useLayoutEffect(() => {
    if (!transcriptContent.current) return
    contentHeightRef.current = measureElement(transcriptContent.current).height
    if (contentMeasureScheduled.current) return
    contentMeasureScheduled.current = true
    setTimeout(() => {
      contentMeasureScheduled.current = false
      const next = contentHeightRef.current
      setContentHeight((previous) => (previous === next ? previous : next))
    }, 0)
  })
  const maxScroll = Math.max(0, contentHeight - viewport.clientHeight)
  const offset = Math.min(scrollTop ?? maxScroll, maxScroll)
  const scrolled = fullScreen && offset < maxScroll
  const unseenMessages = scrolled && !transcriptMode ? Math.max(0, frame.transcript.length - historyCountAtScroll) : 0
  function scrollHistory(lines: number) {
    if (lines < 0 && !scrolled) setHistoryCountAtScroll(frame.transcript.length)
    setScrollTop((previous) => {
      const current = Math.min(previous ?? maxScroll, maxScroll)
      const next = Math.max(0, Math.min(maxScroll, current + lines))
      return next === maxScroll ? undefined : next
    })
  }
  const working = frame.status.state !== 'idle'
  const modeLabel = interactiveModeLabel(frame.permissionMode, zh ? 'zh' : 'en')
  const modeColor = {
    read_only: '#56b6c2',
    workspace_edit: '#e5c07b',
    full_access: '#ff6b6b'
  }[frame.permissionMode]
  useEffect(() => {
    if (fullScreen) stdout.write(terminalTitle(topic, working))
  }, [stdout, fullScreen, topic, working])
  // 0.5.2：常驻上下文用量。刷新点很少（每回合结束/清空），不参与流式重绘。
  const [contextInfo, setContextInfo] = useState<
    { usedTokens?: number; maxTokens?: number; percentUsed?: number; source: 'provider' | 'none' } | undefined
  >(undefined)
  useEffect(() => {
    const read = commandContext.contextUsage?.usage()
    // 0.5.4：没有真实用量（source=none）时就不显示，绝不用估算顶替。
    setContextInfo(read && read.source === 'provider' ? {
      ...(read.usedTokens === undefined ? {} : { usedTokens: read.usedTokens }),
      ...(read.maxTokens === undefined ? {} : { maxTokens: read.maxTokens }),
      ...(read.percentUsed === undefined ? {} : { percentUsed: read.percentUsed }),
      source: read.source
    } : undefined)
  }, [commandContext.contextUsage, frame.status.state, frame.transcript.length])
  // SP006 §4.4：外部状态栏命令（可选）。触发源只有「最后一条消息 / 权限模式 /
  // 模型」变化，300ms 去抖；失败静默回落到内置状态栏。
  const [statusConfig] = useState(() => {
    try {
      return commandContext.configStore.load().statusLine
    } catch {
      // A corrupt config already has a backup; the footer just stays built-in.
      return undefined
    }
  })
  const statusTrigger = useMemo(() => {
    const last = frame.transcript.at(-1)
    const lastKey = last === undefined
      ? 'empty'
      : last.kind === 'tool'
        ? 'tool:' + last.callId + ':' + last.status
        : last.kind + ':' + last.text.length
    return [lastKey, frame.permissionMode, frame.transcript.length].join('|')
  }, [frame.transcript, frame.permissionMode])
  const statusView = useStatusLine({
    spec: statusConfig === undefined
      ? undefined
      : { command: statusConfig.command, args: statusConfig.args, timeoutMs: statusConfig.timeoutMs },
    trigger: statusTrigger,
    state: {
      sessionId: session.id,
      transcriptPath: join(sessionDirectory(session.id), TRANSCRIPT_FILE),
      cwd: cwd ?? process.cwd(),
      permissionMode: frame.permissionMode,
      model: { id: commandContext.getConfig().model, displayName: commandContext.getConfig().model },
      workspace: { currentDir: cwd ?? process.cwd(), projectDir: cwd ?? process.cwd() },
      version,
      contextWindow: {
        ...(contextInfo?.usedTokens === undefined ? {} : { usedTokens: contextInfo.usedTokens }),
        ...(contextInfo?.maxTokens === undefined ? {} : { windowSize: contextInfo.maxTokens })
      }
    }
  })
  const showStatusLine = statusConfig !== undefined && statusView.text !== undefined && statusView.text !== ''
  const footerHeight = (planLayout({ columns: width, rows, regions: regionsFor({ headerVisible: false }) })
    .regions.find((region) => region.id === 'footer')?.height ?? 1) + (showStatusLine ? 1 : 0)
  // 0.5.2：推理强度指示。每次渲染直接读取（开销可忽略），
  // 这样 /effort 改完立刻反映到状态栏。
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (frame.startedAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [frame.startedAt])
  const [hint, setHint] = useState('')
  // SP009 0.9.1：/reload-skills 递增该修订号，触发补全与帮助重新发现技能。
  const [skillsRevision, setSkillsRevision] = useState(0)
  const [dialog, setDialog] = useState<DiffDialog | null>(null)
  const [gitAvailable, setGitAvailable] = useState(false)
  const [detailScroll, setDetailScroll] = useState(0)
  const diffDetailPageSize = Math.max(1, Math.min(24, rows - 5))
  const [approvalScroll, setApprovalScroll] = useState(0)
  useEffect(() => setApprovalScroll(0), [frame.approval?.requestId])
  // SP006 §6.3：命令确认（/worktree remove 等）与 local-jsx 只读列表、/btw 回答回显。
  const [commandConfirm, setCommandConfirm] = useState<
    { summary: string; preview: string[]; resolve: (approved: boolean) => void } | undefined
  >()
  const [commandOverlay, setCommandOverlay] = useState<{ title: string; lines: string[] } | undefined>()
  const [sideAnswer, setSideAnswer] = useState<string | undefined>()
  const [overlayDismissed, setOverlayDismissed] = useState(false)
  const [completionIndex, setCompletionIndex] = useState(0)
  const fileCache = useRef<string[] | null>(null)
  // SP003 T18c: rejection may carry feedback back to the model, like the
  // reference's "and tell budingx what to do differently" path.
  const [rejectEntry, setRejectEntry] = useState<{ requestId: string; text: string } | null>(null)
  // SP004 T15 四类卡片：展开、计划焦点/正文编辑与追问作答状态。
  const [commandExpanded, setCommandExpanded] = useState(false)
  const [todosExpanded, setTodosExpanded] = useState(false)
  const [planFocus, setPlanFocus] = useState(0)
  const [planEditing, setPlanEditing] = useState<{ requestId: string } | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [questionCursor, setQuestionCursor] = useState(0)
  const [questionSelections, setQuestionSelections] = useState<Record<string, string[]>>({})
  const [questionOther, setQuestionOther] = useState<Record<string, string>>({})
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({})
  const [editingQuestionNotes, setEditingQuestionNotes] = useState(false)
  const [questionError, setQuestionError] = useState<string>()
  useEffect(() => {
    setCommandExpanded(false)
  }, [frame.command?.callId])
  useEffect(() => {
    setPlanFocus(0)
  }, [frame.plan?.planId])
  useEffect(() => {
    setQuestionIndex(0)
    setQuestionCursor(0)
    setQuestionSelections({})
    setQuestionOther({})
    setQuestionNotes({})
    setEditingQuestionNotes(false)
    setQuestionError(undefined)
  }, [frame.question?.questionId])
  const pendingQuestion = frame.question?.state === 'pending' ? frame.question : undefined
  const activeQuestion = pendingQuestion?.questions[questionIndex]
  const questionReviewNeeded = pendingQuestion !== undefined &&
    (pendingQuestion.questions.length > 1 || pendingQuestion.questions[0]?.multiSelect === true)
  const questionReview = pendingQuestion !== undefined && questionIndex === pendingQuestion.questions.length
  const questionOtherFocused = pendingQuestion?.allowFreeText === true &&
    activeQuestion !== undefined && questionCursor === activeQuestion.options.length
  const questionAnswers = Object.fromEntries((pendingQuestion?.questions ?? []).map((item) => {
    const values = questionSelections[item.question] ?? []
    const custom = questionOther[item.question]?.trim()
    return [item.question, custom && (item.multiSelect || values.length === 0)
      ? [...values, custom].join(', ')
      : values.join(', ')]
  }))

  function appendQuestionText(value: string) {
    if (!value || activeQuestion === undefined) return
    if (!editingQuestionNotes && !questionOtherFocused) return
    const question = activeQuestion.question
    const setText = editingQuestionNotes ? setQuestionNotes : setQuestionOther
    setText((drafts) => ({
      ...drafts,
      [question]: (drafts[question] ?? '') + value.replace(/[\r\n]+/g, ' ')
    }))
    if (!editingQuestionNotes && !activeQuestion.multiSelect) {
      setQuestionSelections((selections) => ({ ...selections, [question]: [] }))
    }
    setQuestionError(undefined)
  }
  const editor = useMemo(() => new EditorBuffer(), [])
  const query = search?.text.toLowerCase()
  const inputMatches = search && !transcriptMode
    ? editor.history.filter((item) => item.toLowerCase().includes(query ?? '')).toReversed()
    : []
  const messageMatches = query && transcriptMode
    ? frame.transcript.flatMap((entry, index) => {
        const text = entry.kind === 'tool' ? entry.text + '\n' + (entry.result ?? '') : entry.text
        return text.toLowerCase().includes(query) ? [index] : []
      }).reverse()
    : []
  const inputMatch = search ? inputMatches[search.index % Math.max(1, inputMatches.length)] : undefined
  const messageMatch = search ? messageMatches[search.index % Math.max(1, messageMatches.length)] : undefined
  const [, bumpEditor] = useReducer((n: number) => n + 1, 0)
  const ctrlC = useRef(0)
  const pick = (a: string, b: string) => (zh ? a : b)
  const effort = commandContext.effort
  const [effortIndex, setEffortIndex] = useState<number>()
  // 0.5.4：上下文占用用「饼图字形 + 百分比」显示（类似参考实现的状态栏），
  // 数据来自 Provider 真实用量，不使用估算。
  const contextPercent = contextInfo?.percentUsed
  const contextGlyph = contextPercent === undefined
    ? undefined
    : contextPercent >= 87.5 ? '●'
      : contextPercent >= 62.5 ? '◕'
        : contextPercent >= 37.5 ? '◑'
          : contextPercent >= 12.5 ? '◔'
            : '○'
  const contextLabel = contextPercent === undefined
    ? undefined
    : `${contextGlyph} ${contextPercent.toFixed(1)}%`
  const contextTone = contextInfo?.percentUsed === undefined
    ? undefined
    : contextInfo.percentUsed >= 95
      ? 'red'
      : contextInfo.percentUsed >= 80
        ? 'yellow'
        : undefined
  // 0.5.2：推理强度指示，参考实现把 effort 常驻在底部状态栏。
  const effortLabel = effort === undefined
    ? undefined
    : `${pick('⊙', '*')} ${effortDisplayLabel(effort.current(), zh)} · /effort`
  // SP006 波次 G：建议文本由模型按当前对话生成，不再用固定话术；
  // 生成未完成、被清空或用户已开始输入时不显示。
  const suggestion = !working && !input && frame.suggestFollowUp ? suggestionText : ''
  const inputBox = useRef<DOMElement>(null)
  const { setCursorPosition } = useCursor()
  const [cursorPosition, setPosition] = useState<{ x: number; y: number } | undefined>(
    undefined
  )
  setCursorPosition(transcriptMode || search ? undefined : cursorPosition)
  const commands = useRef<string[]>([])
  const [commandCount, setCommandCount] = useState(0)
  const queuePreviewRows = fullScreen ? Math.max(1, Math.min(3, Math.floor(rows / 12))) : frame.queue.length
  const hiddenQueued = Math.max(0, frame.queue.length - queuePreviewRows)
  const chain = useRef(Promise.resolve())
  const pendingActions = useRef(0)
  const managerDone = useRef<(() => void) | undefined>(undefined)
  const managerInput = useRef<{ key: (text: string, key: Key) => void; paste: (text: string) => void } | undefined>(undefined)
  const [modelManagerOpen, setModelManagerOpen] = useState(false)
  const [rulesManagerOpen, setRulesManagerOpen] = useState(false)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [rewindOpen, setRewindOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [doctorOpen, setDoctorOpen] = useState(false)
  // SP007 T9：子代理卡片状态（agent_* 事件驱动）与图片附件（MM-05）。
  const [agentCards, setAgentCards] = useState<Map<string, AgentCardInput>>(() => new Map())
  const [pastedImages, setPastedImages] = useState<
    Map<number, { mediaType: string; data: string; width?: number; height?: number; hash?: string }>
  >(() => new Map())
  const nextImageId = useRef(1)
  const lastEscRef = useRef(0)
  const [typing, setTyping] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const markTyping = () => {
    setTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setTyping(false), 700)
  }
  // SP007 MM-01 补：把已准备好的图片挂为附件。粘贴键与 /image 命令共用同一条
  // 路径，保证「同一个 [Image #N] 占位、同一份提交时收集逻辑」。
  const attachPreparedImage = (prepared: {
    mediaType: string
    data: string
    width?: number
    height?: number
    resized?: boolean
  }) => {
    // 同一张图重复粘贴（用户连按 alt+v）不该变成两次上传：内容相同时复用
    // 已有占位，输入区不出现 [Image #1][Image #2]。
    const hash = createHash('sha256').update(prepared.data).digest('hex')
    for (const [existingId, existing] of pastedImages) {
      if (existing.hash !== hash) continue
      if (editor.text.includes(`[Image #${existingId}]`)) {
        setHint(pick('该图片已在附件中', 'Image already attached'))
        return
      }
    }
    const id = nextImageId.current++
    setPastedImages((previous) => new Map(previous).set(id, { ...prepared, hash }))
    imageCache?.put(id, prepared.mediaType, Buffer.from(prepared.data, 'base64'))
    editor.insert(`[Image #${id}]`)
    setInput(editor.text)
    bumpEditor()
    markTyping()
    setHint(prepared.resized
      ? pick('图片已压缩并附件', 'Image resized and attached')
      : pick('图片已附件', 'Image attached'))
  }
  useEffect(
    () => () => {
      mounted.current = false
      clearTimeout(typingTimer.current)
      clearTimeout(deltaTimer.current)
      managerDone.current?.()
      suggestionAbort.current?.abort()
      gateway.cancelAll()
    },
    [gateway]
  )
  const [, bumpConfig] = useReducer((n: number) => n + 1, 0)
  const context = {
    ...commandContext,
    ...(commandContext.cwd || !cwd ? {} : { cwd }),
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
      const result = await runCommand(text, {
        ...context,
        session,
        interactive: true,
        // 命令级确认：复用页脚 y/n 交互，不经过模型工具审批通道。
        confirm: (request) =>
          new Promise<boolean>((resolve) => {
            setCommandConfirm({ ...request, resolve })
          })
      })
      if (result.exit) {
        leave()
        return
      }
      if (result.openEffort && effort) {
        setHint('')
        setEffortIndex(Math.max(0, effort.choices.indexOf(effort.current())))
        return
      }
      if (result.openModels) {
        setPosition(undefined)
        setModelManagerOpen(true)
        await new Promise<void>((resolve) => {
          managerDone.current = resolve
        })
      } else if (result.openRules) {
        setPosition(undefined)
        setRulesManagerOpen(true)
        await new Promise<void>((resolve) => {
          managerDone.current = resolve
        })
      } else if (result.openExport) {
        setPosition(undefined)
        setExportOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.skillsReloaded !== undefined) {
        // SP009 0.9.1 SA-07：刷新补全列表、帮助与 /skills 面板，不重启。
        setSkillsRevision((revision) => revision + 1)
        setHint(result.message ?? result.error ?? '')
      } else if (result.openResume) {
        setPosition(undefined)
        setResumeOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openRewind) {
        setPosition(undefined)
        setRewindOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openContext) {
        setPosition(undefined)
        setContextOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openAgents) {
        setPosition(undefined)
        setAgentsOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openStatus) {
        setPosition(undefined)
        setStatusOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openStats) {
        setPosition(undefined)
        setStatsOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.openDoctor) {
        setPosition(undefined)
        setDoctorOpen(true)
        await new Promise<void>((resolve) => { managerDone.current = resolve })
      } else if (result.attachImage) {
        // SP007 MM-01 补：/image 把剪贴板/路径图片挂进输入区。
        attachPreparedImage(result.attachImage)
      } else if (result.skillPrompt) {
        // SP009：技能正文作为上下文块交给模型，不在会话里回显提示词。
        setHint(pick(`技能 /${result.skillPrompt.name} 已加载`, `Skill /${result.skillPrompt.name} loaded`))
        session.submit(`/${result.skillPrompt.name}`, {
          context: [{ source: `skill:${result.skillPrompt.name}`, content: result.skillPrompt.body }]
        })
      } else if (result.prompt) {
        setSideAnswer(undefined)
        if (result.prompt.progress) setHint(result.prompt.progress)
        session.submit(result.prompt.text)
      } else if (result.sideQuestion) {
        setSideAnswer(pick('正在旁路提问…', 'Asking on the side…'))
        const answer = await session.submitSideQuestion(result.sideQuestion)
        setSideAnswer(
          answer.ok
            ? pick('旁路回答（未写入会话）：', 'Side answer (not stored):') + '\n' + answer.text
            : pick('旁路提问失败：', 'Side question failed: ') + (answer.error ?? '')
        )
      } else if (result.openList) {
        setPosition(undefined)
        setCommandOverlay(result.openList)
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
  // 0.5.4：/ 补全包含内置命令 + 已加载技能命令（对齐参考）。
  const commandList = useMemo(
    () => [...COMMAND_NAMES, ...discoverSkillCommands().map((s) => s.name)],
    // skillsRevision：/reload-skills 后重新纳入新技能命令。
    [context, skillsRevision]
  )
  const completion = useMemo(() => {
    if (dialog || frame.approval || overlayDismissed || modelManagerOpen || rulesManagerOpen || resumeOpen || exportOpen || rewindOpen || contextOpen || agentsOpen || statusOpen || statsOpen || doctorOpen) return null
    const lineText = editor.lines[editor.cursor.line] ?? ''
    const token = activeToken(lineText, editor.cursor.col, commandList)
    if (!token) return null
    if (token.kind === 'command') {
      const candidates = commandCandidates(token.token, commandList)
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
  /**
   * SP006 波次 G：回合完成后异步生成「用户下一句可能输入什么」的建议。
   * 生成失败、超时、被新回合打断都静默丢弃，绝不阻塞主流程，也不影响模型上下文。
   */
  const requestSuggestion = useCallback(() => {
    suggestionAbort.current?.abort()
    suggestionAbort.current = undefined
    setSuggestionText('')
    if (!suggestNextPrompt) return
    const controller = new AbortController()
    suggestionAbort.current = controller
    void suggestNextPrompt(controller.signal)
      .then((text) => {
        if (controller.signal.aborted || !mounted.current) return
        if (session.isBusy || !editor.isEmpty) return
        setSuggestionText(text ?? '')
      })
      .catch(() => {})
  }, [suggestNextPrompt, session, editor])
  const clearSuggestion = useCallback(() => {
    suggestionAbort.current?.abort()
    suggestionAbort.current = undefined
    setSuggestionText('')
  }, [])
  const submitPrompt = (text: string) => {
    if (!context.getConfig().model.trim()) {
      setHint(pick('请先配置并选择模型', 'Configure and select a model first'))
      return
    }
    clearSuggestion()
    const permission = commandContext.permission
    setTopic((previous) => previous ?? sessionTopic(text, context.getConfig().apiKey))
    // SP007 MM-03/MM-05：路径附件转占位＋收集已粘贴图片，随 SubmitOptions.images 发送。
    let outgoing = text
    const images: { id: number; mediaType: string; data: string; width?: number; height?: number }[] = []
    const consumed = new Set<number>()
    const pushImage = (id: number, prepared: { mediaType: string; data: string; width?: number; height?: number }) => {
      images.push({
        id,
        mediaType: prepared.mediaType,
        data: prepared.data,
        ...(prepared.width !== undefined ? { width: prepared.width } : {}),
        ...(prepared.height !== undefined ? { height: prepared.height } : {})
      })
      consumed.add(id)
    }
    // 同一张图（同内容哈希）在这次提交里只上传一次：连按粘贴、或用不同写法
    // 指向同一个文件，都复用最先分配的占位 id。
    const keptByHash = new Map<string, number>()
    for (const [existingId, existing] of pastedImages) {
      if (existing.hash && outgoing.includes(`[Image #${existingId}]`)) keptByHash.set(existing.hash, existingId)
    }
    for (const match of extractImagePaths(outgoing)) {
      try {
        const file = readImageFile(match.path)
        const prepared = prepareImage(file.data, file.mediaType)
        const hash = createHash('sha256').update(prepared.data).digest('hex')
        const kept = keptByHash.get(hash)
        if (kept !== undefined) {
          outgoing = outgoing.replaceAll(match.token, `[Image #${kept}]`)
          continue
        }
        const id = nextImageId.current++
        keptByHash.set(hash, id)
        setPastedImages((previous) => new Map(previous).set(id, { ...prepared, hash }))
        imageCache?.put(id, prepared.mediaType, Buffer.from(prepared.data, 'base64'))
        outgoing = outgoing.replaceAll(match.token, `[Image #${id}]`)
        pushImage(id, prepared)
      } catch (error) {
        // MM-10：图片读不到时明确报错，但绝不静默吞掉用户已经写好的正文——
        // Enter 提交时输入区已清空，这里把原文放回去，用户可改路径后重发。
        editor.setText(text)
        setInput(editor.text)
        bumpEditor()
        setHint(String((error as Error).message))
        return
      }
    }
    for (const match of outgoing.matchAll(/\[Image #(\d+)\]/g)) {
      const id = Number(match[1])
      if (consumed.has(id)) continue
      const existing = pastedImages.get(id)
      if (existing) pushImage(id, existing)
    }
    const base = permission
      ? workspacePromptOptions(outgoing, permission.workspace, permission.policy)
      : undefined
    session.submit(outgoing, { ...(base ?? {}), ...(images.length ? { images } : {}) })
    if (consumed.size > 0) {
      setPastedImages((previous) => {
        const next = new Map(previous)
        for (const id of consumed) next.delete(id)
        return next
      })
    }
  }
  // Pending stream deltas, flushed once per frame. Anything that is not a
  // delta flushes first so text is never reordered against completion/tool
  // events.
  const pendingDeltas = useRef<{ event: SessionEvent; toolElapsedMs?: number }[]>([])
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flushDeltas = useCallback(() => {
    if (deltaTimer.current !== undefined) {
      clearTimeout(deltaTimer.current)
      deltaTimer.current = undefined
    }
    const pending = pendingDeltas.current
    if (pending.length === 0) return
    pendingDeltas.current = []
    for (const action of pending) dispatch(action)
  }, [])
  const deliverEvent = useCallback((event: SessionEvent, toolElapsedMs?: number) => {
    if (event.type === 'text_delta' || event.type === 'thinking_delta') {
      pendingDeltas.current.push({ event, toolElapsedMs })
      if (deltaTimer.current === undefined) {
        deltaTimer.current = setTimeout(flushDeltas, STREAM_FRAME_MS)
        deltaTimer.current.unref?.()
      }
      return
    }
    flushDeltas()
    dispatch({ event, toolElapsedMs })
  }, [flushDeltas])
  useEffect(
    () =>
      session.on((event) => {
        const toolElapsedMs = event.type === 'tool_result'
          ? session.toolElapsedMs(event.turnId, event.callId)
          : undefined
        deliverEvent(event, toolElapsedMs)
        if (event.type === 'conversation_cleared') {
          setTopic(undefined)
          setScrollTop(undefined)
          setAgentCards(new Map())
          clearSuggestion()
        }
        if (event.type === 'conversation_restored') {
          // SP006：恢复出的历史重建了转录，滚动位置与话题都要回到新内容。
          setTopic(undefined)
          setScrollTop(undefined)
          clearSuggestion()
        }
        if (event.type === 'turn_started') clearSuggestion()
        // SP007 T9：子代理卡片由 agent_* 事件驱动（与后台 shell 六件套分离）。
        if (event.type === 'agent_started') {
          const started = event
          setAgentCards((previous) => {
            const next = new Map(previous)
            next.set(started.agentId, {
              agentId: started.agentId,
              agentType: started.agentType,
              description: started.description,
              ...(started.color ? { color: started.color } : {}),
              state: 'running',
              background: started.background,
              toolUses: 0,
              tokens: 0,
              lastTools: [],
              startedAt: Date.now()
            })
            return next
          })
        }
        if (event.type === 'agent_progress') {
          const progress = event
          setAgentCards((previous) => {
            const existing = previous.get(progress.agentId)
            if (!existing) return previous
            const next = new Map(previous)
            next.set(progress.agentId, {
              ...existing,
              toolUses: progress.toolUses,
              tokens: progress.tokens,
              lastTools: progress.lastTools,
              state: progress.state,
              background: progress.state === 'backgrounded' ? true : existing.background
            })
            return next
          })
        }
        if (event.type === 'agent_finished') {
          const finished = event
          setAgentCards((previous) => {
            const existing = previous.get(finished.agentId)
            if (!existing) return previous
            const next = new Map(previous)
            next.set(finished.agentId, {
              ...existing,
              state: finished.outcome === 'completed' ? 'completed' : finished.outcome === 'cancelled' ? 'cancelled' : 'failed',
              toolUses: finished.toolUses,
              tokens: finished.tokens,
              finishedAt: Date.now(),
              background: finished.background
            })
            return next
          })
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
          if (event.outcome === 'completed') requestSuggestion()
          else clearSuggestion()
        }
      }),
    [session, gateway, editor, deliverEvent, requestSuggestion, clearSuggestion]
  )
  usePaste((text) => {
    if (managerDone.current) {
      managerInput.current?.paste(text)
      return
    }
    if (pendingQuestion !== undefined) {
      appendQuestionText(text)
      return
    }
    if (effortIndex !== undefined) return
    if (search) {
      setSearch({ text: search.text + text.replace(/\s+/g, ' '), index: 0 })
      return
    }
    if (transcriptMode) return
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
    // 0.5.4 /rewind 快捷键 Esc+Esc：空闲且无覆盖层时双击 Esc 打开回滚面板。
    if (key.escape && !session.isBusy && editor.isEmpty && !dialog && !frame.approval &&
      !modelManagerOpen && !rulesManagerOpen && !resumeOpen && !exportOpen && !rewindOpen && !contextOpen && !agentsOpen && !statusOpen && !statsOpen && !doctorOpen && !transcriptMode && !search) {
      const now = Date.now()
      if (now - lastEscRef.current < 500) {
        lastEscRef.current = 0
        setPosition(undefined)
        setRewindOpen(true)
        managerDone.current = () => {}
        return
      }
      lastEscRef.current = now
    }
    if (pendingQuestion !== undefined) {
      if (editingQuestionNotes && (key.return || key.escape)) {
        setEditingQuestionNotes(false)
        return
      }
      if (key.escape || (key.ctrl && text === 'c')) {
        session.cancelQuestion(pendingQuestion.questionId)
        return
      }
      const maxIndex = pendingQuestion.questions.length - (questionReviewNeeded ? 0 : 1)
      const navigate = (index: number) => {
        const nextIndex = Math.max(0, Math.min(maxIndex, index))
        const next = pendingQuestion.questions[nextIndex]
        setQuestionIndex(nextIndex)
        const saved = next?.options.findIndex((option) => option.label === questionSelections[next.question]?.[0]) ?? -1
        setQuestionCursor(next && !next.multiSelect && saved < 0 && questionOther[next.question]?.trim()
          ? next.options.length
          : Math.max(0, saved))
        setQuestionError(undefined)
      }
      const submit = (answers: Record<string, string>) => {
        const annotations = Object.fromEntries(pendingQuestion.questions.flatMap((item) => {
          const notes = questionNotes[item.question]?.trim()
          const preview = item.options.find((option) => option.label === answers[item.question])?.preview
          return notes || preview ? [[item.question, { notes, preview }] as const] : []
        }))
        const result = session.answerQuestion(pendingQuestion.questionId, answers,
          Object.keys(annotations).length ? annotations : undefined)
        if (!result.ok) {
          setQuestionError(zh ? result.reason : 'Answer every question before submitting.')
        }
      }
      if (!editingQuestionNotes && (key.leftArrow || (key.tab && key.shift))) {
        navigate(questionIndex - 1)
        return
      }
      if (!editingQuestionNotes && (key.rightArrow || key.tab)) {
        navigate(questionIndex + 1)
        return
      }
      if (questionReview) {
        if (key.return) submit(questionAnswers)
        return
      }
      if (activeQuestion === undefined) return
      const title = activeQuestion.question
      const optionCount = activeQuestion.options.length + (pendingQuestion.allowFreeText ? 1 : 0)
      if (!editingQuestionNotes && (key.upArrow || key.downArrow)) {
        setQuestionCursor((cursor) => (cursor + (key.downArrow ? 1 : optionCount - 1)) % optionCount)
        return
      }
      if ((questionOtherFocused || editingQuestionNotes) && key.ctrl && text === 'v') {
        try {
          appendQuestionText(readClipboard())
        } catch {
          setQuestionError(pick('无法读取剪贴板', 'Clipboard read failed'))
        }
        return
      }
      if ((questionOtherFocused || editingQuestionNotes) && (key.backspace || key.delete)) {
        const setText = editingQuestionNotes ? setQuestionNotes : setQuestionOther
        setText((drafts) => ({
          ...drafts,
          [title]: Array.from(drafts[title] ?? '').slice(0, -1).join('')
        }))
        setQuestionError(undefined)
        return
      }
      const option = activeQuestion.options[questionCursor]
      if (editingQuestionNotes) {
        if (text && !key.ctrl && !key.meta) appendQuestionText(text)
        return
      }
      if (option?.preview && text === 'n' && !key.ctrl && !key.meta) {
        setEditingQuestionNotes(true)
        return
      }
      if (text === ' ' && option !== undefined) {
        const label = option.label
        setQuestionSelections((selections) => {
          const picked = selections[title] ?? []
          const values = !activeQuestion.multiSelect ? [label] : picked.includes(label)
            ? picked.filter((value) => value !== label)
            : [...picked, label]
          return { ...selections, [title]: values }
        })
        setQuestionError(undefined)
        return
      }
      if (key.return) {
        const answer = activeQuestion.multiSelect
          ? questionAnswers[title]
          : questionOtherFocused ? questionOther[title]?.trim() : option?.label
        if (!answer) {
          setQuestionError(pick('请选择选项或输入自定义答案', 'Select an option or type a custom answer'))
          return
        }
        if (!activeQuestion.multiSelect) {
          setQuestionSelections((selections) => ({ ...selections, [title]: option ? [option.label] : [] }))
          if (option) setQuestionOther((drafts) => ({ ...drafts, [title]: '' }))
        }
        if (questionReviewNeeded) navigate(questionIndex + 1)
        else submit({ [title]: answer })
        return
      }
      if (text && !key.ctrl && !key.meta) appendQuestionText(text)
      return
    }
    if (effortIndex !== undefined && effort) {
      if (key.escape || (key.ctrl && text === 'c')) {
        setEffortIndex(undefined)
      } else if (key.upArrow || key.downArrow) {
        const count = effort.choices.length
        const delta = key.downArrow ? 1 : count - 1
        setEffortIndex((index) => ((index ?? 0) + delta) % count)
      } else if (key.return) {
        const choice = effort.choices[effortIndex]
        if (choice !== undefined) {
          effort.set(choice)
          setHint(pick(
            `思考强度已设为${effortDisplayLabel(choice, true)}（下一次请求生效）`,
            `Reasoning effort set to ${choice} (applies to the next request)`
          ))
        }
        setEffortIndex(undefined)
      }
      return
    }
    // SP007 MM-01/MM-02：把剪贴板图片挂为附件（[Image #N]），返回是否成功。
    const attachClipboardImage = (): boolean => {
      // 剪贴板读取可被宿主替换（测试注入）；产品默认读系统剪贴板。
      const readClip = context.imageSource?.clipboard ?? readClipboardImage
      const clip = readClip()
      if (!clip) return false
      try {
        attachPreparedImage(prepareImage(clip.data, clip.mediaType))
      } catch (error) {
        setHint(String((error as Error).message))
      }
      return true
    }
    // SP007 MM-01/MM-02：图片粘贴键（Windows alt+v，其他平台 ctrl+v）。
    const imagePastePressed = (process.platform === 'win32' ? key.meta : key.ctrl) && text === 'v'
    if (imagePastePressed && !rejectEntry && !dialog && !search && !transcriptMode && pendingQuestion === undefined) {
      if (attachClipboardImage()) return
      if (process.platform === 'win32') {
        setHint(pick('剪贴板没有图片', 'No image in clipboard'))
        return
      }
      // 非 Windows ctrl+v 无图 → 落到下方文本粘贴 fallback。
    }
    // SP007 SA-09：ctrl+b 将运行中代理转后台（解除父信号，终态通知注入主循环）。
    if (key.ctrl && text === 'b' && !rejectEntry && !dialog && !search && !transcriptMode) {
      const agents = commandContext.agents
      if (agents) {
        const running = agents.list().filter((record) => record.state === 'running')
        let backgrounded = 0
        for (const record of running) if (agents.background(record.callId)) backgrounded++
        setHint(backgrounded > 0
          ? pick(`已后台化 ${backgrounded} 个代理（↓ 管理）`, `Backgrounded ${backgrounded} agent(s) (↓ manage)`)
          : pick('没有运行中的代理', 'No running agents'))
      }
      return
    }
    // Ctrl+V paste fallback for terminals without bracketed-paste support
    // (legacy Windows conhost / cmd). Ink's usePaste relies on DEC 2004
    // which these terminals ignore, so Ctrl+V arrives as a plain ctrl+v
    // keypress. Read the system clipboard and insert it directly.
    if (key.ctrl && text === 'v' && !rejectEntry && !dialog && !search && !transcriptMode) {
      let clip = ''
      try {
        clip = readClipboard()
      } catch {
        setHint(pick('无法读取剪贴板', 'Clipboard read failed'))
        return
      }
      if (clip) {
        editor.insert(clip)
        setInput(editor.text)
        bumpEditor()
        markTyping()
        return
      }
      // 剪贴板里没有文本但有图片时，ctrl+v 也按图片附件处理：Windows 主键位是
      // alt+v（MM-01），但多数终端用户会先按 ctrl+v，空文本静默丢弃最像「没实现」。
      if (pendingQuestion === undefined) attachClipboardImage()
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
        const hunks = dialogEntries[dialog.index]?.hunks ?? []
        const count = diffViewLines(hunks, Math.max(1, width - 2), true).length
        setDetailScroll((s) => Math.min(s + 1, Math.max(0, count - diffDetailPageSize)))
      }
      return
    }
    if (fullScreen && key.ctrl && text === 'o') {
      setSearch(undefined)
      if (transcriptMode) setScrollTop(undefined)
      setTranscriptMode((current) => !current)
      return
    }
    if (search) {
      if (key.escape) setSearch(undefined)
      else if (key.return) {
        if (inputMatch !== undefined) {
          editor.setText(inputMatch)
          setInput(editor.text)
          bumpEditor()
        }
        setSearch(undefined)
      } else if (key.backspace) {
        setSearch({ text: Array.from(search.text).slice(0, -1).join(''), index: 0 })
      } else if (key.upArrow || (key.ctrl && text === 'r')) {
        setSearch({ ...search, index: search.index + 1 })
      } else if (key.downArrow) {
        const count = Math.max(1, transcriptMode ? messageMatches.length : inputMatches.length)
        setSearch({ ...search, index: (search.index + count - 1) % count })
      } else if (text && !key.ctrl && !key.meta) {
        setSearch({ text: search.text + text, index: 0 })
      }
      return
    }
    if (!transcriptMode && !frame.approval && key.ctrl && text === 'r') {
      setSearch({ text: '', index: 0 })
      return
    }
    if (fullScreen && key.ctrl && key.end) {
      setScrollTop(undefined)
      return
    }
    if (fullScreen && (key.pageUp || key.pageDown)) {
      const page = Math.max(1, viewport.clientHeight - 1)
      scrollHistory(key.pageUp ? -page : page)
      return
    }
    if (transcriptMode) {
      if (key.escape) {
        setTranscriptMode(false)
        setScrollTop(undefined)
      }
      else if (text === '/') setSearch({ text: '', index: 0 })
      return
    }
    if (planEditing !== null && !typing) {
      if (key.escape) {
        setPlanEditing(null)
        editor.setText('')
        setInput('')
        return
      }
      if (key.return) {
        gateway.resolve(planEditing.requestId, 'allow', 'user', undefined, editor.text.trim())
        setPlanEditing(null)
        return
      }
    }
    if (commandConfirm) {
      if (key.escape || (text && text.toLowerCase() === 'n')) {
        commandConfirm.resolve(false)
        setCommandConfirm(undefined)
        return
      }
      if (text && text.toLowerCase() === 'y') {
        commandConfirm.resolve(true)
        setCommandConfirm(undefined)
        return
      }
      return
    }
    if (commandOverlay) {
      if (key.escape) setCommandOverlay(undefined)
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
    if (key.ctrl && text === 'e') {
      // 运行中的命令只显示单行，不接受展开，避免展开状态延续到完成态。
      if (activeCommandCard(frame.command) === undefined) {
        setCommandExpanded((value) => !value)
      }
      setTodosExpanded((value) => !value)
      return
    }
    if (frame.plan !== undefined && frame.plan.mode !== 'idle' && !typing && editor.isEmpty &&
      (key.upArrow || key.downArrow)) {
      const count = Math.max(1, frame.plan.steps.length)
      setPlanFocus((focus) => (focus + (key.upArrow ? count - 1 : 1)) % count)
      return
    }
    if (approval !== undefined && approval.planId !== undefined && !typing && editor.isEmpty && text === 'e') {
      const seed = frame.plan !== undefined
        ? [frame.plan.goal, ...frame.plan.steps.map((step) => `${step.id} ${step.title}`)].join('；')
        : ''
      editor.setText(seed)
      setInput(editor.text)
      bumpEditor()
      setPlanEditing({ requestId: approval.requestId })
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
      // 0.5.4：选中命令后回车直接执行。先把补全写满整条命令，再走正常提交路径
      // （保留 /diff 等提交期拦截），而不是仅插入文本等待二次回车。
      if (key.return && completion.token.kind === 'command') {
        const chosen = completion.candidates[completionIndexSafe]
        if (chosen) {
          const lineText = editor.lines[editor.cursor.line] ?? ''
          editor.lines[editor.cursor.line] = applyCompletion(lineText, completion.token, chosen, false)
          editor.cursor.col = Array.from(editor.lines[editor.cursor.line]).length
          setInput(editor.text)
          bumpEditor()
          // 不 return：继续走 applyKey→submit，立即执行该命令。
        }
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
      // 选项编号与按键必须始终一致：2 不可用时 2 表示拒绝，而不是留下空洞（0.5.4）。
      const rememberable = session.canRememberApproval(approval.requestId)
      // SP003 AC PC-06: 1 allow once, 2 allow for session, 3 deny (+feedback).
      if (text === '1') {
        gateway.resolve(approval.requestId, 'allow')
        return
      }
      if (text === '2' && rememberable) {
        gateway.resolve(approval.requestId, 'allow_session')
        return
      }
      if (text === '2' || (text === '3' && rememberable)) {
        setRejectEntry({ requestId: approval.requestId, text: '' })
      }
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
      // 0.5.4：Shift+Tab 稳定轮播三档权限（规划模式改由 /plan 进入/退出，避免卡审批）。
      if (session.planMode.active) session.leavePlanMode()
      // SP003 design §3.8: cycle the three fixed modes.
      const next = nextMode(permissionHandles.policy.getMode())
      if (!changePermissionMode(permissionHandles, next)) {
        setHint(pick(
          '此会话已切换权限模式，但无法保存启动模式',
          'Permission mode changed for this session. Could not save the startup mode.'
        ))
        return
      }
      setHint(
        pick(`权限模式：${interactiveModeLabel(next, 'zh')}`, `Permission mode: ${interactiveModeLabel(next, 'en')}`)
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
  useWheel(fullScreen, (lines) => {
    if (!modelManagerOpen && !rulesManagerOpen && !resumeOpen && !exportOpen && !rewindOpen && !contextOpen && !agentsOpen && !statusOpen && !statsOpen && !doctorOpen && !dialog) scrollHistory(lines)
  })
  const config = commandContext.getConfig()
  const footerHint = setupHint(config, strategy)
  if (resumeOpen) {
    return <ResumePicker context={{ ...context, session }} input={managerInput} onPick={(id) => {
      const done = managerDone.current; setResumeOpen(false); managerDone.current = undefined; done?.()
      executeRef.current(`/resume ${id}`)
    }} close={(notice) => {
      const done = managerDone.current; setResumeOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (exportOpen) {
    return <ExportPicker context={{ ...context, session }} current={{ id: session.id, history: session.history }} input={managerInput} close={(notice) => {
      const done = managerDone.current; setExportOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (rewindOpen) {
    return <RewindPicker context={{ ...context, session }} input={managerInput} onPick={(id) => {
      const done = managerDone.current; setRewindOpen(false); managerDone.current = undefined; done?.()
      const result = session.rewindTo(id)
      let undone = 0
      for (let i = 0; i < result.removedTurns; i++) { const o = context.permission?.undo(); if (o?.undone) undone++; else break }
      setHint(pick(`已回滚 ${result.removedMessages} 条消息，撤销 ${undone} 个回合的文件改动`, `Rewound ${result.removedMessages} messages, undone ${undone} turns of file changes`))
    }} close={(notice) => {
      const done = managerDone.current; setRewindOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (contextOpen) {
    return <ContextGrid context={{ ...context, session }} input={managerInput} close={(notice) => {
      const done = managerDone.current; setContextOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (agentsOpen) {
    return <AgentsMenu context={{ ...context, session }} input={managerInput}
      cwd={commandContext.cwd ?? process.cwd()} home={commandContext.home ?? homedir()}
      close={(notice) => {
        const done = managerDone.current; setAgentsOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
      }} />
  }
  if (statusOpen) {
    return <StatusDialog context={{ ...context, session }} input={managerInput} close={(notice) => {
      const done = managerDone.current; setStatusOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (statsOpen) {
    return <StatsDialog context={{ ...context, session }} input={managerInput} close={(notice) => {
      const done = managerDone.current; setStatsOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (doctorOpen) {
    return <DoctorDialog context={{ ...context, session }} input={managerInput} close={(notice) => {
      const done = managerDone.current; setDoctorOpen(false); setHint(notice ?? ''); managerDone.current = undefined; done?.()
    }} />
  }
  if (rulesManagerOpen) {
    return <RulesManager context={{ ...context, session }} input={managerInput} close={(notice) => {
      const done = managerDone.current
      setRulesManagerOpen(false)
      setHint(notice ?? '')
      managerDone.current = undefined
      done?.()
    }} />
  }
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
    const lines = diffViewLines(hunks, Math.max(1, width - 2), true, entry?.path)
    const first = Math.min(detailScroll, Math.max(0, lines.length - diffDetailPageSize))
    const visible = lines.slice(first, first + diffDetailPageSize)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>
          ── {entry?.path ?? ''} · {sourceLabel(dialog.source)} ──
        </Text>
        {visible.map((line, index) => (
          <Text key={first + index}>
            {line.spans.map((span, j) => (
              <Text
                key={j}
                color={
                  span.color ?? (span.kind === 'add'
                    ? 'green'
                    : span.kind === 'remove'
                      ? 'red'
                      : span.kind === 'header'
                        ? 'cyan'
                        : undefined)
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
  // SP004 T15：四类卡片按 追问 → 计划 → 待办 → 命令 的顺序显示，行宽与终端一致。
  const cardLines: { key: string; dim: boolean; lines: string[] }[] = []
  if (frame.question !== undefined) {
    cardLines.push({
      key: 'question',
      dim: false,
      lines: questionCardLines(frame.question, width, {
        questionIndex,
        cursor: questionCursor,
        selected: activeQuestion === undefined
          ? {}
          : { [activeQuestion.question]: questionSelections[activeQuestion.question] ?? [] },
        otherDraft: activeQuestion === undefined ? undefined : questionOther[activeQuestion.question],
        questionNotes: activeQuestion === undefined ? undefined : questionNotes[activeQuestion.question],
        editingQuestionNotes,
        reviewAnswers: questionReview ? questionAnswers : undefined,
        questionError,
        zh
      })
    })
  }
  if (frame.plan !== undefined) {
    cardLines.push({
      key: 'plan',
      dim: true,
      lines: planCardLines(frame.plan, width, { focusIndex: planFocus, zh })
    })
  }
  if (frame.todos !== undefined) {
    cardLines.push({
      key: 'todos',
      dim: true,
      lines: todoCardLines(frame.todos, width, { expanded: todosExpanded, now, zh })
    })
  }
  const liveCommand = working ? activeCommandCard(frame.command) : undefined
  if (liveCommand !== undefined) {
    cardLines.push({
      key: 'command',
      dim: true,
      lines: commandCardLines(liveCommand, width, { compact: true, zh })
    })
  } else if (commandExpanded && frame.command !== undefined) {
    // 完成态默认不占位；只有用户按 Ctrl+E 才展开完整输出。
    cardLines.push({
      key: 'command',
      dim: true,
      lines: commandCardLines(frame.command, width, { expanded: true, zh })
    })
  }
  const menuRows = 9
  const menuTotal = completion?.candidates.length ?? 0
  const menuStart = completion
    ? Math.max(0, Math.min(completionIndexSafe - Math.floor(menuRows / 2), menuTotal - menuRows))
    : 0
  const menuVisible = completion ? completion.candidates.slice(menuStart, menuStart + menuRows) : []
  const completionMenu = completion && (
    <Box flexDirection="column">
      {menuVisible.map((candidate, i) => {
        const index = menuStart + i
        const desc = candidate.kind === 'command' ? commandDescription(candidate.value, zh ? 'zh' : 'en') : ''
        return (
          <Text key={candidate.value} inverse={index === completionIndexSafe}>
            {(completion.token.kind === 'command' ? '/' : '@') + candidate.value}
            {candidate.directory
              ? pick('  [目录]', '  [dir]')
              : desc
                ? '  ' + desc
                : ''}
          </Text>
        )
      })}
      <Text dimColor>
        {completion.token.kind === 'command'
          ? pick('↑↓ 选择 · Enter 执行 · Tab 插入 · Esc 关闭', 'up/down · Enter run · tab insert · esc dismiss')
          : pick('↑↓ 选择 · Tab 插入 · Esc 关闭', 'up/down select · tab insert · esc dismiss')}
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column" height={fullScreen ? rows : undefined}>
      <Box
        ref={transcriptBox}
        flexDirection="column"
        flexGrow={fullScreen ? 1 : undefined}
        flexBasis={fullScreen ? 0 : undefined}
        overflowY={fullScreen ? 'hidden' : undefined}
        contentOffsetY={fullScreen ? offset : undefined}
      >
        <Box ref={transcriptContent} flexDirection="column" flexShrink={0}>
          <Box ref={transcriptHeader} flexDirection="column" flexShrink={0}>
            {renderHeader({
              version,
              model: config.model,
              baseUrl: config.baseUrl,
              keyPresent: !!config.apiKey.trim(),
              cwd,
              columns: width,
              strategy,
              compact: fullScreen
            }).slice(0, fullScreen ? (rows < 8 ? 1 : rows < 18 ? 3 : undefined) : undefined).map((line, i) => (
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
          <HistoryWindow entries={displayedHistory} width={width} height={viewport.clientHeight}
            offset={Math.max(0, offset - headerMetrics.height)} fullScreen={fullScreen}
            ascii={!zh} expanded={transcriptMode}
            targetIndex={messageMatch} onTargetOffset={revealHistory} onPriorRowsChanged={correctPriorRows} />
          {liveEntry && (
            <TranscriptMessage entry={liveEntry} ascii={!zh} />
          )}
          {previewTools.map((name, index) => (
            <Text key={index} color={ACCENT} wrap="truncate-end">
              {pick('● ', '* ')}{name}{pick(' · 接收参数…', ' · Receiving arguments…')}
            </Text>
          ))}
          {frame.notices.map((notice, i) => (
            <Text key={'notice-' + i} color={notice.level === 'error' ? 'red' : 'yellow'}>
              {notice.text}
            </Text>
          ))}
          {fullScreen && frame.error && <Text color="red">{frame.error}</Text>}
          {fullScreen && hint && <Text>{hint}</Text>}
        </Box>
      </Box>
      {cardLines.length > 0 && (
        <Box flexDirection="column" flexShrink={0}>
          {cardLines.map((card) => card.lines.map((line, index) => (
            <Text key={card.key + index} dimColor={card.dim} wrap="truncate-end">{line}</Text>
          )))}
          {planEditing !== null && (
            <Text color="yellow">
              {pick('编辑计划正文后 Enter 批准 · Esc 取消编辑', 'Enter approves the edited plan · Esc cancels editing')}
            </Text>
          )}
        </Box>
      )}
      {agentCards.size > 0 && (
        <Box flexDirection="column" flexShrink={0}>
          {agentTreeLines([...agentCards.values()]).map((line, index) => (
            <Text key={'agent-tree-' + index} color={ACCENT} wrap="truncate-end">{line}</Text>
          ))}
          {[...agentCards.values()]
            .sort((a, b) => Number(b.state === 'running' || b.state === 'backgrounded') - Number(a.state === 'running' || a.state === 'backgrounded'))
            .map((record) => {
              const card = agentCardLines(record)
              return (
                <Box key={record.agentId} flexDirection="column">
                  <Text color={card.color} bold wrap="truncate-end">{card.title}</Text>
                  {card.lines.map((line, index) => (
                    <Text key={index} color={card.color} wrap="truncate-end">{line}</Text>
                  ))}
                  {card.footer ? <Text dimColor wrap="truncate-end">{card.footer}</Text> : null}
                </Box>
              )
            })}
        </Box>
      )}
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
                  session.canRememberApproval(frame.approval.requestId)
                    ? '1 允许一次 · 2 本会话记住 · 3 拒绝（或 Esc）'
                    : '1 允许一次 · 2 拒绝（或 Esc） · 每次审批',
                  session.canRememberApproval(frame.approval.requestId)
                    ? '1 allow once · 2 allow for session · 3 deny (or Esc)'
                    : '1 allow once · 2 deny (or Esc) · required each time'
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
      {commandConfirm && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">{commandConfirm.summary}</Text>
          {commandConfirm.preview.map((line, index) => (
            <Text key={index} wrap="truncate-end">{line}</Text>
          ))}
          <Text>{pick('y 确认 · n 或 Esc 取消', 'y confirm · n or Esc cancel')}</Text>
        </Box>
      )}
      {commandOverlay && (
        <Box flexDirection="column" borderStyle="round" borderColor={ACCENT}>
          <Text color={ACCENT}>{commandOverlay.title}</Text>
          {commandOverlay.lines.map((line, index) => (
            <Text key={index} wrap="truncate-end">{line}</Text>
          ))}
          <Text dimColor>{pick('Esc 关闭', 'Esc to close')}</Text>
        </Box>
      )}
      {sideAnswer && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          <Text dimColor>{sideAnswer.split('\n')[0]}</Text>
          {sideAnswer.split('\n').slice(1).map((line, index) => (
            <Text key={index} wrap="truncate-end">{line}</Text>
          ))}
        </Box>
      )}
      {!fullScreen && frame.error && <Text color="red">{frame.error}</Text>}
      <Box flexDirection="column" flexShrink={0}>
        {working && (
          <Text color={ACCENT} wrap="truncate-end">
            {zh ? '● ' : '* '}
            {(zh ? STATUS_ZH : STATUS_EN)[frame.status.state] ?? frame.status.state}
            {frame.startedAt !== undefined && (
              <Text dimColor>
                {' · '}{formatDuration(Math.floor((now - frame.startedAt) / 1000), zh)}
              </Text>
            )}
          </Text>
        )}
        {effortIndex !== undefined && effort && (
          <Box flexDirection="column">
            <Text color={ACCENT}>{pick('选择思考强度', 'Choose reasoning effort')}</Text>
            {effort.choices.map((choice, index) => (
              <Text key={choice} color={index === effortIndex ? ACCENT : undefined}>
                {index === effortIndex ? pick('❯ ', '> ') : '  '}{effortDisplayLabel(choice, zh)}
              </Text>
            ))}
            <Text dimColor>{pick('↑↓ 选择 · Enter 确认 · Esc 取消', 'Up/Down to choose · Enter to confirm · Esc to cancel')}</Text>
          </Box>
        )}
        {transcriptMode && (
          <Text dimColor>{pick('转录视图 · / 搜索 · Ctrl+O 或 Esc 返回', 'Transcript · / search · Ctrl+O or Esc to return')}</Text>
        )}
        {scrolled && (
          <Box justifyContent="flex-end">
            <Text color={ACCENT} wrap="truncate-end">
              {unseenMessages > 0 && pick(`${unseenMessages} 条新消息 · `, `${unseenMessages} new messages · `)}
              {pick('回到最新 · Ctrl+End', 'Jump to bottom · Ctrl+End')}
            </Text>
          </Box>
        )}
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
          {commandOverlay || commandConfirm ? null : search ? (
            <Box flexDirection="column">
              <Text color={ACCENT} wrap="truncate-end">
                {transcriptMode ? pick('搜索会话', 'Search transcript') : pick('搜索输入历史', 'Search input history')}
                {' › '}{search.text}
                {transcriptMode && ` · ${messageMatches.length}`}
              </Text>
              {inputMatch && <Text dimColor wrap="truncate-end">{inputMatch}</Text>}
            </Box>
          ) : transcriptMode ? null : suggestion ? (
            <Text wrap="truncate-end">
              {'> '}<Text dimColor>{pick('Tab 填入', 'Tab to fill')} · {suggestion}</Text>
            </Text>
          ) : (
            <Text>{fullScreen ? draftLines.slice(draftStart, draftStart + composerRows).join('\n') : `> ${input}`}</Text>
          )}
        </Box>
        {fullScreen && (
          <Box height={1} borderStyle="single" borderColor="gray"
            borderLeft={false} borderRight={false} borderBottom={false}
          />
        )}
        {!fullScreen && completionMenu}
        {frame.queue.slice(0, queuePreviewRows).map((item, index) => (
          <Text key={item.id} dimColor wrap={fullScreen ? 'truncate-end' : 'wrap'}>
            {pick('⧗ 排队 · ', '[queued] ')}{item.preview.replace(/\s+/g, ' ')}
            {index === queuePreviewRows - 1 && hiddenQueued > 0 && ` (+${hiddenQueued})`}
          </Text>
        ))}
        {commandCount > 0 && (
          <Text dimColor>{pick('排队命令：', 'Queued commands: ')}{commandCount}</Text>
        )}
        {!fullScreen && hint && hint.includes('\n') && (
          // 多行命令输出（如 /help）：退化终端里不再压成一行状态提示，
          // 而是作为分块正文打印，最多 40 行，超出提示截断。
          <Box flexDirection="column" flexShrink={0}>
            {hint.split('\n').slice(0, 40).map((line, index) => (
              <Text key={'hint-' + index} dimColor wrap="wrap">{line}</Text>
            ))}
            {hint.split('\n').length > 40 && (
              <Text dimColor>{pick('…（输出过长，已截断）', '… (output truncated)')}</Text>
            )}
          </Box>
        )}
        {(showStatusLine || permissionHandles || contextLabel !== undefined || effortLabel !== undefined || footerHint || (!fullScreen && hint && !hint.includes('\n'))) && (
          // SP006 §4.1：页脚是独立区域（固定行数 = 元信息行 + 可选状态栏行），
          // 与输入区、消息区分离；外部状态栏输出不挤占输入框。
          <Box flexDirection="column" flexShrink={0} height={footerHeight + (footerHint ? 1 : 0)}>
            {showStatusLine && (
              <Text dimColor wrap="truncate-end">{statusView.text}</Text>
            )}
            {(permissionHandles || contextLabel !== undefined || effortLabel !== undefined || (!fullScreen && hint && !hint.includes('\n'))) && (
              // 0.5.4：底部元信息合并为一行（模式 · 上下文 · 推理强度 · 快捷键），
              // 不再让上下文/免审批各自占一行（用户反馈占据行数过多）。
              <Box justifyContent="space-between">
            <Text wrap={fullScreen ? 'truncate-end' : 'wrap'}>
              {permissionHandles && (
                <>
                  <Text color={modeColor}>{modeLabel}</Text>
                  <Text dimColor>{' · Shift+Tab '}{pick('切换', 'cycle')}</Text>
                  {frame.permissionMode === 'full_access' && <Text dimColor>{pick(' · 免审批', ' · no prompt')}</Text>}
                </>
              )}
              {working && !frame.approval && (
                <Text dimColor>{permissionHandles ? ' · ' : ''}{pick('Esc 打断', 'Esc interrupt')}</Text>
              )}
              {!fullScreen && hint && !hint.includes('\n') ? ` — ${hint}` : ''}
            </Text>
            {(effortLabel !== undefined || contextLabel !== undefined) && (
              <Text wrap="truncate-end">
                <Text dimColor>{effortLabel}{effortLabel && contextLabel ? ' · ' : ''}</Text>
                {contextLabel !== undefined && (
                  <Text color={contextTone} dimColor={contextTone === undefined}>
                    {contextLabel}
                  </Text>
                )}
              </Text>
            )}
              </Box>
            )}
            {footerHint && (
              <Text color="yellow" wrap={fullScreen ? 'truncate-end' : 'wrap'}>{footerHint}</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

