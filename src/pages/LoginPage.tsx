import { useState, type FormEvent } from 'react'
import {
  clearAdminSession,
  createAdminSession,
  createDemoAdminSession,
  DEMO_LOGIN_EMAIL,
  DEMO_OTP_CODE,
  isDemoOtpValid,
  readDemoAdminSession,
  storeDemoAdminSession,
  type AdminSession,
} from '../auth/adminSession'
import { demoModeEnabled, firebaseConfigError, firebaseWebConfig, isAdminEmailAllowed } from '../config/firebase'
import { clearFirebaseAdminSession, signInFirebaseAdmin } from '../services/firebaseAuth'
import { BrandMark, Button, Icon } from '../components/ui'

type AccessMode = 'demo' | 'firebase'
type DemoStep = 'email' | 'otp'

function initialAccessMode(): AccessMode {
  const requested = new URLSearchParams(window.location.search).get('signin')
  if (requested === 'firebase') return 'firebase'
  return demoModeEnabled ? 'demo' : 'firebase'
}

export function AdminLoginPage({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [accessMode, setAccessMode] = useState<AccessMode>(initialAccessMode)
  const [demoStep, setDemoStep] = useState<DemoStep>('email')
  const [demoEmail, setDemoEmail] = useState(DEMO_LOGIN_EMAIL)
  const [demoOtp, setDemoOtp] = useState('')
  const [demoError, setDemoError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const connectingData = new URLSearchParams(window.location.search).get('connect') === 'data'
  const configured = !firebaseConfigError

  function sendDemoOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!demoEmail.trim()) {
      setDemoError('Enter the demo email first.')
      return
    }
    setDemoError('')
    setDemoStep('otp')
  }

  function verifyDemoOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isDemoOtpValid(demoOtp)) {
      setDemoError(`That code is not correct. Use ${DEMO_OTP_CODE} for this demo.`)
      return
    }
    clearAdminSession()
    const session = createDemoAdminSession()
    session.email = demoEmail.trim() || DEMO_LOGIN_EMAIL
    storeDemoAdminSession(session)
    onSignedIn(session)
  }

  function switchMode(mode: AccessMode) {
    setAccessMode(mode)
    setError('')
    setDemoError('')
    setDemoStep('email')
    setDemoOtp('')
  }

  async function submitFirebase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!configured) {
      setError(firebaseConfigError)
      return
    }
    setSigningIn(true)
    setError('')
    try {
      // A data connection must not replace the active demo console session.
      if (connectingData) clearFirebaseAdminSession()
      else clearAdminSession()
      const firebaseSession = await signInFirebaseAdmin(email, password, firebaseWebConfig.apiKey)
      if (!isAdminEmailAllowed(firebaseSession.email)) {
        clearAdminSession()
        throw new Error('This account is not on the operations administrator allow-list.')
      }
      if (connectingData && readDemoAdminSession()) {
        window.location.assign('/admin')
        return
      }
      onSignedIn(createAdminSession(firebaseSession))
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Firebase sign-in failed. Try again.')
    } finally {
      setSigningIn(false)
    }
  }

  const demoAccess = accessMode === 'demo'
  const heading = connectingData ? 'Connect live partner data' : demoAccess ? 'Open the operations demo' : 'Sign in to operations'
  const description = connectingData
    ? 'Sign in with the Firebase administrator account. The demo console stays signed in while partner records come from Firestore.'
    : demoAccess
      ? 'Use the demo email and one-time code to explore preloaded partners, deliveries, KYC, and audit history.'
      : 'Use the Firebase administrator account allowed by your delivery_app security rules.'

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
      <div className="login-brand-footer"><span className="environment-dot" />{demoAccess ? 'Manager walkthrough · sample data' : 'Authorized operations access · Firebase Authentication'}</div>
    </section>

    <main className="login-main">
      <div className="login-card">
        <div className="login-mobile-brand"><BrandMark /><div><strong>PicDrop <span>+</span> HopNgo</strong><small>Delivery Operations</small></div></div>
        <div className="login-heading">
          <span className="login-heading-icon"><Icon name="lock" size={18} /></span>
          <div>
            <span className="eyebrow">{connectingData ? 'LIVE DATA CONNECTION' : demoAccess ? 'MANAGER DEMO' : 'ADMIN ACCESS'}</span>
            <h2>{heading}</h2>
            <p>{description}</p>
          </div>
        </div>

        {demoModeEnabled && <div className="login-mode-switch" role="tablist" aria-label="Access method">
          <button type="button" role="tab" aria-selected={demoAccess} className={demoAccess ? 'active' : ''} onClick={() => switchMode('demo')}>Demo access</button>
          <button type="button" role="tab" aria-selected={!demoAccess} className={!demoAccess ? 'active' : ''} onClick={() => switchMode('firebase')}>Firebase sign-in</button>
        </div>}

        {demoAccess ? <>
          <div className="login-demo-note"><Icon name="info" size={16} /><div><strong>Demo mode</strong><span>Use <strong>admin@picdrop.demo</strong> for full access, or <strong>dispatch@picdrop.demo</strong> to preview a restricted administrator. Opening the demo restores the sample data; live partner data can be connected from Partner app.</span></div></div>
          {demoError && <div className="login-error" role="alert"><Icon name="alert" size={15} /><span>{demoError}</span></div>}

          {demoStep === 'email' ? <form className="login-form" onSubmit={sendDemoOtp}>
            <label className="field-label">Demo email<input type="email" autoComplete="off" value={demoEmail} onChange={(event) => setDemoEmail(event.target.value)} required /></label>
            <span className="login-field-note">This is a demo identity. No account is created and no email is sent.</span>
            <Button type="submit" variant="primary" className="login-submit"><Icon name="arrow" size={15} />Send demo OTP</Button>
          </form> : <form className="login-form" onSubmit={verifyDemoOtp}>
            <div className="login-otp-banner"><span className="login-otp-icon"><Icon name="check" size={16} /></span><div><strong>Demo one-time code</strong><span className="login-otp-code">{DEMO_OTP_CODE}</span></div></div>
            <label className="field-label">One-time code<input className="login-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={demoOtp} onChange={(event) => setDemoOtp(event.target.value.replace(/\D/g, ''))} placeholder="6-digit code" autoFocus required /></label>
            <span className="login-field-note">Enter the code shown above. This is a demo-only verification step.</span>
            <Button type="submit" variant="primary" className="login-submit"><Icon name="lock" size={15} />Verify and open demo</Button>
            <button type="button" className="login-text-button" onClick={() => { setDemoStep('email'); setDemoOtp(''); setDemoError('') }}>Use a different demo email</button>
          </form>}
        </> : <>
          {!configured && <div className="login-error" role="alert"><Icon name="alert" size={15} /><span>{firebaseConfigError} Fix the production environment configuration and rebuild.</span></div>}
          {error && <div className="login-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}

          <form className="login-form" onSubmit={submitFirebase}>
            <label className="field-label">Administrator email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
            <span className="login-field-note">This must be a Firebase Authentication user whose UID is allow-listed in the delivery_app Firestore rules. Partner data syncs automatically after sign-in.</span>
            <label className="field-label">Password<span className="login-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><Icon name="eye" size={15} /></button></span></label>
            <Button type="submit" variant="primary" className="login-submit" disabled={signingIn || !configured}><Icon name="lock" size={15} />{signingIn ? 'Connecting…' : connectingData ? 'Connect Firebase data' : 'Sign in'}</Button>
            {connectingData && <button type="button" className="login-text-button" onClick={() => window.location.assign('/admin')}>Back to demo console</button>}
          </form>

          <p className="login-security-note"><Icon name="shield" size={14} />Authentication is handled by Firebase. Passwords are never stored, and this browser stays connected until you sign out.</p>
          <p className="login-security-note"><Icon name="info" size={14} />{connectingData ? 'This Firebase account authorizes live partner data only; your demo administrator identity stays active.' : 'Need access? Ask an existing administrator to create your Firebase user and add your UID to the delivery_app Firestore rules.'}</p>
        </>}

        <p className="login-footer">PicDrop + HopNgo · Internal delivery operations</p>
      </div>
    </main>
  </div>
}
