#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { loadConfig, normalizeBaseUrl } from './config.js'
import { streamChat, type Message } from './provider.js'

const version = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
).version
const help = `budingx ${version} — independent terminal chat preview
Usage: budingx [--model NAME] [--base-url URL] [--timeout MS] [--prompt TEXT]
Environment: BUDINGX_API_KEY, BUDINGX_MODEL, BUDINGX_BASE_URL
Commands: /help /config /model NAME /endpoint URL /clear /exit
Ctrl+C cancels a response; at the prompt it exits.
Chat only: no coding tools, file access, saved history or Bun required.`
const safe = (text: string) =>
  stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    console.log(version)
    return
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(help)
    return
  }
  const config = loadConfig(args, process.env)
  const messages: Message[] = []
  let active: AbortController | undefined
  let exiting = false
  let inputClosed = false
  let rl: ReturnType<typeof createInterface> | undefined
  const interrupt = () => {
    if (active) active.abort()
    else {
      exiting = true
      rl?.close()
    }
  }
  process.on('SIGINT', interrupt)
  async function send(text: string) {
    if (!text.trim()) return
    if (text.length > 32768) throw new Error('Message exceeds 32768 characters')
    if (
      messages.length >= 24 ||
      messages.reduce((sum, message) => sum + message.content.length, 0) +
        text.length >
        120000
    )
      throw new Error(
        'Session limit reached; /clear to start a new conversation'
      )
    const turn: Message[] = [...messages, { role: 'user', content: text }]
    active = new AbortController()
    let answer = ''
    process.stdout.write('assistant> ')
    try {
      for await (const chunk of streamChat(config, turn, active.signal)) {
        answer += chunk
        process.stdout.write(safe(chunk))
      }
      messages.push(
        { role: 'user', content: text },
        { role: 'assistant', content: answer }
      )
      process.stdout.write('\n')
    } catch (error) {
      process.stdout.write('\n')
      if (active.signal.aborted)
        console.error('[Cancelled; turn was not saved]')
      else throw error
    } finally {
      active = undefined
    }
  }
  try {
    if (config.prompt !== undefined) {
      await send(config.prompt)
      return
    }
    console.log(`budingx ${version} · chat preview · /help for commands`)
    console.log(
      'Session stays in memory. Model: ' +
        safe(config.model || '(not configured)')
    )
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    })
    rl.on('SIGINT', interrupt)
    rl.on('close', () => {
      inputClosed = true
    })
    rl.setPrompt('you> ')
    rl.prompt()
    for await (const line of rl) {
      if (exiting) break
      const text = line.trim()
      try {
        if (text === '/exit' || text === '/quit') break
        else if (text === '/help') console.log(help)
        else if (text === '/config')
          console.log(
            `Endpoint: ${safe(config.baseUrl)}\nModel: ${safe(config.model || '(not configured)')}\nAPI key: ${config.apiKey ? 'set (hidden)' : 'not set'}\nTimeout: ${config.timeoutMs} ms`
          )
        else if (text === '/clear') {
          messages.length = 0
          console.log('Conversation cleared')
        } else if (text.startsWith('/model ')) {
          const model = text.slice(7).trim()
          const next = loadConfig(
            ['--model', model, '--base-url', config.baseUrl],
            { BUDINGX_API_KEY: config.apiKey }
          )
          config.model = next.model
          messages.length = 0
          console.log('Model changed; conversation cleared')
        } else if (text.startsWith('/endpoint ')) {
          config.baseUrl = normalizeBaseUrl(text.slice(10).trim())
          config.apiKey = ''
          messages.length = 0
          console.log(
            'Endpoint changed; API key removed to prevent forwarding it to a different host. Restart with BUDINGX_API_KEY if needed.'
          )
        } else if (text.startsWith('/'))
          console.error('Unknown command; use /help')
        else await send(text)
      } catch (error) {
        console.error(
          'Error: ' +
            safe(error instanceof Error ? error.message : 'Request failed')
        )
      }
      if (!exiting && !inputClosed) rl.prompt()
    }
  } finally {
    rl?.close()
    process.removeListener('SIGINT', interrupt)
  }
}
main().catch((error) => {
  console.error(
    'Error: ' + safe(error instanceof Error ? error.message : 'Request failed')
  )
  process.exitCode = 1
})
