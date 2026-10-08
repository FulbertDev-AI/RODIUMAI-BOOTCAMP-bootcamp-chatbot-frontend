import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatWindow from './ChatWindow.tsx'

const usage = { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }

const base = {
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

describe('token usage display', () => {
  it('shows usage only after streaming has finished', () => {
    const done = renderToStaticMarkup(
      <ChatWindow
        {...base}
        loading={false}
        streaming={false}
        messages={[
          { role: 'user', content: 'salut' },
          { role: 'assistant', content: 'Bonjour', usage },
        ]}
      />,
    )
    expect(done).toContain('125 tokens · 100 entrée · 25 sortie')

    const live = renderToStaticMarkup(
      <ChatWindow
        {...base}
        loading={true}
        streaming={true}
        messages={[
          { role: 'user', content: 'salut' },
          { role: 'assistant', content: 'Bon', usage },
        ]}
      />,
    )
    expect(live).not.toContain('tokens ·')
  })

  it('renders nothing extra when usage is null', () => {
    const html = renderToStaticMarkup(
      <ChatWindow
        {...base}
        loading={false}
        streaming={false}
        messages={[
          { role: 'user', content: 'salut' },
          { role: 'assistant', content: 'Bonjour', usage: null },
        ]}
      />,
    )
    expect(html).toContain('Bonjour')
    expect(html).not.toContain('token-usage')
    expect(html).not.toContain('tokens ·')
  })
})
