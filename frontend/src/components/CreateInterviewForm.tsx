import { useState } from 'react'
import type { FormEvent } from 'react'
import { AI_POLICIES, createSession, parseDomains } from '../sessions'
import type { AiUsage, InterviewSession } from '../sessions'

export function CreateInterviewForm({ onCreated, onCancel }: {
  onCreated: (session: InterviewSession, code: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [candidate, setCandidate] = useState('')
  const [aiUsage, setAiUsage] = useState<AiUsage | ''>('')
  const [allowed, setAllowed] = useState('')
  const [restricted, setRestricted] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError('')
    let input
    try {
      if (!title.trim() || title.trim().length > 200) throw new Error('Enter an interview title between 1 and 200 characters.')
      if (candidate.trim().length > 120) throw new Error('Candidate names must be at most 120 characters.')
      if (!aiUsage) throw new Error('Choose an AI-use policy.')
      const allowedDomains = parseDomains(allowed)
      const restrictedDomains = parseDomains(restricted)
      if (allowedDomains.some(domain => restrictedDomains.includes(domain))) throw new Error('A hostname cannot appear in both the allowed and restricted lists.')
      input = {
        title: title.trim(),
        ...(candidate.trim() ? { candidate_name: candidate.trim() } : {}),
        policy: { ai_usage: aiUsage, allowed_domains: allowedDomains, restricted_domains: restrictedDomains },
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the form and try again.')
      return
    }
    setSubmitting(true)
    try {
      const result = await createSession(input)
      onCreated(result.session, result.joinCode)
    } catch (error) {
      setError(`${error instanceof Error ? error.message : 'Could not create the interview.'} If the request reached the backend, it may have created a session. Refresh the list before submitting again; a lost join code cannot be recovered.`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="sessions-panel form-panel" aria-labelledby="create-heading">
      <div className="panel-heading"><h2 id="create-heading">Create Interview</h2></div>
      <form onSubmit={submit} className="interview-form">
        <p className="field-hint">Set expectations before sharing the candidate’s join code. Fields marked * are required.</p>
        <fieldset disabled={submitting}>
          <div className="form-grid">
            <label>Interview title *<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Backend Engineer Interview" /></label>
            <label>Candidate name <span className="optional">(optional)</span><input maxLength={120} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder="Jordan Lee" /></label>
            <label className="full-width">AI-use policy *<select required value={aiUsage} onChange={event => setAiUsage(event.target.value as AiUsage | '')}>
              <option value="" disabled>Select a policy</option>
              {Object.entries(AI_POLICIES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <p id="domains-hint" className="field-hint full-width">Enter up to 50 hostnames per list, separated by commas or new lines. Use chatgpt.com, rather than URLs such as https://chatgpt.com. Paths and ports are not accepted. A hostname cannot be in both lists.</p>
            <label>Allowed domains <span className="optional">(optional)</span><textarea rows={3} value={allowed} onChange={event => setAllowed(event.target.value)} placeholder="docs.python.org, github.com" aria-describedby="domains-hint" /></label>
            <label>Restricted domains <span className="optional">(optional)</span><textarea rows={3} value={restricted} onChange={event => setRestricted(event.target.value)} placeholder="chatgpt.com, claude.ai" aria-describedby="domains-hint" /></label>
          </div>
          <div className="form-actions"><button className="create-button" type="submit">{submitting ? 'Creating interview…' : 'Create Interview'}</button><button className="connection-button" type="button" onClick={onCancel}>Cancel</button></div>
        </fieldset>
        {submitting && <p role="status" className="connection-status">Creating your interview. Please keep this page open for the one-time join code.</p>}
        {error && <p role="alert" className="connection-status connection-error">{error}</p>}
      </form>
    </section>
  )
}
