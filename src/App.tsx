import { useEffect, useRef, useState } from 'react'
import { isAbortError } from './abort'
import './App.css'
import {
  createConversation,
  createNote,
  getMessages,
  getModels,
  listConversations,
  sendMessage,
  type ConversationSummary,
  type ModelOption,
} from './api'
import ChatRetryBanner from './components/ChatRetryBanner'
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'
import { shouldShowRetry, type FailedChatRequest } from './retry'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Une erreur est survenue.'
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [modelsLoading, setModelsLoading] = useState(true)
  const [failedChat, setFailedChat] = useState<FailedChatRequest | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sending = loading || streaming
  const canChat = !modelsLoading && Boolean(selectedModel)
  const showRetry = shouldShowRetry(failedChat, activeId)

  // On startup, load the history and open the most recent conversation.
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    getModels()
      .then((catalog) => {
        setModels(catalog.models)
        setSelectedModel(catalog.default)
      })
      .catch((err) => {
        setModels([])
        setSelectedModel('')
        setError(`Impossible de charger les modèles. ${errorMessage(err)}`)
      })
      .finally(() => setModelsLoading(false))
  }, [])

  // Load the messages whenever another conversation is opened.
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list.map(({ role, content }) => ({ role, content })))
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [activeId])

  function selectConversation(id: number) {
    if (sending || id === activeId) return
    setError(null)
    setDraft('')
    setMessages([])
    setActiveId(id)
  }

  async function handleNew() {
    if (sending) return
    setError(null)
    try {
      const id = await createConversation()
      setConversations((list) => [
        { id, created_at: new Date().toISOString(), preview: null },
        ...list,
      ])
      setDraft('')
      setMessages([])
      setActiveId(id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function runChatTurn(request: FailedChatRequest, fromRetry: boolean) {
    if (sending || activeId !== request.conversationId) return
    const isFirstMessage = !messages.some((m) => m.role === 'user')
    setError(null)
    if (!fromRetry) setDraft('')
    setMessages((list) => [...list, { role: 'user', content: request.message }, { role: 'assistant', content: '' }])
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const { reply, notification, usage } = await sendMessage(
        request.conversationId,
        request.message,
        request.model,
        (delta) => {
          setStreaming(true)
          setMessages((list) => {
            const next = [...list]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', content: last.content + delta }
            }
            return next
          })
        },
        controller.signal,
      )
      setMessages((list) => {
        const next = [...list]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', content: reply, usage }
        }
        if (notification) next.push({ role: 'system-notification', content: notification })
        return next
      })
      setFailedChat(null)
      if (isFirstMessage) setConversations(await listConversations())
    } catch (err) {
      setMessages((list) => list.slice(0, -2))
      if (!fromRetry) setDraft(request.message)
      if (!isAbortError(err)) setFailedChat(request)
    } finally {
      abortRef.current = null
      setLoading(false)
      setStreaming(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  async function handleSend() {
    if (activeId === null || sending || !canChat) return
    const text = draft.trim()
    if (!text) return
    await runChatTurn({ conversationId: activeId, message: text, model: selectedModel }, false)
  }

  async function handleRetry() {
    if (!failedChat || sending) return
    await runChatTurn(failedChat, true)
  }

  async function handleCreateNote(content: string) {
    if (activeId === null) return
    setError(null)
    try {
      const note = await createNote(activeId, content)
      setMessages((list) => [...list, { role: note.role, content: note.content }])
    } catch (err) {
      setError(errorMessage(err))
      throw err
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
      />
      <main className="main">
        {showRetry ? (
          <ChatRetryBanner retrying={sending} onRetry={() => void handleRetry()} />
        ) : (
          error && (
            <div className="error" role="alert">
              {error}
              <button className="dismiss" onClick={() => setError(null)} aria-label="Fermer">
                ×
              </button>
            </div>
          )
        )}
        {activeId === null ? (
          <div className="empty">
            <p>Aucune conversation ouverte.</p>
            <button className="new-button" onClick={handleNew}>
              + Nouvelle conversation
            </button>
          </div>
        ) : (
          <ChatWindow
            messages={messages}
            loading={sending}
            streaming={streaming}
            chatDisabled={!canChat}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
            onStop={handleStop}
            onCreateNote={handleCreateNote}
            models={models}
            selectedModel={selectedModel}
            modelsLoading={modelsLoading}
            onModelChange={setSelectedModel}
          />
        )}
      </main>
    </div>
  )
}
