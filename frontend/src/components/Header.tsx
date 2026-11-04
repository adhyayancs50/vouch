import { Icon } from './Icon'

export function Header() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#main" aria-label="Vouch home">
          <span className="brand-mark"><Icon name="check" /></span>
          <span>vouch<span className="brand-period">.</span></span>
        </a>
        <nav aria-label="Main navigation">
          <a className="nav-link active" href="#sessions" aria-current="page"><Icon name="sessions" />Sessions</a>
          <a className="nav-link" href="#about">About Vouch</a>
        </nav>
        <span className="workspace-label">Employer workspace</span>
      </div>
    </header>
  )
}
