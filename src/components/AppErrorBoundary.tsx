import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Icon } from './ui'

interface State {
  error: Error | null
}

/** Last-resort boundary so an unexpected render error does not leave a blank console. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with your production error reporter (Sentry, Cloud Logging, etc.).
    console.error('Unhandled delivery_admin error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert">
      <span className="fatal-error-icon"><Icon name="alert" size={26} /></span>
      <span className="eyebrow">CONSOLE ERROR</span>
      <h1>The operations console could not render.</h1>
      <p>Reload the page. If the problem continues, contact the operations administrator and include the time this happened.</p>
      <Button variant="primary" onClick={() => window.location.reload()}>Reload console</Button>
    </main>
  }
}
