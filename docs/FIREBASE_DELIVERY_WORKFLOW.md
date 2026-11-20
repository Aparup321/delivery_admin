# Shared Firebase delivery workflow

The Admin App and Partner App use the existing `partners/{uid}` and
`deliveries/{deliveryId}` documents.

## Partner state

`partners/{uid}` keeps separate concepts:

- `applicationStatus`: `draft`, `submitted`, `under_review`, `approved`, or `rejected`
- `status`: `pending`, `active`, or `paused`
- `isOnline`: the partner device's availability signal
- `lastLocation` and `lastLocationUpdatedAt`: the partner's last account location
- `adminReview`: the administrator decision metadata
- `adminSuspension`: suspension metadata

The Admin App only treats a linked partner as assignable when the application
is approved, the account is active, the partner reports online, required local
documents are valid, the vehicle/service-area rules pass, and the partner has
no active assignment.

## Delivery state

An assignment is published to `deliveries/{deliveryId}` with:

- `partnerUid`: the Partner App Firebase UID, not the admin directory ID
- `status: assigned`
- `adminStatus: Pending`
- `pickup`, `destination`, and delivery metadata
- `expiresAt`
- `events`
- `currentLocation`

The Partner App listens to deliveries filtered by `partnerUid`. It accepts or
rejects the assigned document transactionally, then advances the shared status
through `accepted`, `pickup_arrived`, `picked_up`, `in_transit`, `drop_arrived`,
and `delivered` (or `cancelled`).

## Required Partner App Firestore rule change

The current Partner App rules allow a partner to create a delivery only when
its status is already an in-progress status. That blocks the Admin App from
creating the initial `assigned` offer. The Partner App rules must allow the
trusted administrator to create an assigned delivery document, while keeping
partner writes restricted to the authenticated partner and valid transitions.

Add an administrator create branch to `match /deliveries/{deliveryId}` similar
to:

```text
allow create: if isAdmin()
  && request.resource.data.partnerUid is string
  && request.resource.data.status == 'assigned'
  && request.resource.data.deliveryId is string
  && request.resource.data.pickup is map
  && request.resource.data.destination is map;
```

Keep the existing partner create rule and the existing partner ownership checks.
Do not replace `isAdmin()` with a frontend email allow-list. The trusted admin
UID/claims must be managed in the Firebase security boundary.

The existing `allow update: if isAdmin()` branch then permits the Admin App to
cancel or reassign a delivery. Before production, replace the hardcoded admin
UID with a custom-claims or administrator-document authorization function.

## Synchronization note

The Admin App currently uses its existing Firestore REST fallback and refreshes
partner and live delivery data every 10 seconds. The Partner App uses Firestore
SDK `onSnapshot` listeners. Moving the Admin App to the Firebase Web SDK is the
next step for true bidirectional realtime listeners; do not claim zero-latency
Admin updates while the REST fallback is enabled.
