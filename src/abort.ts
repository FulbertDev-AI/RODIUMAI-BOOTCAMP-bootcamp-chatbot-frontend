export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError'
}

export function abortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
