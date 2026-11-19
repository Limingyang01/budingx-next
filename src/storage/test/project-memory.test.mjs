// Project memory unit tests (SP005 AC PM-01..PM-08).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  createProjectMemory,
  createSessionMemory,
  containsCredential,
  memoryContextText,
  projectKeyOf,
  projectMemoryDirectory,
  sessionMemoryDirectory
} from '../../tui/dist/storage/project-memory.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-sp005-memory-'))
}

test('PM-01 记忆写在项目作用域目录，位于 ~/.budingx 之下', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'my-project')
  const memory = createProjectMemory({ home, projectRoot: root })
  const result = memory.write('build note', 'always run npm run build before tests')
  assert.equal(result.ok, true)
  const expected = join(projectMemoryDirectory(root, home), 'MEMORY.md')
  assert.equal(memory.path, expected)
  assert.ok(existsSync(expected))
  assert.ok(memory.path.startsWith(join(home, '.budingx')))
  // never inside the user's project directory
  assert.ok(!memory.path.startsWith(root))
})

test('PM-02 不同项目的记忆互不可见', () => {
  const home = tempHome()
  const rootA = join(home, 'workspace', 'project-a')
  const rootB = join(home, 'workspace', 'project-b')
  const memoryA = createProjectMemory({ home, projectRoot: rootA })
  const memoryB = createProjectMemory({ home, projectRoot: rootB })
  memoryA.write('a only', 'this belongs to project a')
  assert.equal(memoryA.read().entries.length, 1)
  assert.equal(memoryB.read().entries.length, 0)
  assert.notEqual(memoryA.path, memoryB.path)
  assert.notEqual(projectKeyOf(rootA), projectKeyOf(rootB))
})

test('PM-02 同一项目在不同进程读取到相同记忆', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'shared')
  createProjectMemory({ home, projectRoot: root }).write('persist', 'this must survive the process')
  const reopened = createProjectMemory({ home, projectRoot: root })
  const entries = reopened.read().entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0].body, 'this must survive the process')
  assert.equal(entries[0].title, 'persist')
})

test('PM-03 会话记忆对兄弟会话不可见', () => {
  const home = tempHome()
  const sessionA = createSessionMemory({ home, sessionId: 'session-a' })
  const sessionB = createSessionMemory({ home, sessionId: 'session-b' })
  sessionA.write('a note', 'only session a sees this')
  assert.equal(sessionA.read().entries.length, 1)
  assert.equal(sessionB.read().entries.length, 0)
  assert.ok(sessionA.path.includes(join('memory', 'sessions')))
  assert.ok(sessionB.path.startsWith(sessionMemoryDirectory('session-b', home)))
})

test('PM-04 注入失败时原子写入保留原内容', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'atomic')
  let failNext = false
  const memory = createProjectMemory({
    home,
    projectRoot: root,
    writeFile: (file, content) => {
      if (failNext) throw new Error('injected write failure')
      writeFileSync(file, content)
    }
  })
  assert.equal(memory.write('first', 'original content').ok, true)
  const before = readFileSync(memory.path, 'utf8')
  // The injected failure must not destroy the previous file.
  failNext = true
  const result = memory.write('second', 'new content')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'memoryWriteFailed')
  assert.equal(readFileSync(memory.path, 'utf8'), before)
  assert.equal(memory.read().entries.length, 1)
})

test('PM-05 凭据样式内容被拒绝且不落盘', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'secret')
  const memory = createProjectMemory({ home, projectRoot: root })
  const result = memory.write('key', 'api_key = sk-abcdefgh12345678')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'memorySecretRejected')
  assert.equal(existsSync(memory.path), false)
  assert.equal(memory.read().entries.length, 0)
  assert.equal(containsCredential('Bearer abcdefghijkl'), true)
  assert.equal(containsCredential('a normal note about the build'), false)
})

test('PM-06 损坏的记忆文件保留原件并留备份', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'corrupt')
  const memory = createProjectMemory({ home, projectRoot: root })
  memory.write('keep', 'original')
  const broken = '## broken-entry\n- created: 2026-01-01T00:00:00.000Z\n- scope: project\n\nbody\n'
  writeFileSync(memory.path, broken)
  const read = memory.read()
  assert.equal(read.entries.length, 1)
  assert.equal(read.entries[0].id, 'broken-entry')
  // writing after a parse is fine and keeps the original content
  const result = memory.write('after', 'appended')
  assert.equal(result.ok, true)
  assert.equal(readFileSync(memory.path, 'utf8').includes('broken-entry'), true)
})

test('PM-07 项目记忆与会话记忆分属不同文件', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'scopes')
  const project = createProjectMemory({ home, projectRoot: root })
  const session = createSessionMemory({ home, sessionId: 's1' })
  assert.notEqual(project.path, session.path)
  project.write('p', 'project body')
  session.write('s', 'session body')
  assert.equal(project.read().entries.length, 1)
  assert.equal(session.read().entries.length, 1)
  assert.equal(project.read().entries[0].body, 'project body')
  assert.equal(session.read().entries[0].body, 'session body')
})

test('PM-08 超限条目被明确拒绝而不是静默裁剪', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'limits')
  const memory = createProjectMemory({ home, projectRoot: root })
  const tooLong = memory.write('big', 'x'.repeat(MAX_ENTRY_CHARS + 1))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.code, 'memoryEntryTooLong')
  assert.equal(memory.read().entries.length, 0)

  const empty = memory.write('empty', '   ')
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'memoryEmpty')
})

test('PM-08 条目数量上限被拒绝', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'count')
  const memory = createProjectMemory({ home, projectRoot: root })
  for (let index = 0; index < MAX_ENTRIES; index += 1) {
    const result = memory.write(`entry-${index}`, `body-${index}`)
    assert.equal(result.ok, true)
  }
  const overflow = memory.write('one too many', 'body')
  assert.equal(overflow.ok, false)
  assert.equal(overflow.code, 'memoryTooManyEntries')
})

test('PM-03 记忆上下文注入带来源标记', () => {
  const home = tempHome()
  const root = join(home, 'workspace', 'inject')
  const memory = createProjectMemory({ home, projectRoot: root })
  memory.write('convention', 'use npm run test:unit')
  const text = memoryContextText('project', { home, projectRoot: root })
  assert.ok(text.startsWith('<project_memory source='))
  assert.ok(text.includes('use npm run test:unit'))
  assert.ok(text.includes('</project_memory>'))
})

test('PM-01 项目键对路径大小写与尾斜杠稳定', () => {
  const a = projectKeyOf('/home/dev/Project/')
  const b = projectKeyOf('/home/dev/Project')
  assert.equal(a, b)
  assert.notEqual(a, projectKeyOf('/home/dev/other'))
})
