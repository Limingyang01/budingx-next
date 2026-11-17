// First-screen welcome (SP002 tui-conversation).
// Style baseline: the reference product's LogoV2 mechanism — rounded box with
// the product name + dim version embedded in the top border, a left panel
// (bold welcome, 7-wide mascot, dim model/cwd lines), a dim vertical divider
// and a right tips feed on wide terminals; a centered compact box below 70
// columns; a borderless condensed banner once configured; pure-ASCII fallback
// on legacy Windows consoles. Upstream Ink has no borderText, so the box is
// composed here as pure styled-span lines; the Ink layer only maps spans.
// All rendering logic is independent; the mascot art is our own drawing.
// Wording: modern terminals get Chinese; the ASCII fallback keeps English
// (legacy console code pages may not render CJK), matching the reference.

import stringWidth from 'string-width'

export type Span = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  italic?: boolean
}
export type Line = Span[]

/** budingx brand accent (purple, matches the reference product's accent). */
export const ACCENT = '#af87ff'

export type TerminalStrategy = 'pixel' | 'ascii'

/**
 * Env-only terminal capability decision (zero startup probing): legacy
 * cmd/conhost sets none of the modern-terminal variables and gets ASCII.
 * BUDINGX_FORCE_ASCII_LOGO / BUDINGX_FORCE_PIXEL_LOGO override for testing.
 */
export function terminalStrategy(
  env: Record<string, string | undefined>,
  platform: string
): TerminalStrategy {
  if (env.BUDINGX_FORCE_ASCII_LOGO) return 'ascii'
  if (env.BUDINGX_FORCE_PIXEL_LOGO) return 'pixel'
  const modern =
    env.WT_SESSION ||
    env.TERM_PROGRAM ||
    env.ConEmuPID ||
    env.ConEmuANSI ||
    env.ConEmuTask ||
    env.MINTTY ||
    env.ANSICON ||
    env.TERM === 'cygwin'
  if (modern) return 'pixel'
  return platform === 'win32' ? 'ascii' : 'pixel'
}

// Mascot slot: 4 rows, 7 columns wide, same slot as the reference layout.
const CAT_PIXEL = [' ▲   ▲ ', '▐▛███▜▌', '▐█████▌', ' ▘▘ ▝▝ ']
const CAT_ASCII = [' /\\ /\\ ', '( o.o )', ' |   | ', '  = =  ']

const WORDS = {
  pixel: {
    welcome: '欢迎使用 budingx',
    tips: '快速上手',
    tipKey: 'BUDINGX_API_KEY 提供该主机的密钥',
    tipHelp: '/help 查看全部命令',
    notes: '本轮新增',
    noteCore: '流式模型与会话核心',
    noteSemantics: '打断、排队与审批语义',
    noteTools: '编码工具将在后续版本交付',
    noModel: '模型：未配置',
    noEndpoint: '端点未设置',
    sep: '·',
    hint: '尚未配置 · 运行 /provider add <label> <base-url> <model>'
  },
  ascii: {
    welcome: 'Welcome to budingx',
    tips: 'Tips for getting started',
    tipKey: 'BUDINGX_API_KEY supplies the key for the host',
    tipHelp: '/help lists every command',
    notes: "What's new",
    noteCore: 'Streaming model & session core',
    noteSemantics: 'Interrupt, queue and approval semantics',
    noteTools: 'Coding tools arrive in later releases',
    noModel: 'model: not configured',
    noEndpoint: 'endpoint not set',
    sep: '-',
    hint: 'Not configured - run /provider add <label> <base-url> <model>'
  }
} as const

const w = stringWidth

function plain(text: string, style: Omit<Span, 'text'> = {}): Span {
  return { text, ...style }
}

export function lineWidth(line: Line): number {
  return line.reduce((total, span) => total + w(span.text), 0)
}

function padTo(line: Line, width: number, align: 'left' | 'center'): Line {
  const gap = Math.max(0, width - lineWidth(line))
  const left = align === 'center' ? Math.floor(gap / 2) : 0
  const out: Line = []
  if (left > 0) out.push(plain(' '.repeat(left)))
  out.push(...line)
  if (gap - left > 0) out.push(plain(' '.repeat(gap - left)))
  return out
}

function cutToWidth(text: string, max: number): string {
  if (w(text) <= max) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const cw = w(ch)
    if (used + cw > max) break
    out += ch
    used += cw
  }
  return out
}

/** Width-aware middle truncation that keeps the identifying tail. */
export function truncatePath(
  path: string,
  max: number,
  ellipsis = '…'
): string {
  if (w(path) <= max) return path
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? path
  const mid = sep + ellipsis + sep
  if (w(first) + w(mid) + w(last) <= max) return first + mid + last
  if (w(ellipsis) + w(sep) + w(last) <= max) return ellipsis + sep + last
  return ellipsis + cutToWidth(last, Math.max(max - w(ellipsis), 1))
}

function hostOf(baseUrl?: string): string {
  if (!baseUrl) return ''
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}

export type HeaderInput = {
  version: string
  model?: string
  baseUrl?: string
  /** Whether a key is resolved; the raw key never reaches the render layer. */
  keyPresent?: boolean
  cwd?: string
  columns: number
  strategy: TerminalStrategy
}

/**
 * Setup guidance shown under the prompt when the session is not usable yet.
 * Mirrors the reference behaviour of a persistent "not logged in" hint.
 */
