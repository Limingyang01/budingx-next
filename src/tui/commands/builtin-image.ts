// SP007 MM-01 补：/image 命令——终端无关的图片附件入口。
// 动机（用户 2026-11-21 实测）：VS Code 集成终端把 alt+v 当 chord 前缀吞掉，
// 按键进不来；剪贴板只有图片时 ctrl+v 也什么都不发。命令不依赖键位，任何宿主可用。
import type { CommandContext, CommandDefinition, CommandResult } from './types.js'
import { prepareImage } from '../image-resize.js'
import { readClipboardImage, readImageFile } from '../image-paste.js'

function text(value: string, outcome?: CommandResult['outcome']): CommandResult {
  return { kind: 'text', value, ...(outcome ? { outcome } : {}) }
}

function zh(context: CommandContext): boolean {
  return (context.lang ?? 'zh') === 'zh'
}

function source(context: CommandContext): NonNullable<CommandContext['imageSource']> {
  return context.imageSource ?? { clipboard: readClipboardImage, file: readImageFile }
}

const imageCommand: CommandDefinition = {
  name: 'image',
  kind: 'local',
  summary: '把剪贴板或指定路径的图片挂为附件（/image [路径]）',
  immediate: true,
  async run(args, context) {
    // headless：提交管线还没有 images 通道（SP007 MM-03 只覆盖交互 TUI），
    // 与其假装附件成功，不如明确说明并保留文本路径用法。
    if (!context.interactive) {
      return text(
        zh(context)
          ? '图片附件仅在交互式终端可用；headless 请直接写图片路径给模型。'
          : 'Image attachments need the interactive TUI; in headless mode pass the path as text.',
        { handled: true }
      )
    }
    const reader = source(context)
    const target = args.trim().replace(/^["']|["']$/g, '')
    let raw: { data: Buffer; mediaType: string } | undefined

    try {
      raw = target ? reader.file(target) : reader.clipboard()
    } catch (error) {
      return text(String((error as Error).message), { handled: true })
    }
    if (!raw) {
      return text(
        zh(context)
          ? '剪贴板里没有图片：先截图或复制图片，或用 /image <路径>。'
          : 'No image in the clipboard: copy an image first, or use /image <path>.',
        { handled: true }
      )
    }
    try {
      const prepared = prepareImage(raw.data, raw.mediaType)
      return text(
        prepared.resized
          ? zh(context) ? '图片已压缩并附件' : 'Image resized and attached'
          : zh(context) ? '图片已附件' : 'Image attached',
        { handled: true, attachImage: prepared }
      )
    } catch (error) {
      return text(String((error as Error).message), { handled: true })
    }
  }
}

export const IMAGE_COMMANDS: CommandDefinition[] = [imageCommand]
