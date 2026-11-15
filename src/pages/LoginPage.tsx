import { useState, type FormEvent } from 'react'
import { DEMO_ADMIN_EMAIL } from '../domain/admin'
import { DEMO_ADMIN_PASSWORD, createAdminSession, persistAdminSession, validateDemoAdminCredentials, type AdminSession } from '../auth/adminSession'
import { DEMO_OTP_CODE, DEMO_OTP_TTL_SECONDS, sendDemoOtp, verifyOtp, type OtpChallenge } from '../services/otp'
import { BrandMark, Button, Icon } from '../components/ui'

export function AdminLoginPage({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)

  function fillDemoCredentials() {
    setEmail(DEMO_ADMIN_EMAIL)
    setPassword(DEMO_ADMIN_PASSWORD)
    setError('')
  }

  function resetToCredentials() {
    setChallenge(null)
    setOtp('')
    setStep('credentials')
    setError('')
  }

  async function requestOtp() {
    setSending(true)
    setError('')
    try {
      const next = await sendDemoOtp(DEMO_ADMIN_EMAIL)
      setChallenge(next)
      setOtp('')
      setStep('otp')
    } catch {
      setError('The demo OTP could not be generated. Try again.')
    } finally {
      setSending(false)
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!validateDemoAdminCredentials(email, password)) {
      setError('Those credentials do not match the demo administrator account.')
      return
    }
    await requestOtp()
  }

  function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!challenge) return
    const result = verifyOtp(challenge, otp)
    if (!result.ok) {
      setError(result.reason === 'expired'
        ? 'The demo OTP has expired. Send a new code to continue.'
        : 'That OTP is not correct. Use the demo code shown below.')
      return
    }
    setError('')
    setChecking(true)
    window.setTimeout(() => {
      const session = createAdminSession()
      persistAdminSession(session)
      onSignedIn(session)
    }, 350)
  }

  async function resendOtp() {
    await requestOtp()
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
          <span className="login-heading-icon"><Icon name={step === 'credentials' ? 'lock' : 'shield'} size={18} /></span>
          <div>
            <span className="eyebrow">{step === 'credentials' ? 'ADMIN ACCESS' : 'ADMIN VERIFICATION'}</span>
            <h2>{step === 'credentials' ? 'Sign in to operations' : 'Enter your one-time code'}</h2>
            <p>{step === 'credentials' ? 'Use the local demo administrator credentials to open the console.' : `A demo OTP is shown below for ${DEMO_ADMIN_EMAIL}. No SMS or email is sent.`}</p>
          </div>
        </div>

        {error && <div className="login-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}

        {step === 'credentials' ? <>
          <form className="login-form" onSubmit={submitCredentials}>
            <label className="field-label">Administrator email<input type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@picdrop.demo" required aria-describedby="login-email-note" /></label>
            <span className="login-field-note" id="login-email-note">Use the single Administrator account for this Operations demo.</span>
            <label className="field-label">Password<span className="login-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter demo password" required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><Icon name="eye" size={15} /></button></span></label>
            <Button type="submit" variant="primary" className="login-submit" disabled={sending}><Icon name="lock" size={15} />{sending ? 'Preparing demo OTP…' : 'Continue to OTP'}</Button>
          </form>

          <div className="login-demo-credentials">
            <div><span className="eyebrow">DEMO CREDENTIALS</span><p>Email <code>{DEMO_ADMIN_EMAIL}</code></p><p>Password <code>{DEMO_ADMIN_PASSWORD}</code></p></div>
            <Button size="small" onClick={fillDemoCredentials} disabled={sending}>Use demo credentials</Button>
          </div>
        </> : <>
          <form className="login-form" onSubmit={submitOtp}>
            <label className="field-label">One-time code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter the 6-digit demo OTP" required /></label>
            <span className="login-field-note">The demo code is valid for {Math.round(DEMO_OTP_TTL_SECONDS / 60)} minutes and is never stored or sent anywhere.</span>
            <Button type="submit" variant="primary" className="login-submit" disabled={checking || sending}><Icon name="shield" size={15} />{checking ? 'Signing in…' : 'Verify OTP and sign in'}</Button>
            <div className="login-otp-footer">
              <Button size="small" variant="quiet" onClick={resetToCredentials} disabled={checking}>Use different credentials</Button>
              <Button size="small" variant="quiet" onClick={resendOtp} disabled={checking || sending}>{sending ? 'Sending…' : 'Resend demo OTP'}</Button>
            </div>
          </form>

          <div className="login-demo-credentials">
            <div><span className="eyebrow">DEMO OTP</span><p>Code <code>{DEMO_OTP_CODE}</code></p><p>No SMS or email is sent in demo mode.</p></div>
            <Button size="small" onClick={() => setOtp(DEMO_OTP_CODE)} disabled={checking}>Use demo OTP</Button>
          </div>
        </>}

        <p className="login-security-note"><Icon name="info" size={14} />This is a simulated local sign-in for a demonstration. The OTP step is a local placeholder that can be replaced by the real OTP API. It is not production authentication or a security boundary.</p>
      </div>
      <p className="login-footer">PicDrop + HopNgo · Internal delivery operations · Demo data only</p>
    </main>
  </div>
}
