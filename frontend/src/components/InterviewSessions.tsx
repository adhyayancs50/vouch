import { useEffect, useState } from 'react'
import { AI_POLICIES, formatDate, listSessions } from '../sessions'
import type { InterviewSession, SessionList } from '../sessions'
import { CreateInterviewForm } from './CreateInterviewForm'
import { Icon } from './Icon'
import { JoinCodeNotice } from './JoinCodeNotice'
import { SessionDetails } from './SessionDetails'
import { SessionEmptyState } from './SessionEmptyState'

export function InterviewSessions() {
  const [formOpen, setFormOpen] = useState(false)
  const [joinCode, setJoinCode] = useState<string | null>(null)
  const [list, setList] = useState<SessionList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listSessions().then(data => {
      if (active) setList(data)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Could not load interview sessions.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  function created(session: InterviewSession, code: string) {
    setFormOpen(false)
    setJoinCode(code)
    setList(previous => ({ total_sessions: (previous?.total_sessions || 0) + 1, sessions: [session, ...(previous?.sessions || [])] }))
    setRevision(value => value + 1)
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">YOUR WORKSPACE</p><h1 id="page-heading">Interview Sessions</h1><p className="page-description">A clearer picture of every interview, with privacy at the heart.</p></div>
        <div className="create-action"><button className="create-button" type="button" disabled={formOpen || joinCode !== null} onClick={() => setFormOpen(true)} aria-describedby={joinCode ? 'create-note' : undefined}><Icon name="plus" />Create Interview</button>{joinCode && <span id="create-note">Save and dismiss your code to create another interview.</span>}</div>
      </div>
      <p className="development-note">Local development workspace. The employer header separates test data; it is not secure authentication.</p>
      {formOpen && <CreateInterviewForm onCreated={created} onCancel={() => setFormOpen(false)} />}
      {joinCode && <JoinCodeNotice code={joinCode} onDismiss={() => setJoinCode(null)} />}
      <div className="list-toolbar"><p className="field-hint">Dates are shown in your local time. Refresh to check whether a candidate has joined.</p><button className="connection-button" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? 'Loading sessions…' : 'Refresh sessions'}</button></div>
      {loading && <p className="connection-status" role="status">Loading interview sessions…</p>}
      {error && <p className="connection-status connection-error" role="alert">{error} Use Refresh sessions to try again.</p>}
      {list && list.sessions.length === 0 && !loading && !error && <SessionEmptyState />}
      {list && list.sessions.length > 0 && <section className="sessions-panel" aria-labelledby="list-heading" aria-busy={loading}>
        <div className="panel-heading"><h2 id="list-heading">Your sessions</h2><span className="badge">{list.total_sessions} {list.total_sessions === 1 ? 'interview' : 'interviews'}</span></div>
        <div className="table-scroll"><table className="sessions-table">
          <caption className="sr-only">Interview sessions. Select an interview title to view its details.</caption>
          <thead><tr><th scope="col">Interview title</th><th scope="col">Candidate</th><th scope="col">AI-use policy</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Join-code expiration</th></tr></thead>
          <tbody>{list.sessions.map(session => <tr key={session.session_id}>
            <td><button className="session-title" type="button" aria-expanded={selectedId === session.session_id} onClick={() => setSelectedId(session.session_id)}>{session.title}</button></td>
            <td>{session.candidate?.name || session.candidate_name || 'Not provided'}</td>
            <td>{AI_POLICIES[session.policy.ai_usage]}</td><td><span className="badge">{session.status}</span></td>
            <td>{formatDate(session.created_at)}</td><td>{formatDate(session.join_code_expires_at)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      {selectedId && <SessionDetails key={selectedId} sessionId={selectedId} revision={revision} onClose={() => setSelectedId(null)} />}
    </>
  )
}
