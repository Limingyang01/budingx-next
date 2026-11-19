// 由 scripts/langfuse/local-ui.html 生成 scripts/langfuse/local-ui.mjs（页面需要改时改 HTML，再运行 npm run langfuse:ui）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const htmlPath = fileURLToPath(new URL('./local-ui.html', import.meta.url))
const outPath = fileURLToPath(new URL('./local-ui.mjs', import.meta.url))
const html = readFileSync(htmlPath, 'utf8')
const source =
  '// 由 scripts/langfuse/local-ui.html 生成；请改 HTML 后运行 npm run langfuse:ui。\n' +
  'export const LOCAL_UI_HTML = ' + JSON.stringify(html) + '\n'
writeFileSync(outPath, source)
console.log('local-ui.mjs 已从 local-ui.html 重新生成（' + source.length + ' 字符）')