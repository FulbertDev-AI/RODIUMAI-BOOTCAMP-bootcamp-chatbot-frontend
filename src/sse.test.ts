import { describe, expect, it } from 'vitest'
import { consumeChatStream, SseParser } from './sse.ts'
import { errorFromHttpBody, sendMessage } from './api.ts'

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

describe('SseParser', () => {
  it('accumulates several delta events into one assistant reply', () => {
    const parser = new SseParser()
    const events = parser.feed(
      'data: {"type":"delta","content":"Bon"}\n\n' +
        'data: {"type":"delta","content":"jour"}\n\n' +
        'data: {"type":"done","reply":"Bonjour","notification":null}\n\n',
    )
    const text = events
      .filter((e) => e.type === 'delta')
      .map((e) => e.content)
      .join('')
    expect(text).toBe('Bonjour')
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('parses several SSE events in a single HTTP chunk', () => {
    const parser = new SseParser()
    const events = parser.feed(
      'data: {"type":"delta","content":"A"}\n\n' +
        'data: {"type":"delta","content":"B"}\n\n' +
        'data: [DONE]\n\n',
    )
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'end'])
  })

  it('reassembles an SSE event split across two HTTP chunks', () => {
    const parser = new SseParser()
    expect(parser.feed('data: {"type":"del')).toEqual([])
    const events = parser.feed('ta","content":"Hi"}\n\n')
    expect(events).toEqual([{ type: 'delta', content: 'Hi' }])
  })

  it('treats [DONE] as a clean end marker', () => {
    const parser = new SseParser()
    const events = parser.feed('data: [DONE]\n\n')
    expect(events).toEqual([{ type: 'end' }])
    expect(parser.end()).toEqual([])
  })

  it('surfaces type:error and does not emit done', () => {
    const parser = new SseParser()
    const events = parser.feed('data: {"type":"error","message":"Le modèle a échoué."}\n\n')
    expect(events).toEqual([{ type: 'error', message: 'Le modèle a échoué.' }])
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })
})

describe('consumeChatStream', () => {
  it('yields one assistant reply from several deltas then done and [DONE]', async () => {
    const deltas: string[] = []
    const result = await consumeChatStream(
      streamFromChunks([
        'data: {"type":"delta","content":"Hel"}\n\n',
        'data: {"type":"delta","content":"lo"}\n\n',
        'data: {"type":"done","reply":"Hello","notification":null}\n\ndata: [DONE]\n\n',
      ]),
      (chunk) => deltas.push(chunk),
    )
    expect(deltas.join('')).toBe('Hello')
    expect(result).toEqual({ reply: 'Hello', notification: null })
  })

  it('throws on type:error so the reply is not treated as successful', async () => {
    const deltas: string[] = []
    await expect(
      consumeChatStream(
        streamFromChunks(['data: {"type":"error","message":"boom"}\n\n']),
        (chunk) => deltas.push(chunk),
      ),
    ).rejects.toThrow('boom')
  })

  it('throws when the stream ends without a done event', async () => {
    await expect(
      consumeChatStream(
        streamFromChunks(['data: {"type":"delta","content":"partiel"}\n\n']),
        () => undefined,
      ),
    ).rejects.toThrow('La réponse a été interrompue.')
  })

  it('reassembles a JSON event cut in the middle of a chunk', async () => {
    const result = await consumeChatStream(
      streamFromChunks([
        'data: {"type":"done","rep',
        'ly":"fin","notification":"ok"}\n\ndata: [DONE]\n\n',
      ]),
      () => undefined,
    )
    expect(result).toEqual({ reply: 'fin', notification: 'ok' })
  })
})

describe('HTTP errors before SSE', () => {
  it('maps FastAPI JSON 404/422 to a classic error', () => {
    expect(errorFromHttpBody(404, { detail: 'Conversation introuvable' }).message).toBe(
      'Conversation introuvable',
    )
    expect(errorFromHttpBody(422, { detail: [{ loc: ['body'], msg: 'bad' }] }).message).toBe(
      'Erreur 422',
    )
  })

  it('sendMessage does not read SSE when the HTTP status is not ok', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: 'Conversation introuvable' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch
    try {
      await expect(sendMessage(99, 'hello', 'openai/gpt-4o', () => undefined)).rejects.toThrow(
        'Conversation introuvable',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