export function setupHint(
  config: { model?: string; apiKey?: string },
  strategy: TerminalStrategy = 'pixel'
): string | undefined {
  if (config.model?.trim() && config.apiKey?.trim()) return undefined
  return WORDS[strategy].hint
}

function modelLineOf(
  input: HeaderInput,
  words: (typeof WORDS)[TerminalStrategy]
): string {
  const model = input.model?.trim() ?? ''
  if (!model) return words.noModel
  return `${model} ${words.sep} ${hostOf(input.baseUrl) || words.noEndpoint}`
}

function feed(title: string, lines: string[]): Line[] {
  return [
    [plain(title, { color: ACCENT, bold: true })],
    ...lines.map((text) => [plain(text)]),
    []
  ]
}

function borderChars(strategy: TerminalStrategy) {
  return strategy === 'ascii'
    ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }
}

function titleSpans(version: string): Line {
  return [
    plain('budingx', { color: ACCENT, bold: true }),
    plain(' '),
    plain(`v${version}`, { dim: true })
  ]
}

function topBorder(
  boxWidth: number,
  title: Line,
  b: ReturnType<typeof borderChars>
): Line {
  const fill = Math.max(0, boxWidth - 5 - lineWidth(title))
  return [
    plain(b.tl + b.h + ' ', { color: ACCENT }),
    ...title,
    plain(' ' + b.h.repeat(fill) + b.tr, { color: ACCENT })
  ]
}

function bottomBorder(boxWidth: number, b: ReturnType<typeof borderChars>): Line {
  return [plain(b.bl + b.h.repeat(boxWidth - 2) + b.br, { color: ACCENT })]
}

function welcome(input: HeaderInput): Line[] {
  const ascii = input.strategy === 'ascii'
  const words = WORDS[input.strategy]
  const b = borderChars(input.strategy)
  const cat = ascii ? CAT_ASCII : CAT_PIXEL
  const ellipsis = ascii ? '...' : '…'
  const columns = Math.max(input.columns, 24)
  const modelLine = modelLineOf(input, words)
  const cwdLine = truncatePath(input.cwd ?? '', 50, ellipsis)
  const leftWidth = Math.min(
    50,
    Math.max(20, w(words.welcome), w(modelLine), w(cwdLine)) + 4
  )

  const left: Line[] = [
    [plain(words.welcome, { bold: true })],
    [],
    ...cat.map((row) => [plain(row, { color: ACCENT })]),
    [],
    [plain(modelLine, { dim: true })],
    [plain(cwdLine, { dim: true })]
  ]

  if (columns >= 70 && columns - 6 - leftWidth >= 24) {
    const rightWidth = columns - 6 - leftWidth
    const boxWidth = leftWidth + rightWidth + 6
    const right: Line[] = [
      ...feed(words.tips, [
        '/provider add <label> <base-url> <model>',
        words.tipKey,
        words.tipHelp
      ]),
      ...feed(words.notes, [words.noteCore, words.noteSemantics, words.noteTools])
    ]
    const height = Math.max(left.length, right.length, 9)
    const rows: Line[] = []
    for (let i = 0; i < height; i++) {
      rows.push([
        plain(b.v, { color: ACCENT }),
        plain(' '),
        ...padTo(left[i] ?? [], leftWidth, 'center'),
        plain(b.v, { dim: true }),
        plain(' '),
        ...padTo(right[i] ?? [], rightWidth, 'left'),
        plain(' '),
        plain(b.v, { color: ACCENT })
      ])
    }
    return [topBorder(boxWidth, titleSpans(input.version), b), ...rows, bottomBorder(boxWidth, b)]
  }

  // Compact: centered single column.
  const boxWidth = Math.max(20, Math.min(columns - 2, 56))
  const cell = boxWidth - 4
  const compactCwd = truncatePath(input.cwd ?? '', cell, ellipsis)
  const content: Line[] = [
    [plain(words.welcome, { bold: true })],
    [],
    ...cat.map((row) => [plain(row, { color: ACCENT })]),
    [],
    [plain(modelLine, { dim: true })],
    [plain(compactCwd, { dim: true })]
  ]
  const rows = content.map((line) => [
    plain(b.v, { color: ACCENT }),
    plain(' '),
    ...padTo(line, cell, 'center'),
    plain(' '),
    plain(b.v, { color: ACCENT })
  ])
  return [topBorder(boxWidth, titleSpans(input.version), b), ...rows, bottomBorder(boxWidth, b)]
}

function condensed(input: HeaderInput): Line[] {
  const ascii = input.strategy === 'ascii'
  const words = WORDS[input.strategy]
  const cat = ascii ? CAT_ASCII : CAT_PIXEL
  const ellipsis = ascii ? '...' : '…'
  const textWidth = Math.max(input.columns - 15, 20)
  const right: Line[] = [
    [
      plain('budingx', { color: ACCENT, bold: true }),
      plain(' '),
      plain(`v${input.version}`, { dim: true })
    ],
    [plain(modelLineOf(input, words), { dim: true })],
    [plain(truncatePath(input.cwd ?? '', textWidth, ellipsis), { dim: true })],
    []
  ]
  return cat.map((row, i) => [
    plain(row, { color: ACCENT }),
    plain('  '),
    ...(right[i] ?? [])
  ])
}

/** Full welcome box until configured; condensed banner afterwards. */
export function renderHeader(input: HeaderInput): Line[] {
  const configured = !!input.model?.trim() && !!input.keyPresent
  return configured ? condensed(input) : welcome(input)
}
