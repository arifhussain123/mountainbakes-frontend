# Branch Geofencing

Branch users may record sales, orders and stock returns only while their device is
inside their branch's configured radius. Admins configure that radius on a map;
the API enforces it and logs every attempt.

Added in migration **48** (`branch_locations`, `geofence_logs`, `settings.geofence_*`).

---

## Rollout order

The order matters — steps 1–3 change nothing that users can see, and step 5 is the
one that starts refusing sales.

1. **Apply migration 48** to Supabase
   (`mountainbakes-server/supabase/migrations/20260802000048_branch_geofencing.sql`).
   There is no migration runner in this project; paste it into the Supabase SQL
   editor. It is additive and `geofencing_enabled` defaults to **false**, so
   applying it does not change behaviour.
2. **Deploy the API** (`mountainbakes-server`). With the flag off, every guarded
   endpoint behaves exactly as before.
3. **Build and deploy the web app** with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set —
   see `.env.example` for how to obtain and restrict the key. It is inlined at
   **build** time, so setting it on a running host does nothing.
4. **Configure locations**: Admin → Branch Locations → Set Location for each
   branch. Check the drawn circle actually covers the shop. Watch the
   **Missing GPS** tile go to zero.
5. **Turn it on**: Settings → Geofencing → "Restrict sales to the branch area".

To roll back, switch that one setting off. Nothing else needs redeploying.

---

## What is enforced, and where

| Blocked outside the radius | Always available |
| --- | --- |
| New sale (`POST /api/orders/pos`) | Reports, previous sales, invoice reprints |
| Branch order (`POST /api/orders`) | Stock figures (viewing) |
| Stock return (`POST /api/stock/return`) | Dashboard, notifications, help desk |

Being out of area stops **transactions**, not the application.

**Exempt roles:** `super_admin` (administers every branch from anywhere) and
`production_user` (creates no branch sales — production sales have no branch
location to measure against).

**Fail-open cases**, by design: geofencing disabled globally, the branch has no
location configured, or its location is disabled. A branch that has not been set up
keeps trading; the "Missing GPS" tile is the work queue.

**Fail-closed cases**: once a branch *is* configured and the feature is on, a
missing position, an unusably imprecise one, or a stale one all refuse the request.
A device that reports nothing is not treated as a device that is at the shop.

---

## How it fits together

- `src/shared/utils/geo.ts` — the rule. `haversineKm` and `evaluateGeofence`,
  dependency-free and pure. **The browser and the API import the same file**, so a
  screen and an endpoint can never disagree about a distance. Mirrored byte-for-byte
  into `mountainbakes-server/src/shared` like the rest of `shared/`.
- `GeofenceProvider` (dashboard layout, mounted once) — holds the freshest device
  position, re-reads it every N minutes and on tab focus, and reports each reading
  to `POST /api/branch-locations/verify`.
- `src/lib/api/client.ts` — stamps `X-Geo-Position: lat;lng;accuracy;capturedAt` on
  every request from the cached position. One choke point, so a new guarded endpoint
  cannot forget to send it.
- `requireInsideGeofence(action)` — the enforcing middleware. Mounted per-route
  after `validate`, never globally.
- `geofence_logs` — every checked attempt, allowed *and* blocked, with IP and user
  agent. A log of refusals alone could not answer "was this cashier at the shop when
  they rang that sale up".

### Accuracy is treated as a circle, not a point

A phone indoors routinely reports ±100–300 m. Comparing only the centre of that
circle to the boundary would refuse a cashier standing behind the counter of a shop
49.9 km out, and clear someone 50.1 km out. So `evaluateGeofence` resolves the
clear-cut cases first — circle wholly inside → allow, wholly outside → block — and
only consults the "require high accuracy" setting when the circle genuinely straddles
the boundary.

---

## On spoofing

**This cannot be made unspoofable, and it is not built as though it could be.**

A browser cannot attest that a coordinate came from real GPS hardware. Chrome's
devtools sensor override, or a two-line patch of `navigator.geolocation`, produces a
position the server cannot distinguish from a genuine one. No amount of server-side
work changes that.

What the design does buy:

- The distance is recalculated **server-side** on every guarded request. The branch
  centre and radius come from the database and are never taken from the request, so
  a client cannot widen its own radius.
- Every attempt is logged with coordinates, IP and user agent, so a bypass is
  visible and attributable after the fact.
- A stale position is rejected (`geofence_max_position_age_sec`), so a header
  captured once at the shop cannot be replayed from home all day.

Treat it as an accountability control, not an access control.

---

## Settings

Admin → Settings → Geofencing.

| Setting | Default | Notes |
| --- | --- | --- |
| Restrict sales to the branch area | off | The master switch. |
| Default Radius (KM) | 50 | Used when a branch has no radius of its own. |
| Verification Interval (minutes) | 5 | How often an open session re-checks. |
| GPS Timeout (seconds) | 20 | How long to wait for a fix. |
| Maximum Position Age (seconds) | 300 | Keep comfortably above the interval, or the API rejects fixes the client has not had a chance to refresh. |
| Require high-accuracy GPS | on | Only affects genuinely borderline readings. Turn off where staff work indoors with wifi-only positioning. |

---

## Notes for future work

- The admin route is `/geofencing`, **not** `/branch-locations`: `RouteGuard` maps
  every `/branch-*` prefix to the `branch_manager` role, so an admin route under that
  prefix would silently bounce super admins to their own home page. The API path is
  still `/api/branch-locations`.
- `branch_locations` has a unique constraint on `branch_id`, so a branch has exactly
  one area. Supporting a shop plus its warehouse means dropping that constraint and
  making the check iterate — the table shape already allows it.
- Live admin monitoring (a map of logged-in users updating in real time) is **not**
  built. `geofence_logs` already carries what it would need. It was left out
  deliberately: it means continuously recording staff positions even when they are
  not selling, which is a different thing from checking location at transaction time
  and worth deciding on its own merits.
