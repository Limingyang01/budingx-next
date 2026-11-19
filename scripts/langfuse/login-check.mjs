// SP005：校验本机 Langfuse UI 的登录凭据是否与栈内账号一致。
// 用途：UI 登不上时先跑一次，区分「密码不对」与「服务没起来」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => name + '=' + value)
    .join('; ')
}

export function absorbCookies(jar, headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  for (const raw of list) {
    const pair = raw.split(';')[0]
    const index = pair.indexOf('=')
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
}

/**
 * 走 NextAuth 的 csrf → credentials → session 三步验证账号密码。
 * fetchImpl 可注入，便于单元测试。
 */
export async function verifyLogin({ baseUrl, email, password, fetchImpl = fetch }) {
  const jar = {}
  const csrfRes = await fetchImpl(baseUrl + '/api/auth/csrf', {
    headers: { cookie: cookieHeader(jar) }
  })
  absorbCookies(jar, csrfRes.headers)
  const csrfBody = await csrfRes.json()
  const csrfToken = csrfBody && csrfBody.csrfToken
  if (!csrfToken) return { csrfOk: false, callbackStatus: 0, sessionEmail: null, ok: false }

  const form = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: baseUrl + '/',
    json: 'true'
  })
  const callbackRes = await fetchImpl(baseUrl + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: form,
    redirect: 'manual'
  })
  absorbCookies(jar, callbackRes.headers)
  await callbackRes.text()

  const sessionRes = await fetchImpl(baseUrl + '/api/auth/session', {
    headers: { cookie: cookieHeader(jar) }
  })
  const session = await sessionRes.json()
  const sessionEmail = (session && session.user && session.user.email) || null
  return {
    csrfOk: true,
    callbackStatus: callbackRes.status,
    sessionEmail,
    ok: sessionEmail === email
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const loginPath = path.join(root, '.runtime', 'langfuse', 'login.json')
  if (!fs.existsSync(loginPath)) {
    console.error('missing ' + loginPath + '; run npm run langfuse:init first')
    process.exit(2)
  }
  const login = JSON.parse(fs.readFileSync(loginPath, 'utf8'))
  const baseUrl = login.url || 'http://localhost:3000'
  verifyLogin({ baseUrl, email: login.email, password: login.password })
    .then((result) => {
      console.log(JSON.stringify({ baseUrl, email: login.email, ...result }, null, 2))
      if (!result.ok) process.exitCode = 1
    })
    .catch((error) => {
      console.error('login check failed: ' + (error && error.message ? error.message : error))
      process.exitCode = 1
    })
}
