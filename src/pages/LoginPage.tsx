import { useState, type FormEvent } from 'react'
import { DEMO_ADMIN_EMAIL } from '../domain/admin'
import { DEMO_ADMIN_PASSWORD, createAdminSession, persistAdminSession, validateDemoAdminCredentials, type AdminSession } from '../auth/adminSession'
import { BrandMark, Button, Icon } from '../components/ui'

export function AdminLoginPage({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  function fillDemoCredentials() {
    setEmail(DEMO_ADMIN_EMAIL)
    setPassword(DEMO_ADMIN_PASSWORD)
    setError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!validateDemoAdminCredentials(email, password)) {
      setError('Those credentials do not match the demo administrator account.')
      return
    }
    setChecking(true)
    window.setTimeout(() => {
      const session = createAdminSession()
      persistAdminSession(session)
      onSignedIn(session)
    }, 350)
  }

  return <div className="login-shell">
    <section className="login-brand-panel">
      <div className="login-brand-lockup"><BrandMark /><div><strong>PicDrop <span>+</span> HopNgo</strong><small>Delivery Operations</small></div></div>
      <div className="login-brand-copy">
        <span className="login-eyebrow">OPERATIONS ADMINISTRATION</span>
        <h1>Every delivery, partner, and exception in one clear operating view.</h1>
        <p>Coordinate the delivery queue, verify partners, manage assignment eligibility, and review operational history from a single internal console.</p>
        <ul className="login-feature-list">
          <li><span><Icon name="deliveries" size={17} /></span><div><strong>Dispatch oversight</strong><small>Delivery milestones, partner assignment, and operational exceptions.</small></div></li>
          <li><span><Icon name="partners" size={17} /></span><div><strong>Partner assurance</strong><small>Eligibility, verification, KYC documents, and account restrictions.</small></div></li>
          <li><span><Icon name="shield" size={17} /></span><div><strong>Administrative history</strong><small>Append-only audit events and event-driven operations notifications.</small></div></li>
        </ul>
      </div>
      <div className="login-brand-footer"><span className="environment-dot" />Illustrative demo environment · No live integrations</div>
    </section>

    <main className="login-main">
      <div className="login-card">
        <div className="login-mobile-brand"><BrandMark /><div><strong>PicDrop <span>+</span> HopNgo</strong><small>Delivery Operations</small></div></div>
        <div className="login-heading">
          <span className="login-heading-icon"><Icon name="lock" size={18} /></span>
          <div><span className="eyebrow">ADMIN ACCESS</span><h2>Sign in to operations</h2><p>Use the local demo administrator credentials to open the console.</p></div>
        </div>

        {error && <div className="login-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}

        <form className="login-form" onSubmit={submit}>
          <label className="field-label">Administrator email<input type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@picdrop.demo" required aria-describedby="login-email-note" /></label>
          <span className="login-field-note" id="login-email-note">Use the single Administrator account for this Operations demo.</span>
          <label className="field-label">Password<span className="login-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter demo password" required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><Icon name="eye" size={15} /></button></span></label>
          <Button type="submit" variant="primary" className="login-submit" disabled={checking}><Icon name="lock" size={15} />{checking ? 'Checking local credentials…' : 'Sign in as Administrator'}</Button>
        </form>

        <div className="login-demo-credentials">
          <div><span className="eyebrow">DEMO CREDENTIALS</span><p>Email <code>{DEMO_ADMIN_EMAIL}</code></p><p>Password <code>{DEMO_ADMIN_PASSWORD}</code></p></div>
          <Button size="small" onClick={fillDemoCredentials}>Use demo credentials</Button>
        </div>

        <p className="login-security-note"><Icon name="info" size={14} />This is a simulated local sign-in for a demonstration. It is not production authentication or a security boundary.</p>
      </div>
      <p className="login-footer">PicDrop + HopNgo · Internal delivery operations · Demo data only</p>
    </main>
  </div>
}