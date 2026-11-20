// SP006 §6.3 /init：生成项目指令（AGENTS.md）骨架的提示载荷（CMD-05）。
// 命令本身不写文件：不覆盖既有文件，实际写入走模型工具与既有审批通道。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_INSTRUCTION_FILENAME = 'AGENTS.md'

export type InitPlan = {
  ok: boolean
  /** 已存在既有文件时给出说明，不发起模型回合。 */
  message?: string
  /** prompt 型命令交给宿主的提示文本。 */
  prompt?: string
  progress?: string
}

export function projectInstructionTemplate(workspaceDir: string): string {
  return `# 项目说明

> 由 /init 生成的骨架；请用真实内容替换占位符，删除不适用的段落。

## 项目目标

- 一句话说明这个仓库解决什么问题。

## 目录与模块

- \`src/\`：源码入口。
- \`docs/\`：设计与使用文档。

## 常用命令

- 安装依赖：
- 构建：
- 测试：
- 本地启动：

## 约定

- 代码风格、命名、提交信息要求。
- 修改行为时同步更新哪些文档。

## 验证

- 提交前必须执行的检查。
- 无法自动验证的部分如何人工确认。

工作区：${workspaceDir}
`
}

export function planInit(workspaceDir: string, lang: 'zh' | 'en' = 'zh'): InitPlan {
  const target = join(workspaceDir, PROJECT_INSTRUCTION_FILENAME)
  if (existsSync(target)) {
    return {
      ok: false,
      message:
        (lang === 'en'
          ? 'Project instructions already exist and will not be overwritten: '
          : '项目指令已存在，不会覆盖：') + target
    }
  }
  const template = projectInstructionTemplate(workspaceDir)
  return {
    ok: true,
    progress: lang === 'en' ? 'Generating project instructions…' : '正在生成项目指令…',
    prompt: [
      lang === 'en'
        ? 'Create project instructions for this workspace.'
        : '为当前工作区创建项目指令文件。',
      lang === 'en'
        ? `Read the repository structure and key docs first, then write ${PROJECT_INSTRUCTION_FILENAME} at the workspace root.`
        : `先阅读仓库结构与关键文档，再把 ${PROJECT_INSTRUCTION_FILENAME} 写到工作区根目录。`,
      lang === 'en'
        ? 'Use the template below, replace placeholders with verified facts, and do not invent commands. Writing the file still needs approval.'
        : '使用下面的模板，用已核实的事实替换占位符，不要编造命令；写文件仍需通过审批。',
      '',
      template
    ].join('\n')
  }
}

