import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatRetryBanner from './ChatRetryBanner.tsx'

describe('ChatRetryBanner', () => {
  it('shows the error and an enabled Retry button', () => {
    const html = renderToStaticMarkup(<ChatRetryBanner retrying={false} onRetry={() => undefined} />)
    expect(html).toContain('Impossible d&#x27;obtenir une réponse.')
    expect(html).toContain('Réessayer')
    expect(html).not.toContain('disabled')
  })

  it('disables Retry while a retry is streaming', () => {
    const html = renderToStaticMarkup(<ChatRetryBanner retrying={true} onRetry={() => undefined} />)
    expect(html).toContain('disabled')
    expect(html).toContain('Réessayer')
  })
})
