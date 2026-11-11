import { API_BASE_URL } from './config'

export async function getJson(path: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}/${path.replace(/^\/+/, '')}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw new Error('The backend did not respond within 10 seconds. Please try again.')
      }
      throw new Error(`Could not reach the backend at ${API_BASE_URL}. Check that it is running and allows requests from ${window.location.origin} (CORS).`)
    }

    if (!response.ok) {
      throw new Error(`The backend returned HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}. Please check the backend server.`)
    }

    try {
      return await response.json()
    } catch {
      if (controller.signal.aborted) {
        throw new Error('The backend did not respond within 10 seconds. Please try again.')
      }
      throw new Error('The backend returned an invalid JSON response.')
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkBackendHealth(): Promise<void> {
  const data = await getJson('/health')
  if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'healthy') {
    throw new Error('The backend responded, but its status was not "healthy".')
  }
}
