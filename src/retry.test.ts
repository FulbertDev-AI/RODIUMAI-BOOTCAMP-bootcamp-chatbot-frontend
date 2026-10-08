import { describe, expect, it } from 'vitest'
import { sendMessage } from './api.ts'
import { modelForRetry, retryChatPayload, shouldShowRetry, type FailedChatRequest } from './retry.ts'

const FAILED: FailedChatRequest = {
  conversationId: 3,
  message: 'explique les listes Python',
  model: 'openai/gpt-4o',
}

const SSE_OK =
  'data: {"type":"delta","content":"Les "}\n\n' +
  'data: {"type":"delta","content":"listes"}\n\n' +
  'data: {"type":"done","reply":"Les listes","notification":null}\n\n' +
  'data: [DONE]\n\n'

const SSE_ERROR = 'data: {"type":"error","message":"Le modèle a échoué."}\n\n'

describe('failed chat request memory', () => {
  it('shows Retry only for the conversation that failed', () => {
    expect(shouldShowRetry(FAILED, 3)).toBe(true)
    expect(shouldShowRetry(FAILED, 9)).toBe(false)
    expect(shouldShowRetry(null, 3)).toBe(false)
  })

  it('keeps the original text, conversation and model for retry', () => {
    expect(retryChatPayload(FAILED)).toEqual({
      conversation_id: 3,
      message: 'explique les listes Python',
      model: 'openai/gpt-4o',
    })
  })

  it('ignores a later selector change when resolving the retry model', () => {
    expect(modelForRetry(FAILED, 'anthropic/claude-sonnet-4-5-20250929')).toBe('openai/gpt-4o')
  })
})

describe('retry POST /chat', () => {
  it('replays the same conversation_id, text and original model', async () => {
    const originalFetch = globalThis.fetch
    const posts: Array<{ url: string; body: unknown }> = []
    let calls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      if (calls === 1) {
        return new Response(SSE_ERROR, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return new Response(SSE_OK, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      await expect(
        sendMessage(FAILED.conversationId, FAILED.message, FAILED.model, () => undefined),
      ).rejects.toThrow('Le modèle a échoué.')

      const selectedNow = 'google/gemini-2.5-flash'
      const retry = retryChatPayload(FAILED)
      const deltas: string[] = []
      const result = await sendMessage(
        retry.conversation_id,
        retry.message,
        modelForRetry(FAILED, selectedNow),
        (chunk) => deltas.push(chunk),
      )

      expect(posts).toHaveLength(2)
      expect(posts.every((p) => p.url === '/api/chat')).toBe(true)
      expect(posts[0].body).toEqual(posts[1].body)
      expect(posts[1].body).toEqual({
        conversation_id: 3,
        message: 'explique les listes Python',
        model: 'openai/gpt-4o',
      })
      expect(deltas.join('')).toBe('Les listes')
      expect(result.reply).toBe('Les listes')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('allows another retry after a second failure', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual(retryChatPayload(FAILED))
      return new Response(SSE_ERROR, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      await expect(
        sendMessage(FAILED.conversationId, FAILED.message, FAILED.model, () => undefined),
      ).rejects.toThrow('Le modèle a échoué.')
      await expect(
        sendMessage(FAILED.conversationId, FAILED.message, FAILED.model, () => undefined),
      ).rejects.toThrow('Le modèle a échoué.')
      expect(calls).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
