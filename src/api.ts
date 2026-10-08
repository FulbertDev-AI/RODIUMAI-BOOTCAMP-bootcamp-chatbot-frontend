// Thin typed wrappers around the FastAPI backend (proxied under /api by Vite).

import { isAbortError } from './abort.ts'
import { consumeChatStream, type StreamChatResult } from './sse.ts'

export type { TokenUsage } from './sse.ts'

export type Role = 'user' | 'assistant' | 'system-notification' | 'note'

export interface ConversationSummary {
  id: number
  created_at: string
  preview: string | null
}

export interface Message {
  seq: number
  role: Role
  content: string
  created_at: string
}

export function errorFromHttpBody(status: number, body: unknown): Error {
  const detail =
    body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail
      : null
  return new Error(detail ?? `Erreur ${status}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw errorFromHttpBody(response.status, body)
  }
  return response.json() as Promise<T>
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request('/conversations')
}

export async function createConversation(): Promise<number> {
  const { conversation_id } = await request<{ conversation_id: number }>('/conversations', {
    method: 'POST',
  })
  return conversation_id
}

export function getMessages(conversationId: number): Promise<Message[]> {
  return request(`/conversations/${conversationId}/messages`)
}

export type ChatResult = StreamChatResult

export interface ModelOption {
  id: string
  label: string
}

export interface ModelsCatalog {
  default: string
  models: ModelOption[]
}

export function parseModelsCatalog(body: unknown): ModelsCatalog {
  if (!body || typeof body !== 'object') {
    throw new Error('Liste de modèles invalide.')
  }
  const raw = body as { default?: unknown; models?: unknown }
  if (!Array.isArray(raw.models) || raw.models.length === 0) {
    throw new Error('Aucun modèle disponible.')
  }
  const models: ModelOption[] = []
  for (const item of raw.models) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    const label = (item as { label?: unknown }).label
    if (typeof id === 'string' && id.trim() && typeof label === 'string' && label.trim()) {
      models.push({ id, label })
    }
  }
  if (models.length === 0) {
    throw new Error('Aucun modèle disponible.')
  }
  const declared = typeof raw.default === 'string' ? raw.default : ''
  const defaultId = models.some((m) => m.id === declared) ? declared : models[0].id
  return { default: defaultId, models }
}

export async function getModels(): Promise<ModelsCatalog> {
  return parseModelsCatalog(await request<unknown>('/models'))
}

export async function sendMessage(
  conversationId: number,
  message: string,
  model: string,
  onDelta: (content: string) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, message, model }),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw errorFromHttpBody(response.status, body)
  }
  if (!response.body) {
    throw new Error('La réponse a été interrompue.')
  }
  return consumeChatStream(response.body, onDelta, signal)
}

export interface CreateNoteRequest {
  content: string
}

export type CreateNoteResponse = Message

export function createNote(conversationId: number, content: string): Promise<CreateNoteResponse> {
  const body: CreateNoteRequest = { content }
  return request<CreateNoteResponse>(`/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
