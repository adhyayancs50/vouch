import { AboutVouch } from './components/AboutVouch'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { SessionEmptyState } from './components/SessionEmptyState'

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <main id="main" className="main-container" tabIndex={-1}>
        <section id="sessions" aria-labelledby="page-heading">
          <div className="page-heading">
            <div><p className="eyebrow">YOUR WORKSPACE</p><h1 id="page-heading">Interview Sessions</h1><p className="page-description">A clearer picture of every interview, with privacy at the heart.</p></div>
            <div className="create-action"><button className="create-button" type="button" disabled aria-describedby="create-note"><Icon name="plus" />Create Session</button><span id="create-note">Session creation is coming soon</span></div>
          </div>
          <SessionEmptyState />
        </section>
        <AboutVouch />
      </main>
      <footer className="site-footer"><span>Vouch · Interview with confidence.</span><span>Clear expectations. Informed decisions.</span></footer>
    </>
  )
}
