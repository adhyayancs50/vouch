import { useEffect, useRef, useState } from 'react'
import { AI_POLICIES, formatDate, getSession } from '../sessions'
import type { InterviewSession } from '../sessions'

export function SessionDetails({ sessionId, revision, onClose }: { sessionId: string; revision: number; onClose: () => void }) {
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getSession(sessionId).then(data => {
      if (active) setSession(data)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Could not load session details.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sessionId, revision, retry])

  return (
    <section className="sessions-panel details-panel" aria-labelledby="details-heading" aria-busy={loading}>
      <div className="panel-heading"><h2 id="details-heading" tabIndex={-1} ref={heading}>Session details</h2><div className="panel-actions"><button className="connection-button" type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh details</button><button className="connection-button" type="button" onClick={onClose}>Close</button></div></div>
      <div className="panel-body">
        {loading && <p role="status">Loading session details…</p>}
        {error && <p role="alert" className="connection-error">{error}</p>}
        {!loading && !error && session && <>
          <h3>{session.title}</h3>
          <dl className="details-grid">
            <div><dt>Status</dt><dd>{session.status}</dd></div>
            <div><dt>Candidate name entered by employer</dt><dd>{session.candidate_name || 'Not provided'}</dd></div>
            <div><dt>AI-use policy</dt><dd>{AI_POLICIES[session.policy.ai_usage]}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(session.created_at)}</dd></div>
            <div><dt>Join-code expiration</dt><dd>{formatDate(session.join_code_expires_at)}</dd></div>
            <div><dt>Joined</dt><dd>{session.joined_at ? formatDate(session.joined_at) : 'Candidate has not joined yet'}</dd></div>
            <div><dt>Allowed domains</dt><dd>{session.policy.allowed_domains.join(', ') || 'None specified'}</dd></div>
            <div><dt>Restricted domains</dt><dd>{session.policy.restricted_domains.join(', ') || 'None specified'}</dd></div>
            {session.candidate && <>
              <div><dt>Joined candidate name</dt><dd>{session.candidate.name || 'Not provided'}</dd></div>
              <div><dt>Candidate ID</dt><dd>{session.candidate.candidate_id}</dd></div>
              <div><dt>Candidate joined at</dt><dd>{formatDate(session.candidate.joined_at)}</dd></div>
            </>}
          </dl>
          <p className="field-hint">Join codes cannot be retrieved from session details. Dates are shown in your local time.</p>
        </>}
      </div>
    </section>
  )
}
