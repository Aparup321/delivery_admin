import type { PartnerAppConfig } from '../domain/model.ts'

/**
 * Firebase web-app values loaded from `.env.local` at Vite startup.
 *
 * A Firebase web API key is a public project identifier, not a server secret.
 * Never place service-account credentials or Admin SDK private keys in a
 * `VITE_*` variable: Vite embeds these values in the browser bundle.
 */
export interface FirebaseEnvConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  firestoreDatabaseId: string
  partnersCollection: string
}

function readEnv(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

// `import.meta.env` is replaced by Vite in the app and is undefined when the
// domain modules are imported directly by the Node test runner.
const env = import.meta.env ?? {}

export const firebaseWebConfig: FirebaseEnvConfig = {
  apiKey: readEnv(env.VITE_FIREBASE_API_KEY),
  authDomain: readEnv(env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: readEnv(env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: readEnv(env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: readEnv(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: readEnv(env.VITE_FIREBASE_APP_ID),
  firestoreDatabaseId: readEnv(env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) || '(default)',
  partnersCollection: readEnv(env.VITE_FIREBASE_PARTNERS_COLLECTION) || 'partners',
}

export const hasFirebaseEnvConfig = Boolean(firebaseWebConfig.projectId)

/**
 * Seeds the admin console's Firestore connector from `.env.local`.
 * A connection saved in Settings → Partner app always wins; only empty or
 * untouched default fields fall back to the environment values.
 */
export function applyFirebaseConnectionDefaults(
  config: PartnerAppConfig,
  defaults: FirebaseEnvConfig = firebaseWebConfig,
): PartnerAppConfig {
  if (config.mode !== 'firestore') return config
  const configuredDatabase = config.databaseId.trim()
  const configuredCollection = config.partnersCollection.trim()
  return {
    ...config,
    projectId: config.projectId.trim() || defaults.projectId,
    apiKey: config.apiKey.trim() || defaults.apiKey,
    databaseId: !configuredDatabase || (configuredDatabase === '(default)' && defaults.firestoreDatabaseId !== '(default)')
      ? defaults.firestoreDatabaseId
      : configuredDatabase,
    partnersCollection: !configuredCollection || (configuredCollection === 'partners' && defaults.partnersCollection !== 'partners')
      ? defaults.partnersCollection
      : configuredCollection,
  }
}
