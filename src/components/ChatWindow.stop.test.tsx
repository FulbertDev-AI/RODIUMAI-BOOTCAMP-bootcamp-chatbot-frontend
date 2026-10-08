import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatWindow from './ChatWindow.tsx'

const base = {
  messages: [{ role: 'user' as const, content: 'salut' }, { role: 'assistant' as const, content: '' }],
  chatDisabled: false,
  draft: '',
  onDraftChange: () => undefined,
  onSend: () => undefined,
  onStop: () => undefined,
  onCreateNote: async () => undefined,
  models: [{ id: 'openai/gpt-4o', label: 'GPT-4o' }],
  selectedModel: 'openai/gpt-4o',
  modelsLoading: false,
  onModelChange: () => undefined,
}

describe('Stop button', () => {
  it('shows Arrêter while a request is in progress, including before the first delta', () => {
    const html = renderToStaticMarkup(
      <ChatWindow {...base} loading={true} streaming={false} />,
    )
    expect(html).toContain('Arrêter')
    expect(html).toContain('stop-button')
    expect(html).not.toContain('Envoyer')
  })

  it('keeps Arrêter visible after several deltas', () => {
    const html = renderToStaticMarkup(
      <ChatWindow
        {...base}
        messages={[
          { role: 'user', content: 'salut' },
          { role: 'assistant', content: 'Bonjour comment allez' },
        ]}
        loading={true}
        streaming={true}
      />,
    )
    expect(html).toContain('Arrêter')
    expect(html).toContain('Bonjour comment allez')
  })

  it('hides Arrêter when idle and does not show a Retry banner', () => {
    const html = renderToStaticMarkup(
      <ChatWindow
        {...base}
        messages={[]}
        loading={false}
        streaming={false}
        draft="hello"
      />,
    )
    expect(html).toContain('Envoyer')
    expect(html).not.toContain('Arrêter')
    expect(html).not.toContain('Réessayer')
    expect(html).not.toContain("Impossible d'obtenir une réponse.")
  })
})
