import { abortError, isAbortError } from './abort.ts'

export type TokenUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type SseEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; reply: string; notification: string | null; usage: TokenUsage | null }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'end' }

export interface StreamChatResult {
  reply: string
  notification: string | null
  usage: TokenUsage | null
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readFiniteNumber(source[key])
    if (value != null) return value
  }
  return undefined
}

export function hasTokenUsage(usage: TokenUsage | null | undefined): usage is TokenUsage {
  return Boolean(
    usage &&
      (usage.total_tokens != null || usage.prompt_tokens != null || usage.completion_tokens != null),
  )
}

export function parseTokenUsage(value: unknown): TokenUsage | null {
  if (value == null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const nested =
    raw.usage != null && typeof raw.usage === 'object' && !Array.isArray(raw.usage)
      ? (raw.usage as Record<string, unknown>)
      : raw
  const usage: TokenUsage = {}
  const prompt = pickNumber(nested, [
    'prompt_tokens',
    'input_tokens',
    'promptTokens',
    'inputTokens',
    'prompt',
    'input',
  ])
  const completion = pickNumber(nested, [
    'completion_tokens',
    'output_tokens',
    'completionTokens',
    'outputTokens',
    'completion',
    'output',
  ])
  const total = pickNumber(nested, ['total_tokens', 'totalTokens', 'total'])
  if (prompt != null) usage.prompt_tokens = prompt
  if (completion != null) usage.completion_tokens = completion
  if (total != null) usage.total_tokens = total
  return hasTokenUsage(usage) ? usage : null
}

export function formatTokenUsage(usage: TokenUsage): string {
  const parts: string[] = []
  if (usage.total_tokens != null) parts.push(`${usage.total_tokens} tokens`)
  if (usage.prompt_tokens != null) parts.push(`${usage.prompt_tokens} entrée`)
  if (usage.completion_tokens != null) parts.push(`${usage.completion_tokens} sortie`)
  return parts.join(' · ')
}

/** Incremental SSE parser: HTTP chunks are not SSE events. */
export class SseParser {
  private buffer = ''

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk
    return this.consume(false)
  }

  /** Parse any leftover line(s) when the HTTP stream closes. */
  end(): SseEvent[] {
    return this.consume(true)
  }

  private consume(flush: boolean): SseEvent[] {
    const events: SseEvent[] = []
    const lines = this.buffer.split(/\r\n|\n|\r/)
    this.buffer = flush ? '' : (lines.pop() ?? '')

    const dataLines: string[] = []
    const dispatch = () => {
      if (dataLines.length === 0) return
      const parsed = parseDataPayload(dataLines.join('\n'))
      dataLines.length = 0
      if (parsed) events.push(parsed)
    }

    for (const line of lines) {
      if (line === '') {
        dispatch()
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('data:')) {
        dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
      }
    }

    if (flush) dispatch()
    else if (dataLines.length > 0) {
      // Incomplete event: put the data lines back (without a trailing blank line).
      const rest = dataLines.map((d) => `data: ${d}`).join('\n')
      this.buffer = this.buffer ? `${rest}\n${this.buffer}` : rest
    }

    return events
  }
}

function parseDataPayload(payload: string): SseEvent | null {
  if (payload === '[DONE]') return { type: 'end' }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new Error('Événement SSE illisible.')
  }
  if (!parsed || typeof parsed !== 'object') return null

  const event = parsed as {
    type?: unknown
    content?: unknown
    reply?: unknown
    notification?: unknown
    message?: unknown
    usage?: unknown
  }
  if (event.type === 'delta' && typeof event.content === 'string') {
    return { type: 'delta', content: event.content }
  }
  if (event.type === 'done') {
    const reply = typeof event.reply === 'string' ? event.reply : typeof event.content === 'string' ? event.content : null
    if (reply == null) return null
    const notification = event.notification == null ? null : String(event.notification)
    const usage = parseTokenUsage(event.usage) ?? parseTokenUsage(event)
    return { type: 'done', reply, notification, usage }
  }
  if (event.type === 'usage') {
    const usage = parseTokenUsage(event.usage) ?? parseTokenUsage(event)
    return usage ? { type: 'usage', usage } : null
  }
  if (event.type === 'error' && typeof event.message === 'string') {
    return { type: 'error', message: event.message }
  }
  return null
}

export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void,
  signal?: AbortSignal,
): Promise<StreamChatResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  const acc: {
    result: StreamChatResult | null
    pendingUsage: TokenUsage | null
    streamError: string | null
    ended: boolean
  } = { result: null, pendingUsage: null, streamError: null, ended: false }

  const throwIfAborted = () => {
    if (signal?.aborted) throw abortError()
  }

  const apply = (events: SseEvent[]) => {
    if (signal?.aborted) return
    for (const event of events) {
      if (event.type === 'delta') onDelta(event.content)
      else if (event.type === 'done') {
        acc.result = {
          reply: event.reply,
          notification: event.notification,
          usage: event.usage ?? acc.pendingUsage,
        }
      } else if (event.type === 'usage') {
        acc.pendingUsage = event.usage
        if (acc.result) acc.result = { ...acc.result, usage: event.usage }
      } else if (event.type === 'error') acc.streamError = event.message
      else if (event.type === 'end') acc.ended = true
    }
  }

  const onAbort = () => {
    reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort)

  try {
    throwIfAborted()
    while (!acc.ended) {
      throwIfAborted()
      const { done, value } = await reader.read()
      throwIfAborted()
      if (done) {
        apply(parser.feed(decoder.decode()))
        apply(parser.end())
        break
      }
      apply(parser.feed(decoder.decode(value, { stream: true })))
      throwIfAborted()
      if (acc.streamError || acc.ended) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw isAbortError(err) ? err : abortError()
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      // Already released after cancel().
    }
  }

  throwIfAborted()
  if (acc.streamError) throw new Error(acc.streamError)
  if (!acc.result) throw new Error('La réponse a été interrompue.')
  return {
    ...acc.result,
    usage: acc.result.usage ?? acc.pendingUsage,
  }
}
