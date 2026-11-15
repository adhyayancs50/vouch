import { API_BASE_URL, DEV_EMPLOYER_KEY } from './config'

const errorMessages: Record<string, string> = {
  DEV_EMPLOYER_REQUIRED: 'Set VITE_DEV_EMPLOYER_KEY in frontend/.env.local and restart Vite. Employer requests require a development identity.',
  DEV_EMPLOYER_INVALID: 'Check VITE_DEV_EMPLOYER_KEY: use 1–64 characters, starting with a letter or digit, followed by letters, digits, dots, underscores or hyphens. Restart Vite after changing it.',
  SESSION_NOT_FOUND: 'This interview session could not be found for this employer. Refresh the session list.',
  NOT_FOUND: 'The session API is unavailable. Run the backend with VOUCH_ENV=development and VOUCH_ENABLE_DEV_ENDPOINTS=true.',
  VALIDATION_ERROR: 'Check the title, candidate name and domain lists. Use up to 50 hostnames per list, with no domain in both lists.',
  FORBIDDEN: 'Development session endpoints are available only from the same machine as the backend.',
  INTERNAL_ERROR: 'The backend encountered an error. Please try again later.',
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string) {
    // Never echo response messages/details, which may contain submitted values.
    super(errorMessages[code] || `The backend returned HTTP ${status}. Please try again later.`)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function requestJson(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; employer?: boolean } = {}): Promise<unknown> {
  if (options.employer && !DEV_EMPLOYER_KEY) throw new ApiError(401, 'DEV_EMPLOYER_REQUIRED')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}/${path.replace(/^\/+/, '')}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.employer ? { 'X-Vouch-Dev-Employer': DEV_EMPLOYER_KEY } : {}),
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw new Error('The backend did not respond within 10 seconds. Please try again.')
      }
      throw new Error(`Could not reach the backend at ${API_BASE_URL}. Check that it is running and allows requests from ${window.location.origin} (CORS).`)
    }

    if (!response.ok) {
      let code = ''
      try {
        const data = await response.json()
        if (typeof data?.error?.code === 'string' && Object.hasOwn(errorMessages, data.error.code)) code = data.error.code
      } catch { /* Fall back to the HTTP status for non-JSON errors. */ }
      throw new ApiError(response.status, code)
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

export function getJson(path: string): Promise<unknown> {
  return requestJson(path)
}

export function getEmployerJson(path: string): Promise<unknown> {
  return requestJson(path, { employer: true })
}

export function postEmployerJson(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, { method: 'POST', body, employer: true })
}

export async function checkBackendHealth(): Promise<void> {
  const data = await getJson('/health')
  if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'healthy') {
    throw new Error('The backend responded, but its status was not "healthy".')
  }
}
