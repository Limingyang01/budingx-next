#!/usr/bin/env node
// SP010 T1：刷新或核对 CP-SET-v1 任务快照的 SHA-256 清单。
// 用法：
//   node scripts/eval/tools/snapshot.mjs --set cp-v1            # 重算并写入 snapshot.json
//   node scripts/eval/tools/snapshot.mjs --set cp-v1 --check    # 只核对，不写入（漂移即退出码 1）
// 快照内容变更即新版本号：改内容后需要把 snapshot.json 的 version 与任务条目的 snapshot 一起递增。
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '../lib/util.mjs'

const SETS = {
  'cp-v1': { tasks: join('scripts', 'eval', 'tasks', 'set-cp-v1.json'), fixtures: 'CP-' }
}

function hashTree(directory, prefix = '', hashes = new Map()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name
    const full = join(directory, entry.name)
    if (name === 'snapshot.json' && entry.isFile()) continue
    if (entry.isDirectory()) hashTree(full, name + '/', hashes)
    else if (entry.isFile()) {
      hashes.set(name, createHash('sha256').update(readFileSync(full)).digest('hex'))
    } else {
      throw new Error('Unsupported snapshot entry: ' + name)
    }
  }
  return hashes
}

function main() {
  const args = process.argv.slice(2)
  const setIndex = args.indexOf('--set')
  if (setIndex < 0 || !args[setIndex + 1]) {
    console.error('Usage: node scripts/eval/tools/snapshot.mjs --set cp-v1 [--check]')
    process.exitCode = 1
    return
  }
  const setName = args[setIndex + 1]
  const spec = SETS[setName]
  if (!spec) {
    console.error('Unknown task set: ' + setName)
    process.exitCode = 1
    return
  }
  const checkOnly = args.includes('--check')
  const root = repoRoot()
  const tasks = JSON.parse(readFileSync(join(root, spec.tasks), 'utf8'))
  let drift = 0
  for (const task of tasks) {
    const directory = join(root, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id)
    const hashes = hashTree(directory)
    const files = {}
    for (const name of [...hashes.keys()].sort()) files[name] = hashes.get(name)
    const manifestPath = join(directory, 'snapshot.json')
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      manifest = undefined
    }
    if (manifest && JSON.stringify(manifest.files) === JSON.stringify(files)) continue
    drift += 1
    if (checkOnly) {
      console.error('快照漂移：' + task.id)
      continue
    }
    const version = (manifest?.version ?? task.snapshot ?? 1) + 1
    writeFileSync(
      manifestPath,
      JSON.stringify({ version, files }, null, 2) + '\n',
      'utf8'
    )
    console.log('已更新快照：' + task.id + ' → version ' + version)
  }
  if (checkOnly) {
    if (drift > 0) {
      console.error('发现 ' + drift + ' 个快照与实际内容不一致')
      process.exitCode = 1
      return
    }
    console.log('快照与实际内容一致：' + tasks.length + ' 个任务')
    return
  }
  console.log('处理完成：' + tasks.length + ' 个任务，' + drift + ' 个快照被更新')
}

main()
