import { useState } from 'react'
import { checkBackendHealth } from '../api'

type ConnectionState =
  | { status: 'idle' | 'loading' }
  | { status: 'success' | 'error'; message: string }

export function BackendConnectionTest() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' })
  const isLoading = connection.status === 'loading'

  async function testConnection() {
    setConnection({ status: 'loading' })
    try {
      await checkBackendHealth()
      setConnection({ status: 'success', message: 'Backend connection successful!' })
    } catch (error) {
      setConnection({
        status: 'error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.',
      })
    }
  }

  return (
    <div className="backend-connection-test">
      <button className="connection-button" type="button" onClick={testConnection} disabled={isLoading} aria-describedby="backend-connection-status">
        {isLoading ? 'Testing backend connection…' : 'Test Backend Connection'}
      </button>
      <p id="backend-connection-status" className={`connection-status${connection.status === 'error' ? ' connection-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {isLoading ? 'Checking backend health…' : 'message' in connection ? connection.message : ''}
      </p>
    </div>
  )
}
