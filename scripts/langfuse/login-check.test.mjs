// SP005：登录凭据自检的纯函数与注入式流程。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { absorbCookies, cookieHeader, verifyLogin } from './login-check.mjs'

function fakeResponse({ status = 200, json = {}, cookies = [], text = '' } = {}) {
  return {
    status,
    headers: { getSetCookie: () => cookies },
    json: async () => json,
    text: async () => text
  }
}

test('cookie jar helpers keep name=value pairs only', () => {
  const jar = {}
  absorbCookies(jar, { getSetCookie: () => ['a=1; Path=/; HttpOnly', 'b=2; SameSite=Lax', 'bad'] })
  assert.deepEqual(jar, { a: '1', b: '2' })
  assert.equal(cookieHeader(jar), 'a=1; b=2')
  absorbCookies(jar, {})
  assert.deepEqual(jar, { a: '1', b: '2' })
})

test('verifyLogin walks csrf, credentials and session and reports the email', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith('/api/auth/csrf')) {
      return fakeResponse({ json: { csrfToken: 'csrf-1' }, cookies: ['next-auth.csrf-token=csrf-1'] })
    }
    if (url.endsWith('/api/auth/callback/credentials')) {
      return fakeResponse({ status: 200, cookies: ['next-auth.session-token=s1'], text: '{}' })
    }
    return fakeResponse({ json: { user: { email: 'admin@budingx.local' } } })
  }
  const result = await verifyLogin({
    baseUrl: 'http://127.0.0.1:3000',
    email: 'admin@budingx.local',
    password: 'secret',
    fetchImpl
  })
  assert.deepEqual(result, {
    csrfOk: true,
    callbackStatus: 200,
    sessionEmail: 'admin@budingx.local',
    ok: true
  })
  assert.equal(calls.length, 3)
  assert.match(String(calls[1].init.body), /csrfToken=csrf-1/)
  assert.match(String(calls[1].init.body), /email=admin%40budingx.local/)
  assert.match(String(calls[2].init.headers.cookie), /next-auth.session-token=s1/)
})

test('verifyLogin fails without a csrf token or with a different session user', async () => {
  const noCsrf = await verifyLogin({
    baseUrl: 'http://127.0.0.1:3000',
    email: 'a@b.c',
    password: 'x',
    fetchImpl: async () => fakeResponse({ json: {} })
  })
  assert.equal(noCsrf.ok, false)
  assert.equal(noCsrf.csrfOk, false)

  const wrongUser = await verifyLogin({
    baseUrl: 'http://127.0.0.1:3000',
    email: 'a@b.c',
    password: 'x',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/auth/csrf')) return fakeResponse({ json: { csrfToken: 't' } })
      if (url.endsWith('/api/auth/callback/credentials')) {
        return fakeResponse({ status: 200, text: '{}' })
      }
      return fakeResponse({ json: { user: { email: 'other@budingx.local' } } })
    }
  })
  assert.equal(wrongUser.csrfOk, true)
  assert.equal(wrongUser.sessionEmail, 'other@budingx.local')
  assert.equal(wrongUser.ok, false)
})
