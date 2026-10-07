import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ModelSelect from './ModelSelect.tsx'

const MODELS = [
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'anthropic/claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
]

describe('ModelSelect', () => {
  it('renders the five backend labels with exact ids as values', () => {
    const html = renderToStaticMarkup(
      <ModelSelect
        models={MODELS}
        value="openai/gpt-4o"
        loading={false}
        disabled={false}
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('for="model-select"')
    expect(html).toContain('id="model-select"')
    for (const model of MODELS) {
      expect(html).toContain(`value="${model.id}"`)
      expect(html).toContain(model.label)
    }
    expect(html).toContain('selected=""')
  })

  it('uses the backend default as the selected option', () => {
    const html = renderToStaticMarkup(
      <ModelSelect
        models={MODELS}
        value="openai/gpt-4o"
        loading={false}
        disabled={false}
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('value="openai/gpt-4o" selected=""')
  })

  it('reflects a different selectedModel without resetting the list', () => {
    const html = renderToStaticMarkup(
      <ModelSelect
        models={MODELS}
        value="google/gemini-2.5-flash"
        loading={false}
        disabled={false}
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('value="google/gemini-2.5-flash" selected=""')
    expect(html).toContain('Claude Sonnet 4.5')
  })

  it('does not render an empty selector while loading or when there are no models', () => {
    const loading = renderToStaticMarkup(
      <ModelSelect models={[]} value="" loading={true} disabled={true} onChange={() => undefined} />,
    )
    expect(loading).toContain('Chargement des modèles…')
    expect(loading).not.toContain('<select')

    const empty = renderToStaticMarkup(
      <ModelSelect models={[]} value="" loading={false} disabled={true} onChange={() => undefined} />,
    )
    expect(empty).toBe('')
  })
})
