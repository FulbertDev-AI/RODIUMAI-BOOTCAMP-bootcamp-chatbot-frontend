import { useEffect, useState } from 'react'
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
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'

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

  const sending = loading || streaming
  const canChat = !modelsLoading && Boolean(selectedModel)

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

  async function handleSend() {
    if (activeId === null || sending || !canChat) return
    const text = draft.trim()
    const isFirstMessage = !messages.some((m) => m.role === 'user')
    setError(null)
    setDraft('')
    setMessages((list) => [...list, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setLoading(true)
    try {
      const { reply, notification } = await sendMessage(activeId, text, selectedModel, (delta) => {
        setStreaming(true)
        setMessages((list) => {
          const next = [...list]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = { role: 'assistant', content: last.content + delta }
          }
          return next
        })
      })
      setMessages((list) => {
        const next = [...list]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', content: reply }
        }
        if (notification) next.push({ role: 'system-notification', content: notification })
        return next
      })
      // The first message becomes the conversation's preview in the sidebar.
      if (isFirstMessage) setConversations(await listConversations())
    } catch (err) {
      // HTTP / SSE error: drop the optimistic user + incomplete assistant turn.
      setMessages((list) => list.slice(0, -2))
      setDraft(text)
      setError(errorMessage(err))
    } finally {
      setLoading(false)
      setStreaming(false)
    }
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
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Fermer">
              ×
            </button>
          </div>
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
