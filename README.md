# PicDrop + HopNgo · Delivery Operations

Internal delivery-operations console built with React, TypeScript, and Vite. It includes a **manager demo** with seeded partners, deliveries, KYC applications, and audit history, plus a real Firebase sign-in that loads delivery_app partner records automatically.

## Run locally

Requires Node.js 22.6+ and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Firebase web-app values from the same project delivery_app uses, then restart Vite. Open the URL printed by Vite. If the partner app already uses `http://localhost:5173`, the console prints `http://localhost:5174` instead.

## Manager demo

Demo access is enabled by default. On the login screen:

1. Choose **Demo access**.
2. Keep the prefilled demo email.
3. Click **Send demo OTP**.
4. Enter the demo code **`123456`**.

Opening the demo resets the local workflow to seeded demo partners, deliveries, KYC applications, notifications, and audit history. No Firebase account or email is used. The demo session lasts for the current browser tab.

The OTP is a fixed walkthrough code, not a security control. Before a real production launch, set:

```ini
VITE_DEMO_MODE=false
```

That hides demo access and removes the demo session on the next load. Never leave demo mode enabled on a public deployment.

## Real Firebase sign-in

The **Firebase sign-in** tab is the real access gate. Real sign-in has no demo password or OTP.

1. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.
2. Create the operations administrator under **Authentication → Users**.
3. Set `VITE_ADMIN_EMAILS` to a comma-separated allow-list of administrator emails.
4. Allow that account’s UID in `delivery_app/firestore.rules`.
5. Sign in with that email and password on the console login screen.

After sign-in, partner records sync from Firestore automatically. No project fields, manual token, connection test, or save step is needed. The Partner sync tab shows the signed-in account, project, last sync, and cached partner count, with a manual **Sync partner data** button.

The Firebase ID token and refresh token live in `sessionStorage` for the current browser tab only. The password is never stored by the app. Signing out clears the Firebase session, demo session, and partner token.

The email allow-list is a client-side gate for the console shell. It is not a security boundary: Firestore rules and API key restrictions remain authoritative. With demo mode disabled, production Firebase sign-in fails closed when `VITE_ADMIN_EMAILS` is empty.

## Verify

```sh
npm run check
```

This runs the production TypeScript/Vite build and the Node test suite.

## Routes

- `/admin` — operations overview, attention queue, live delivery map, and recent audit activity.
- `/admin/deliveries` — searchable, filterable, sortable delivery queue and delivery creation.
- `/admin/deliveries/:id` — milestones, delay/cancellation actions, assignment and offer history.
- `/admin/deliveries/:id/assign` — eligibility-based partner assignment and partner offers.
- `/admin/partners` — partner directory and profile, verification, delivery history, and account controls.
- `/admin/partners?view=new` — create a partner record with mandatory KYC documents marked missing.
- `/admin/partners?view=activity` — partner activity history with suspension and reinstatement controls.
- `/admin/partners?view=app` — delivery_app partner records synced from Firestore, with linking and live account actions.
- `/admin/kyc` — unified onboarding KYC queue for local and synced delivery_app applications.
- `/admin/notifications` — event-driven notifications with read state and record navigation.
- `/admin/audit-logs` — searchable, filterable administrative audit history and CSV export.
- `/admin/settings` — simple **General**, **Partner sync**, and **Demo data** tabs.

## Firebase connection

The console reads its Firebase defaults from Vite environment variables:

```ini
VITE_DEMO_MODE=true
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_ADMIN_EMAILS=ops@example.com,lead@example.com
VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)
VITE_FIREBASE_PARTNERS_COLLECTION=partners
```

- `projectId` and `apiKey` are required for real Firebase sign-in and automatic partner sync.
- Partner data is read from the configured Firestore collection (default `partners`).
- A 403 usually means Firestore rules do not allow the signed-in UID, or the API key’s HTTP-referrer restriction does not include the console origin.
- `VITE_*` values are embedded in the browser bundle. Never put service-account or Admin SDK credentials in `.env.local`.

## Deploy

`firebase.json` includes an SPA rewrite, long-lived caching for hashed assets, and security headers (HSTS, CSP, no framing, no MIME sniffing, restricted permissions).

```sh
npm ci
npm run check
firebase use your-project-id
firebase deploy --only hosting
```

For a manager walkthrough build, demo mode can stay enabled and Firebase values are optional. For a real production deploy:

- Set `VITE_DEMO_MODE=false` and `VITE_ADMIN_EMAILS` in the build environment.
- Set the Firebase web-app values in the build environment.
- Deploy the delivery_app Firestore rules that allow the administrator UID.
- Restrict the web API key to the production console origin and the required Firebase APIs.
- Keep `robots.txt` and the `noindex` metadata in place.
- Replace the `console.error` in `src/components/AppErrorBoundary.tsx` with your production error reporter.

## Current limitations

- Partner records and live deliveries are read from/written to Firebase. KYC decisions, delivery assignment, offers, notifications, documents, and audit history are stored in the current browser’s `localStorage`; they are not yet a server-backed source of truth. Clearing browser data or using another device loses those local records. Signing out clears the sessions but leaves those local workflow records in the browser profile.
- Demo access is a walkthrough shortcut, not an authentication mechanism. Disable it with `VITE_DEMO_MODE=false` before production.
- The app does not include partner-app messaging, payments, document upload, external notifications, routing, or ETAs.
- Map previews use public OpenStreetMap raster tiles. Location sharing is best-effort and only available while the partner is online.
