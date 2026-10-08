import { afterEach, describe, expect, it } from 'vitest'
import { isAbortError } from './abort.ts'
import { sendMessage } from './api.ts'
import { consumeChatStream, formatTokenUsage, parseTokenUsage, SseParser } from './sse.ts'

const USAGE = { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]))
      else controller.close()
    },
  })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('parseTokenUsage', () => {
  it('reads a complete usage object and treats null/invalid as null', () => {
    expect(parseTokenUsage(USAGE)).toEqual(USAGE)
    expect(parseTokenUsage(null)).toBeNull()
    expect(parseTokenUsage(undefined)).toBeNull()
    expect(parseTokenUsage({ prompt_tokens: '100' })).toBeNull()
  })
})

describe('SSE done usage', () => {
  it('extracts usage from a done event', () => {
    const parser = new SseParser()
    const events = parser.feed(
      `data: {"type":"done","reply":"ok","notification":null,"usage":${JSON.stringify(USAGE)}}\n\n`,
    )
    expect(events).toEqual([
      { type: 'done', reply: 'ok', notification: null, usage: USAGE },
    ])
  })

  it('keeps usage null when the backend sends usage: null', () => {
    const parser = new SseParser()
    const events = parser.feed(
      'data: {"type":"done","reply":"ok","notification":null,"usage":null}\n\n',
    )
    expect(events).toEqual([{ type: 'done', reply: 'ok', notification: null, usage: null }])
  })

  it('does not treat missing usage as an error', async () => {
    const result = await consumeChatStream(
      streamFromChunks([
        'data: {"type":"delta","content":"ok"}\n\n',
        'data: {"type":"done","reply":"ok","notification":null}\n\ndata: [DONE]\n\n',
      ]),
      () => undefined,
    )
    expect(result.usage).toBeNull()
  })

  it('returns usage only after done, not from deltas', async () => {
    const deltas: string[] = []
    const result = await consumeChatStream(
      streamFromChunks([
        'data: {"type":"delta","content":"Hel"}\n\n',
        'data: {"type":"delta","content":"lo"}\n\n',
        `data: {"type":"done","reply":"Hello","notification":null,"usage":${JSON.stringify(USAGE)}}\n\n`,
        'data: [DONE]\n\n',
      ]),
      (chunk) => deltas.push(chunk),
    )
    expect(deltas.join('')).toBe('Hello')
    expect(result.usage).toEqual(USAGE)
    expect(formatTokenUsage(result.usage!)).toBe('125 tokens · 100 entrée · 25 sortie')
  })
})

describe('usage with retry and stop', () => {
  it('returns the new usage after a successful retry', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('data: {"type":"error","message":"boom"}\n\n', { status: 200 })
      }
      return new Response(
        `data: {"type":"done","reply":"ok","notification":null,"usage":${JSON.stringify(USAGE)}}\n\ndata: [DONE]\n\n`,
        { status: 200 },
      )
    }) as typeof fetch

    await expect(sendMessage(1, 'hi', 'openai/gpt-4o', () => undefined)).rejects.toThrow('boom')
    const result = await sendMessage(1, 'hi', 'openai/gpt-4o', () => undefined)
    expect(result.usage).toEqual(USAGE)
  })

  it('yields no usage when a retry fails', async () => {
    globalThis.fetch = (async () =>
      new Response('data: {"type":"error","message":"encore raté"}\n\n', {
        status: 200,
      })) as typeof fetch
    await expect(sendMessage(1, 'hi', 'openai/gpt-4o', () => undefined)).rejects.toThrow('encore raté')
  })

  it('yields no usage when the stream is aborted', async () => {
    const controller = new AbortController()
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }) as typeof fetch
    const pending = sendMessage(1, 'hi', 'openai/gpt-4o', () => undefined, controller.signal)
    controller.abort()
    await expect(pending).rejects.toSatisfy(isAbortError)
  })
})
