import { Icon } from './Icon'

export function SessionEmptyState() {
  return (
    <section className="sessions-panel" aria-labelledby="empty-heading">
      <div className="panel-heading"><h2>Your sessions</h2><span className="badge">Getting started</span></div>
      <div className="empty-state">
        <div className="session-illustration" aria-hidden="true">
          <div className="illustration-window">
            <div className="window-bar"><i /><i /><i /></div>
            <div className="window-content"><span className="illustration-avatar" /><span className="illustration-lines"><i /><i /></span><span className="illustration-check"><Icon name="check" /></span></div>
            <div className="window-line" /><div className="window-line short" />
          </div>
          <span className="floating-icon"><Icon name="sessions" /></span>
        </div>
        <h3 id="empty-heading">A little clarity starts here.</h3>
        <p>No interview sessions have been created yet.<br className="desktop-break" /> This is where you’ll manage your interviews and review session reports.</p>
        <a className="text-link" href="#about">Get to know Vouch <Icon name="arrow" /></a>
      </div>
      <div className="panel-note"><Icon name="shield" /><span>Designed around transparency. Built with candidate privacy in mind.</span></div>
    </section>
  )
}
