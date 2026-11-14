# PicDrop + HopNgo · Delivery Operations

A responsive internal delivery-operations console built with React, TypeScript, and Vite. The application runs against interconnected illustrative demo records and persists changes in the current browser's localStorage.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Administrator sign-in

The Operations demo exposes a single Administrator account:

- **Email:** `admin@picdrop.demo`
- **Password:** `demo-admin`

Use **Use demo credentials** on the sign-in panel to fill them in. The signed-in session is held in `sessionStorage` for the current browser tab. Select the profile in the sidebar, or the avatar in the top bar, to open the Administrator’s account details; **Settings → Admin access** shows the same account. **Sign out** from the account dialog clears the session.

This sign-in is a local demonstration gate. It is not production authentication, a real identity provider, or a security boundary.

## Verify

```sh
npm test
npm run build
```

## Included workspaces

- `/admin` — operations overview, attention queue, demo charts, illustrative service-area diagram, and recent audit activity.
- `/admin/deliveries` — searchable, filterable, sortable delivery queue, pagination, selection, and demo delivery creation.
- `/admin/deliveries/:id` — milestones, delay/cancellation actions, assignment and offer history.
- `/admin/deliveries/:id/assign` — eligibility-based partner assignment and simulated partner offers.
- `/admin/partners` — partner directory and profile, status controls, delivery history, and document records.
- `/admin/partners?view=kyc` — merged onboarding-application and KYC document review queue with approve/reject decisions, recorded reasons, filters, and direct review links.
- `/admin/partners?view=activity` — partner activity history with administrator suspension controls.
- `/admin/partners?view=app` — read-only partner records synced from the delivery_app backend.
- `/admin/settings?tab=partner-app` — manual Firebase Firestore or REST connection, connection test, and partner data sync.
- `/admin/notifications` — event-driven notifications with read state and record navigation.
- `/admin/audit-logs` — searchable, filterable, append-only-in-UI activity history and CSV export.
- `/admin/settings` — local offer, fallback, delay, notification, Administrator access, and demo-data settings.

## Connect delivery_admin to delivery_app’s Firebase project

Both apps live in one Firebase project. delivery_admin reads delivery_app’s Firestore data through the manual connection in **Settings → Partner app**; no Firebase SDK or separate database is required.

1. In the Firebase project already used by delivery_app, open **Project settings → Your apps → Add app → Web** and register `delivery_admin`. This is optional for Firestore REST, but required later if you add Firebase Auth, Storage, or per-app analytics.
2. Copy the `firebaseConfig` object for that web app.
3. In this console, open **Settings → Partner app**, paste the full config, and confirm the project ID and API key. Pasting auto-fills the fields; click **Save connection**.
4. Set **Partners collection** to the collection delivery_app writes partner records to (`partners` by default).
5. Click **Test connection**, then **Sync partner data**. Synced records appear under **Partners → Partner app**.

If the browser reports HTTP 403, check the Firestore rules and allow the delivery_admin origin (localhost or the deployed URL) on the API key’s HTTP-referrer restrictions. The connector reads one top-level collection; additional delivery_app collections need their own field mapping.

## Demo limitations

Delivery, KYC, time progression, notification, and administrative operations are local simulations. An optional, read-only connection to a separate `delivery_app` Firebase/REST backend can be configured manually in **Settings → Partner app**; partner records are cached in this browser after a sync, and a Firebase ID token is kept in sessionStorage for the current tab only. This connector does not write to the partner app and does not include partner-app messaging, live GPS, payments, document upload, or external notifications. Contact and vehicle values in the seed data are masked examples. The Operations team intentionally exposes only the Administrator role; internal role constants remain for future backend integration but cannot be selected in the interface. Use **Settings → Demo data** to reset browser-persisted changes.
