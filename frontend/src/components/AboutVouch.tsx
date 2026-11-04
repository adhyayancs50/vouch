import { Icon } from './Icon'

const steps = [
  { icon: 'policy', title: 'Set clear expectations', text: 'Define which AI tools and resources are permitted before the interview begins.' },
  { icon: 'shield', title: 'Keep candidates informed', text: 'Candidates review the policy and consent to limited browser activity tracking.' },
  { icon: 'report', title: 'Review with context', text: 'Review recorded activity and report integrity to support an informed conversation.' },
] as const

export function AboutVouch() {
  return (
    <section id="about" className="about-section" aria-labelledby="about-heading">
      <div className="about-heading"><div><p className="eyebrow">THE VOUCH APPROACH</p><h2 id="about-heading">Confidence in the process. Respect for the person.</h2></div><span className="privacy-label"><Icon name="shield" />Privacy first, by design</span></div>
      <p className="about-intro">Vouch helps employers review compliance with their AI-use policies during remote interviews through transparent, consent-based browser activity records.</p>
      <div className="approach-grid">
        {steps.map(({ icon, title, text }, index) => (
          <article className="approach-step" key={title}>
            <div className="step-top"><span className="step-icon"><Icon name={icon} /></span><span className="step-number">0{index + 1}</span></div>
            <h3>{title}</h3><p>{text}</p>
          </article>
        ))}
      </div>
      <p className="privacy-note">Limited to observable browser activity. No screen recording or keystroke capture. Activity records provide context; they do not prove whether AI was used.</p>
    </section>
  )
}
