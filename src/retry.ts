export interface FailedChatRequest {
  conversationId: number
  message: string
  model: string
}

export function shouldShowRetry(
  failed: FailedChatRequest | null,
  activeId: number | null,
): boolean {
  return failed !== null && activeId !== null && failed.conversationId === activeId
}

/** Payload for a retry: frozen at first send, ignores the current model selector. */
export function retryChatPayload(failed: FailedChatRequest): {
  conversation_id: number
  message: string
  model: string
} {
  return {
    conversation_id: failed.conversationId,
    message: failed.message,
    model: failed.model,
  }
}

export function modelForRetry(failed: FailedChatRequest, _selectedModel: string): string {
  return failed.model
}
