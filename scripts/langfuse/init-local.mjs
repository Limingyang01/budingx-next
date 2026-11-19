// SP004 agent-observability §4.7.2：本机 Langfuse 初始化。
// 生成 local.env / agent.env / login.json 到 Git 忽略的 .runtime/langfuse/。
// 幂等：复用既有凭据，不覆盖；既有文件缺关键键则报错并保留原文件。
// 权限：写入任何凭据前建立并验证当前用户私有访问（POSIX 模式位 / Windows NTFS DACL）。
//
// 独立实现，不复制参考仓脚本。随机值用 node:crypto。

import { randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
  chmodSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const secret = () => randomBytes(32).toString('hex')

/** local.env 必须存在的关键键。缺失即视为不完整。 */
const REQUIRED_KEYS = [
  'NEXTAUTH_URL',
  'LANGFUSE_INIT_USER_EMAIL',
  'LANGFUSE_INIT_USER_PASSWORD',
  'LANGFUSE_INIT_PROJECT_PUBLIC_KEY',
  'LANGFUSE_INIT_PROJECT_SECRET_KEY'
]

/** 解析 KEY=VALUE 形式的 env 文件。 */
export function parseEnvFile(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    if (!/^[A-Z_][A-Z0-9_]*=/.test(line)) continue
    const position = line.indexOf('=')
    values[line.slice(0, position)] = line.slice(position + 1)
  }
  return values
}

/** 序列化 env 值。 */
function serializeEnv(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
}

/** 当前平台是否为 Windows。 */
const isWindows = process.platform === 'win32'

/** Windows 系统工具全路径，避免 MSYS/Git-Bash 同名 GNU 工具干扰。 */
const systemTool = (name) =>
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)

/** 读取当前用户 SID（Windows）。失败返回 undefined。 */
// 只取 SID：账户名经控制台代码页传输，非 ASCII 账户会被解码成乱码，
// 用名字比对会在中文等账户名下误判（SID 始终是 ASCII）。
export function currentUserSid() {
  try {
    const out = execFileSync(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const sid = out.match(/"(S-1-[0-9]+(?:-[0-9]+)+)"/)
    return sid ? sid[1] : undefined
  } catch {
    return undefined
  }
}

/** 不允许出现在私有路径 DACL 里的宽泛主体（Everyone / Authenticated Users / INTERACTIVE / BUILTIN\Users）。 */
export const BROAD_PRINCIPAL_SIDS = ['S-1-1-0', 'S-1-5-11', 'S-1-5-4', 'S-1-5-32-545']

/**
 * 读取路径 DACL 的 SDDL 文本（Windows）。
 * 用 icacls /save 导出：SDDL 里只有 SID 和 ACE 类型，不经过控制台代码页，
 * 因此不会因账户名含非 ASCII 字符而乱码（原来的名字比对正是这样误判的）。
 */
export function readAclSddl(target) {
  const dump = path.join(os.tmpdir(), `budingx-acl-${process.pid}-${randomUUID()}.txt`)
  try {
    execFileSync(systemTool('icacls.exe'), [target, '/save', dump], {
      encoding: 'utf8',
      windowsHide: true
    })
    return readFileSync(dump, 'utf16le')
  } finally {
    try {
      unlinkSync(dump)
    } catch {
      // 清理失败不影响校验结果。
    }
  }
}

/** 从 SDDL 文本里取出全部 SID。 */
export function aclSids(sddl) {
  return sddl.match(/S-1-[0-9]+(?:-[0-9]+)+/g) ?? []
}

/**
 * 把路径的访问限制为当前用户，并验证。
 * POSIX：目录 0o700 / 文件 0o600，且归属当前 uid。
 * Windows：取消继承，仅授予当前用户 SID 完全控制，再核对 DACL 不含宽泛主体。
 * 无法建立或验证时抛错（调用方据此在写入凭据前停止）。
 */
export function restrictAndVerify(target, kind) {
  if (!isWindows) {
    const expected = kind === 'dir' ? 0o700 : 0o600
    chmodSync(target, expected)
    const stat = statSync(target)
    const mode = stat.mode & 0o777
    if (mode !== expected) {
      throw new Error(`Cannot restrict ${target} to mode ${expected.toString(8)} (got ${mode.toString(8)})`)
    }
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw new Error(`${target} is not owned by the current user`)
    }
    return
  }
  const sid = currentUserSid()
  if (!sid) throw new Error('Cannot determine the current user SID; refusing to write credentials')
  // SID 前缀 * 让 icacls 按 SID 而非账户名授权。
  const grant = kind === 'dir' ? `*${sid}:(OI)(CI)F` : `*${sid}:F`
  execFileSync(systemTool('icacls.exe'), [target, '/inheritance:r', '/grant:r', grant], {
    encoding: 'utf8',
    windowsHide: true
  })
  // 按 SID 核对：icacls 的文本输出会把账户名按控制台代码页显示，名字比对不可靠
  // （中文账户名解码成乱码后既匹配不到名字也匹配不到 SID）。
  const sids = aclSids(readAclSddl(target))
  if (!sids.includes(sid)) {
    throw new Error(`Cannot verify the current user (SID ${sid}) on ${target}`)
  }
  const broad = sids.filter((entry) => BROAD_PRINCIPAL_SIDS.includes(entry))
  if (broad.length > 0) {
    throw new Error(
      `${target} still grants access to a broad principal (${broad.join(', ')}); refusing to write credentials`
    )
  }
}

