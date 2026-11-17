import { useEffect, useRef, useState } from 'react'

export function JoinCodeNotice({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  const [copyStatus, setCopyStatus] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyStatus('Code copied. Share it privately with the candidate.')
    } catch {
      setCopyStatus('Could not copy automatically. Select the code above and copy it manually.')
    }
  }
  return (
    <section className="sessions-panel join-code-panel" aria-labelledby="join-code-heading">
      <h2 id="join-code-heading" tabIndex={-1} ref={heading}>Interview created</h2>
      <p>Candidate join code</p>
      <p className="join-code" aria-label="Candidate join code">{code}</p>
      <p>This code is shown only once. Copy and share it privately now. It cannot be retrieved after you dismiss this message or leave or reload the page.</p>
      <div className="form-actions"><button className="create-button" type="button" onClick={copy}>Copy Code</button><button className="connection-button" type="button" onClick={onDismiss}>I’ve saved the code — dismiss</button></div>
      <p role="status" className="connection-status">{copyStatus}</p>
    </section>
  )
}
