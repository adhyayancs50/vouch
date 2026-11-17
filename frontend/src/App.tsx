import { AboutVouch } from './components/AboutVouch'
import { BackendConnectionTest } from './components/BackendConnectionTest'
import { Header } from './components/Header'
import { InterviewSessions } from './components/InterviewSessions'

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <main id="main" className="main-container" tabIndex={-1}>
        <section id="sessions" aria-labelledby="page-heading">
          <InterviewSessions />
          <BackendConnectionTest />
        </section>
        <AboutVouch />
      </main>
      <footer className="site-footer"><span>Vouch · Interview with confidence.</span><span>Clear expectations. Informed decisions.</span></footer>
    </>
  )
}
