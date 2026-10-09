import { afterEach, describe, expect, it } from 'vitest'
import { abortError, isAbortError } from './abort.ts'
import { sendMessage } from './api.ts'
import { shouldShowRetry, type FailedChatRequest } from './retry.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function abortLike(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

describe('isAbortError', () => {
  it('recognizes a voluntary AbortError and not an LLM error', () => {
    expect(isAbortError(abortError())).toBe(true)
    expect(isAbortError(abortLike())).toBe(true)
    expect(isAbortError(new Error('Le modèle a échoué.'))).toBe(false)
    expect(isAbortError(new Error('La réponse a été interrompue.'))).toBe(false)
  })
})

describe('sendMessage abort', () => {
  it('creates a fetch call with the AbortController signal and aborting before any delta throws AbortError', async () => {
    const controller = new AbortController()
    let usedSignal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      usedSignal = init?.signal
      expect(usedSignal).toBe(controller.signal)
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortLike()))
      })
    }) as typeof fetch

    const pending = sendMessage(4, 'explique', 'openai/gpt-4o', () => undefined, controller.signal)
    controller.abort()
    await expect(pending).rejects.toSatisfy(isAbortError)
    expect(usedSignal?.aborted).toBe(true)
  })

  it('ignores SSE chunks that arrive after abort so the UI cannot resume', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const deltas: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode('data: {"type":"delta","content":"A"}\n\n'))
          init?.signal?.addEventListener('abort', () => {
            try {
              streamController.enqueue(encoder.encode('data: {"type":"delta","content":"B"}\n\n'))
              streamController.enqueue(
                encoder.encode(
                  'data: {"type":"done","reply":"AB","notification":null}\n\ndata: [DONE]\n\n',
                ),
              )
              streamController.close()
            } catch {
              // Stream already cancelled.
            }
          })
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch

    const pending = sendMessage(
      4,
      'x',
      'openai/gpt-4o',
      (chunk) => {
        deltas.push(chunk)
        if (chunk === 'A') controller.abort()
      },
      controller.signal,
    )
    await expect(pending).rejects.toSatisfy(isAbortError)
    expect(deltas).toEqual(['A'])
  })

  it('aborts after several deltas and does not treat it as a completed reply', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const deltas: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode('data: {"type":"delta","content":"Bonjour"}\n\n'))
          streamController.enqueue(encoder.encode('data: {"type":"delta","content":" comment"}\n\n'))
          streamController.enqueue(encoder.encode('data: {"type":"delta","content":" allez"}\n\n'))
          init?.signal?.addEventListener('abort', () => {
            streamController.error(abortLike())
          })
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch

    const pending = sendMessage(
      4,
      'salut',
      'openai/gpt-4o',
      (chunk) => {
        deltas.push(chunk)
        if (deltas.length === 3) controller.abort()
      },
      controller.signal,
    )
    await expect(pending).rejects.toSatisfy(isAbortError)
    expect(deltas.join('')).toBe('Bonjour comment allez')
  })

  it('still completes a normal SSE success when not aborted', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined()
      return new Response(
        'data: {"type":"delta","content":"ok"}\n\n' +
          'data: {"type":"done","reply":"ok","notification":null}\n\n' +
          'data: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as typeof fetch
    const result = await sendMessage(1, 'ping', 'openai/gpt-4o', () => undefined)
    expect(result.reply).toBe('ok')
  })

  it('still surfaces an LLM SSE error as a normal error, not AbortError', async () => {
    globalThis.fetch = (async () =>
      new Response('data: {"type":"error","message":"Le modèle a échoué."}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as typeof fetch
    await expect(sendMessage(1, 'ping', 'openai/gpt-4o', () => undefined)).rejects.toThrow(
      'Le modèle a échoué.',
    )
  })

  it('keeps the original model on POST even when a signal is provided', async () => {
    let body: unknown
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        'data: {"type":"done","reply":"ok","notification":null}\n\ndata: [DONE]\n\n',
        { status: 200 },
      )
    }) as typeof fetch
    const controller = new AbortController()
    await sendMessage(8, 'listes', 'openai/gpt-4o', () => undefined, controller.signal)
    expect(body).toEqual({
      conversation_id: 8,
      message: 'listes',
      model: 'openai/gpt-4o',
    })
  })
})

describe('Stop vs Retry', () => {
  it('does not create a retry banner state from a voluntary abort', () => {
    const failed: FailedChatRequest | null = null
    expect(shouldShowRetry(failed, 1)).toBe(false)
    expect(isAbortError(abortError())).toBe(true)
  })
})
