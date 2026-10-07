import { describe, expect, it } from 'vitest'
import { createNote, getModels, parseModelsCatalog, sendMessage } from './api.ts'

const CATALOG = {
  default: 'openai/gpt-4o',
  models: [
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'anthropic/claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
}

const SSE_OK =
  'data: {"type":"done","reply":"ok","notification":null}\n\ndata: [DONE]\n\n'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(): Response {
  return new Response(SSE_OK, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('parseModelsCatalog', () => {
  it('keeps the backend default when it exists in the list', () => {
    const catalog = parseModelsCatalog(CATALOG)
    expect(catalog.default).toBe('openai/gpt-4o')
    expect(catalog.models).toHaveLength(5)
  })

  it('falls back to the first model when default is missing', () => {
    const catalog = parseModelsCatalog({ default: 'unknown/model', models: CATALOG.models })
    expect(catalog.default).toBe('openai/gpt-4o')
  })

  it('rejects an empty or invalid list', () => {
    expect(() => parseModelsCatalog({ default: 'x', models: [] })).toThrow('Aucun modèle disponible.')
    expect(() => parseModelsCatalog({ models: [{ id: 1 }] })).toThrow('Aucun modèle disponible.')
    expect(() => parseModelsCatalog(null)).toThrow('Liste de modèles invalide.')
  })
})

describe('getModels', () => {
  it('calls GET /api/models and returns the catalog', async () => {
    const originalFetch = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return jsonResponse(200, CATALOG)
    }) as typeof fetch
    try {
      const catalog = await getModels()
      expect(urls).toEqual(['/api/models'])
      expect(catalog.default).toBe('openai/gpt-4o')
      expect(catalog.models.map((m) => m.label)).toEqual([
        'GPT-4o',
        'GPT-4o Mini',
        'Claude Sonnet 4.5',
        'Claude Haiku 4.5',
        'Gemini 2.5 Flash',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('sendMessage payload', () => {
  it('posts conversation_id, message and model then streams SSE', async () => {
    const originalFetch = globalThis.fetch
    let posted: unknown
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      posted = JSON.parse(String(init?.body))
      return sseResponse()
    }) as typeof fetch
    try {
      const result = await sendMessage(1, 'Explique les listes.', 'openai/gpt-4o', () => undefined)
      expect(posted).toEqual({
        conversation_id: 1,
        message: 'Explique les listes.',
        model: 'openai/gpt-4o',
      })
      expect(result.reply).toBe('ok')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reuses the same conversation_id after a model change', async () => {
    const originalFetch = globalThis.fetch
    const bodies: Array<{ conversation_id: number; message: string; model: string }> = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return sseResponse()
    }) as typeof fetch
    try {
      await sendMessage(7, 'premier', 'openai/gpt-4o', () => undefined)
      await sendMessage(7, 'deuxième', 'anthropic/claude-sonnet-4-5-20250929', () => undefined)
      await sendMessage(7, 'troisième', 'google/gemini-2.5-flash', () => undefined)
      expect(bodies.map((b) => b.conversation_id)).toEqual([7, 7, 7])
      expect(bodies.map((b) => b.model)).toEqual([
        'openai/gpt-4o',
        'anthropic/claude-sonnet-4-5-20250929',
        'google/gemini-2.5-flash',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('createNote', () => {
  it('posts to /notes and never calls /chat', async () => {
    const originalFetch = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return jsonResponse(201, {
        seq: 4,
        role: 'note',
        content: 'réviser',
        created_at: '2026-10-07T04:37:00',
      })
    }) as typeof fetch
    try {
      const note = await createNote(1, 'réviser')
      expect(urls).toEqual(['/api/conversations/1/notes'])
      expect(urls.some((url) => url.includes('/chat'))).toBe(false)
      expect(note.role).toBe('note')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
