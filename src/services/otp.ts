/**
 * Demo OTP provider for the Administrator sign-in.
 *
 * This is intentionally a local placeholder. The real OTP API can replace the
 * `sendOtp` and `verifyOtp` implementations without changing the login screen:
 * - `sendOtp(destination)` should call the provider's send endpoint and return
 *   a challenge containing a server-side reference and expiry. The response
 *   should never expose the code to the browser in production.
 * - `verifyOtp(challenge, code)` should call the provider's verify endpoint and
 *   map its response to the `OtpVerification` result below.
 *
 * The demo keeps the code in memory only; it is never persisted or audited.
 */

export const DEMO_OTP_CODE = '123456'
export const DEMO_OTP_TTL_SECONDS = 5 * 60

export interface OtpChallenge {
  destination: string
  code: string
  expiresAt: string
}

export type OtpVerification =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' }

export function createDemoOtpChallenge(destination: string, now = Date.now()): OtpChallenge {
  return {
    destination: destination.trim(),
    code: DEMO_OTP_CODE,
    expiresAt: new Date(now + DEMO_OTP_TTL_SECONDS * 1000).toISOString(),
  }
}

export async function sendDemoOtp(destination: string): Promise<OtpChallenge> {
  // Keep the demo async so replacing this function with a real network call
  // does not change the login screen's state handling.
  await new Promise((resolve) => setTimeout(resolve, 250))
  return createDemoOtpChallenge(destination)
}

export function verifyOtp(challenge: OtpChallenge, code: string, now = Date.now()): OtpVerification {
  if (new Date(challenge.expiresAt).getTime() <= now) return { ok: false, reason: 'expired' }
  if (code.trim() !== challenge.code) return { ok: false, reason: 'invalid' }
  return { ok: true }
}
