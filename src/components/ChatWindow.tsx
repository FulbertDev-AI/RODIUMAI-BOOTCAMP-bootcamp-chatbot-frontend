import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import type { ModelOption, Role, TokenUsage } from '../api'
import { formatTokenUsage, hasTokenUsage } from '../sse'
import ModelSelect from './ModelSelect'
import NoteComposer from './NoteComposer'

export interface ChatMessage {
  role: Role
  content: string
  usage?: TokenUsage | null
}

interface ChatWindowProps {
  messages: ChatMessage[]
  loading: boolean
  streaming: boolean
  chatDisabled: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onCreateNote: (content: string) => Promise<void>
  models: ModelOption[]
  selectedModel: string
  modelsLoading: boolean
  onModelChange: (modelId: string) => void
}

function renderMessage(m: ChatMessage, i: number, streamingTail: boolean) {
  if (m.role === 'system-notification') {
    return (
      <div key={i} className="notification">
        {m.content}
      </div>
    )
  }
  if (m.role === 'note') {
    return (
      <div key={i} className="note">
        <span className="note-label">📝 Note personnelle</span>
        <p className="note-content">{m.content}</p>
      </div>
    )
  }
  const bubble = (
    <div className={`bubble ${m.role}${streamingTail ? ' streaming' : ''}`}>
      {m.role === 'assistant' ? (
        m.content ? (
          <Markdown>{m.content}</Markdown>
        ) : (
          <span className="typing">…</span>
        )
      ) : (
        m.content
      )}
    </div>
  )
  if (m.role === 'assistant') {
    const usage = m.usage
    const showUsage = hasTokenUsage(usage) && !streamingTail
    return (
      <div key={i} className="assistant-turn">
        {bubble}
        {showUsage ? <p className="token-usage">{formatTokenUsage(usage)}</p> : null}
      </div>
    )
  }
  return (
    <div key={i} className={`bubble ${m.role}`}>
      {m.content}
    </div>
  )
}

export default function ChatWindow({
  messages,
  loading,
  streaming,
  chatDisabled,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onCreateNote,
  models,
  selectedModel,
  modelsLoading,
  onModelChange,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loading && !chatDisabled && draft.trim()) onSend()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line.
    if (event.key === 'Enter' && !event.shiftKey) handleSubmit(event)
  }

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && !loading && (
          <p className="muted center">Pose ta première question à Study Buddy.</p>
        )}
        {messages.map((m, i) =>
          renderMessage(m, i, Boolean(streaming && i === messages.length - 1 && m.role === 'assistant')),
        )}
        <div ref={bottomRef} />
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <ModelSelect
          models={models}
          value={selectedModel}
          loading={modelsLoading}
          disabled={loading}
          onChange={onModelChange}
        />
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écris ton message…"
          rows={2}
          disabled={loading || chatDisabled}
          autoFocus
        />
        {loading ? (
          <button type="button" className="stop-button" onClick={onStop}>
            Arrêter
          </button>
        ) : (
          <button type="submit" disabled={chatDisabled || !draft.trim()}>
            Envoyer
          </button>
        )}
      </form>
      <NoteComposer disabled={loading} onCreate={onCreateNote} />
    </section>
  )
}
