# PicDrop + HopNgo · Delivery Operations

A responsive internal delivery-operations console built with React, TypeScript, and Vite. The application runs against interconnected illustrative demo records and persists changes in the current browser's localStorage.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. When the partner app is already using `http://localhost:5173`, the console prints `http://localhost:5174` instead.

## Administrator sign-in

The Operations demo exposes a single Administrator account:

- **Email:** `admin@picdrop.demo`
- **Password:** `demo-admin`
- **Demo OTP:** `123456`

Use **Use demo credentials** on the sign-in panel to fill the email and password, then continue to the OTP step and use **Use demo OTP** (or type `123456`). No SMS or email is sent. The OTP provider is a local placeholder in `src/services/otp.ts`; replace `sendDemoOtp` and `verifyOtp` with the real OTP API when it is ready.

The signed-in session is held in `sessionStorage` for the current browser tab. Select the profile in the sidebar, or the avatar in the top bar, to open the Administrator’s account details; **Settings → Admin access** shows the same account. **Sign out** from the account dialog clears the session.

This sign-in is a local demonstration gate. It is not production authentication, a real identity provider, or a security boundary.

### Firebase administrator for live delivery_app updates

Reading and writing delivery_app records uses a **separate Firebase Authentication session**, because Firestore rules trust a Firebase UID rather than the local demo session. Use the same `admin@picdrop.demo` email in **Settings → Partner app** with a password set in **Firebase Console → Authentication → Users**. The account’s UID is allow-listed in `delivery_app/firestore.rules`.

- The password is never stored by the app. The ID token and refresh token live in `sessionStorage` for the current browser tab and refresh automatically.
- Signing out of Firebase on that screen stops live writes until the next sign-in. The local demo session stays active.
- If the admin account is recreated with a new UID, update `isAdmin()` in `delivery_app/firestore.rules` and redeploy the rules.

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
- `/admin/partners?view=activity` — partner activity history with administrator suspension and reinstatement controls.
- `/admin/partners?view=app` — delivery_app partner records synced from Firestore, with record linking and live application/account actions.
- `/admin/settings?tab=partner-app` — Firebase administrator sign-in, Firestore or REST connection, connection test, and partner data sync.
- `/admin/notifications` — event-driven notifications with read state and record navigation.
- `/admin/audit-logs` — searchable, filterable, append-only-in-UI activity history and CSV export.
- `/admin/settings` — local offer, fallback, delay, notification, Administrator access, and demo-data settings.

## Firebase connection configuration

The Partner app connector reads its defaults from Vite environment variables. Copy `.env.example` to `.env.local` in the project root if needed, then fill in the Firebase web-app values:

```ini
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)
VITE_FIREBASE_PARTNERS_COLLECTION=partners
```

- Restart `npm run dev` after editing `.env.local`; Vite reads environment files at startup.
- These values prefill **Settings → Partner app**. You can override them in the form and save; values saved in the browser take precedence over `.env.local`.
- `projectId` is required. The API key is required only when Firestore rules allow the public web key; otherwise paste a Firebase ID token on the settings screen.
- `VITE_*` values are embedded in the browser bundle. A Firebase web API key is a public project identifier, not a server secret, but never place service-account or Admin SDK credentials in `.env.local`. Protect data with Firestore security rules and API-key HTTP-referrer restrictions.

## Connect delivery_admin to delivery_app’s Firebase project

Both apps share one Firebase project. delivery_admin talks to Firestore over REST; it does not need the Firebase SDK or a second database.

1. Confirm both `.env.local` files point to the same project (`VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_API_KEY`).
2. Deploy delivery_app’s rules so the allow-listed administrator UID can read and write partner records:

   ```sh
   cd ../delivery_app
   npx --yes firebase-tools@15.36.0 deploy --only firestore:rules
   ```

   The rules allow the administrator to read/write `partners/{uid}` and read `partner_documents`, `vehicles`, and `training_progress`. Unauthenticated requests stay denied.
3. In this console, open **Settings → Partner app** and sign in under **Firebase administrator sign-in** with the allow-listed account. The email prefills as `admin@picdrop.demo`; enter the password set in Firebase Authentication.
4. Confirm **Partners collection** is `partners`, then click **Save connection**, **Test connection**, and **Sync partner data**.
5. Open **Partners → Partner app**.

### Link and act on a delivery_app account

- After a sync, a partner app record is linked automatically when its name matches exactly one admin partner name. Otherwise open the record and choose **Link to an admin partner**.
- **Approve**/**Reject** on a synced application writes `applicationStatus`, `status`, `adminReview`, and timestamps to `partners/{uid}`. Rejection requires a reason and appears in the partner app.
- A delivery_app application that has no local admin record can be reviewed directly from **Partners → Partner app**. Approval creates the admin partner record and links it.
- **Suspend** sets `status` to `paused` with `adminSuspension`; **Restore** sets it back to `active`. The partner app reacts immediately through its Firestore listener and blocks going online while paused.
- Every write is queued from the audit entry, so a new decision is not lost if several are made quickly. Failed writes are kept and can be retried from **Partners → Partner app**; signing the Firebase administrator back in also retries them. The result appears in **Audit logs** and in **Settings → Partner app** as the last delivery_app error or success.

If a write fails with HTTP 403, sign the Firebase administrator in again and confirm the UID in `delivery_app/firestore.rules`. If the browser reports HTTP 403 only while reading, also check the API key’s HTTP-referrer restrictions for the console origin.

## Demo limitations

Delivery, KYC, time progression, notification, and most administrative operations are local simulations. The exception is the delivery_app partner records: an Administrator can link a synced record and write an approval, rejection, suspension, or reinstatement to the shared Firebase project, and the partner app reflects it live. Partner app data is cached in this browser after a sync; the Firebase ID token is kept in `sessionStorage` for the current tab only. The integration does not include partner-app messaging, live GPS, payments, document upload, or external notifications. Contact and vehicle values in the seed data are masked examples. The Operations team intentionally exposes only the Administrator role; internal role constants remain for future backend integration but cannot be selected in the interface. Use **Settings → Demo data** to reset browser-persisted changes.
