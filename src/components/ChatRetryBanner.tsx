interface ChatRetryBannerProps {
  retrying: boolean
  onRetry: () => void
}

export default function ChatRetryBanner({ retrying, onRetry }: ChatRetryBannerProps) {
  return (
    <div className="error error-retry" role="alert">
      <p className="error-retry-message">Impossible d'obtenir une réponse.</p>
      <button type="button" className="retry-button" disabled={retrying} onClick={onRetry}>
        Réessayer
      </button>
    </div>
  )
}