/** 建立私有目录（写入凭据前）。 */
function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true })
  restrictAndVerify(dir, 'dir')
}

/** 写入私有文件：先写内容，再限制并验证；验证失败则删除并抛错。 */
function writePrivateFile(file, content) {
  writeFileSync(file, content, { mode: 0o600 })
  try {
    restrictAndVerify(file, 'file')
  } catch (error) {
    try {
      unlinkSync(file)
    } catch {
      /* 保留现场供排查 */
    }
    throw error
  }
}

/** 生成首次初始化的全部值。 */
function generateValues() {
  const values = {
    LANGFUSE_IMAGE_TAG: process.env.LANGFUSE_IMAGE_TAG || '4.78.0',
    CLICKHOUSE_IMAGE_TAG: process.env.CLICKHOUSE_IMAGE_TAG || '26.3.62.3',
    MINIO_IMAGE_TAG: process.env.MINIO_IMAGE_TAG || 'latest',
    NEXTAUTH_URL: 'http://localhost:3000',
    TELEMETRY_ENABLED: 'false',
    SALT: secret(),
    ENCRYPTION_KEY: secret(),
    NEXTAUTH_SECRET: secret(),
    POSTGRES_PASSWORD: secret(),
    CLICKHOUSE_PASSWORD: secret(),
    REDIS_AUTH: secret(),
    MINIO_ROOT_USER: 'budingx',
    MINIO_ROOT_PASSWORD: secret(),
    LANGFUSE_INIT_ORG_ID: 'budingx-local',
    LANGFUSE_INIT_ORG_NAME: 'budingX Local',
    LANGFUSE_INIT_PROJECT_ID: 'budingx-agent',
    LANGFUSE_INIT_PROJECT_NAME: 'budingX Agent',
    LANGFUSE_INIT_PROJECT_PUBLIC_KEY: 'pk-lf-' + randomUUID(),
    LANGFUSE_INIT_PROJECT_SECRET_KEY: 'sk-lf-' + secret(),
    LANGFUSE_INIT_USER_EMAIL: 'admin@budingx.local',
    LANGFUSE_INIT_USER_NAME: 'Local Admin',
    LANGFUSE_INIT_USER_PASSWORD: secret()
  }
  values.DATABASE_URL = `postgresql://postgres:${values.POSTGRES_PASSWORD}@postgres:5432/postgres`
  for (const kind of ['EVENT', 'MEDIA']) {
    values[`LANGFUSE_S3_${kind}_UPLOAD_ACCESS_KEY_ID`] = values.MINIO_ROOT_USER
    values[`LANGFUSE_S3_${kind}_UPLOAD_SECRET_ACCESS_KEY`] = values.MINIO_ROOT_PASSWORD
  }
  return values
}

/**
 * 初始化本机 Langfuse 配置。
 * @param root 仓库根目录
 * @returns 配置目录绝对路径
 */
export function initLocal(root) {
  const directory = path.join(root, '.runtime', 'langfuse')
  // 写入任何凭据前先建立并验证目录私有访问。
  ensurePrivateDir(directory)
  const envPath = path.join(directory, 'local.env')
  let values
  if (existsSync(envPath)) {
    values = parseEnvFile(readFileSync(envPath, 'utf8'))
    for (const key of REQUIRED_KEYS) {
      if (!values[key]) {
        throw new Error(`Existing local.env is missing ${key}; preserve it and repair explicitly`)
      }
    }
  } else {
    values = generateValues()
    writePrivateFile(envPath, serializeEnv(values))
  }
  const agentPath = path.join(directory, 'agent.env')
  if (!existsSync(agentPath)) {
    writePrivateFile(
      agentPath,
      [
        'BUDINGX_LANGFUSE_ENABLED=1',
        `LANGFUSE_BASE_URL=${values.NEXTAUTH_URL}`,
        `LANGFUSE_PUBLIC_KEY=${values.LANGFUSE_INIT_PROJECT_PUBLIC_KEY}`,
        `LANGFUSE_SECRET_KEY=${values.LANGFUSE_INIT_PROJECT_SECRET_KEY}`
      ].join('\n') + '\n'
    )
  }
  const loginPath = path.join(directory, 'login.json')
  if (!existsSync(loginPath)) {
    writePrivateFile(
      loginPath,
      JSON.stringify(
        {
          url: values.NEXTAUTH_URL,
          email: values.LANGFUSE_INIT_USER_EMAIL,
          password: values.LANGFUSE_INIT_USER_PASSWORD
        },
        null,
        2
      ) + '\n'
    )
  }
  return directory
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    initLocal(root)
    console.log('Local configuration ready in .runtime/langfuse (credentials hidden; existing files preserved).')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
