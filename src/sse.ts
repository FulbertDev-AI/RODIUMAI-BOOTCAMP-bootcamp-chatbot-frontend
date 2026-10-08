import { abortError, isAbortError } from './abort.ts'

export type TokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type SseEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; reply: string; notification: string | null; usage: TokenUsage | null }
  | { type: 'error'; message: string }
  | { type: 'end' }

export interface StreamChatResult {
  reply: string
  notification: string | null
  usage: TokenUsage | null
}

export function parseTokenUsage(value: unknown): TokenUsage | null {
  if (value == null || typeof value !== 'object') return null
  const raw = value as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  if (
    typeof raw.prompt_tokens !== 'number' ||
    typeof raw.completion_tokens !== 'number' ||
    typeof raw.total_tokens !== 'number' ||
    !Number.isFinite(raw.prompt_tokens) ||
    !Number.isFinite(raw.completion_tokens) ||
    !Number.isFinite(raw.total_tokens)
  ) {
    return null
  }
  return {
    prompt_tokens: raw.prompt_tokens,
    completion_tokens: raw.completion_tokens,
    total_tokens: raw.total_tokens,
  }
}

export function formatTokenUsage(usage: TokenUsage): string {
  return `${usage.total_tokens} tokens · ${usage.prompt_tokens} entrée · ${usage.completion_tokens} sortie`
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
  if (event.type === 'done' && typeof event.reply === 'string') {
    const notification = event.notification == null ? null : String(event.notification)
    return { type: 'done', reply: event.reply, notification, usage: parseTokenUsage(event.usage) }
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
  let result: StreamChatResult | null = null
  let streamError: string | null = null
  let ended = false

  const throwIfAborted = () => {
    if (signal?.aborted) throw abortError()
  }

  const apply = (events: SseEvent[]) => {
    for (const event of events) {
      if (event.type === 'delta') onDelta(event.content)
      else if (event.type === 'done') {
        result = { reply: event.reply, notification: event.notification, usage: event.usage }
      }
      else if (event.type === 'error') streamError = event.message
      else if (event.type === 'end') ended = true
    }
  }

  try {
    throwIfAborted()
    while (!ended) {
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
      if (streamError || ended) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw isAbortError(err) ? err : abortError()
    throw err
  } finally {
    reader.releaseLock()
  }

  throwIfAborted()
  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('La réponse a été interrompue.')
  return result
}
