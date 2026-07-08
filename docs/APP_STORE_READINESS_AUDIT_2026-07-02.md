# App-Store Readiness Audit — 2026-07-02

Scope: everything that determines whether PennSync **works correctly as an installed
app** — a PWA installed from the browser, a Trusted Web Activity (TWA) on Google
Play, or a WKWebView/PWABuilder wrapper on the Apple App Store. The audit covered
the web manifest, service worker and offline behavior, iOS standalone quirks,
installed-context browser APIs (popups, downloads, camera/mic, clipboard), mobile
chrome/safe-area handling, and repo health (build/lint/tests).

Baseline at audit time: `npm run build`, `npm run lint`, and `npm test`
passed. Follow-up hosted-path/App Store audits now use the repo-standard Node 24 +
pnpm 11 commands and include guardrail specs for router basenames, scoped assets,
service-worker scope, iOS WKWebView behavior, and Telnyx in-app configuration.

---

## Part 1 — Defects found and FIXED in this pass

### 0. Production asset URLs were still root-bound in arbitrary hosted mounts
Vite's default production base emits root-relative JS/CSS/preload/icon URLs.
That works at the domain root but breaks the same App Store/Base44 build when it
is mounted below a path like `/apps/pennsync`.

**Fixed:** Vite now builds production assets with a relative base (`./`) while
leaving the dev server root-based for HMR. The runtime router still infers the
mount path for navigation and public links, and `./` is ignored as a configured
router basename so dynamic mount inference keeps working.

### 1. The service worker was never registered (offline mode was inert)
`public/sw.js` shipped in every build, but **no code anywhere registered it** — no
`navigator.serviceWorker.register()` existed in the repo's entire git history. All
of its caching and PHI-eviction logic was dead code. Consequences for an installed
app: cold-launching offline produced the OS browser error page, and none of the
static-asset caching ever happened.

**Fixed:** `src/main.jsx` now registers the worker from `import.meta.env.BASE_URL`
in production builds so root-hosted, Base44/App Store subpath-hosted, and Vite
`BASE_URL` deployments all use the correct scoped worker URL.

### 2. No offline app shell — cold offline launch showed a browser error
Even if the old worker had been registered, it deliberately never cached HTML/JS,
so an installed app opened without connectivity could not paint anything.

**Fixed:** `public/sw.js` (currently cache version v7) now:
- serves navigations **network-first** (a deploy is never masked by cache), falling
  back offline to the last successfully fetched scoped `index.html`, then to a
  precached, fully self-contained scoped `public/offline.html` branded fallback page
  (auto-retries when connectivity returns);
- serves Vite's content-hashed bundles under the service worker's scoped assets
  path **cache-first** (safe because a changed file always gets a new hashed URL
  via the network-first shell), which is what makes lazy route chunks loadable
  offline even when the app is mounted under a hosted subpath;
- keeps all v5 PHI rules: never caches `/api/`, PDFs, or any cross-origin response;
  fonts and same-origin images only.

### 3. The advertised offline workflow was unreachable once offline
The Features page instructs nurses to "Navigate to Offline Mode" — but every page
is a lazy-loaded chunk. Going offline and *then* opening Offline Mode threw
`Failed to fetch dynamically imported module`, which the stale-chunk auto-recovery
misread as a stale dev-server graph and answered with up to 3 hard reloads — which
also fail offline.

**Fixed (three layers):**
- `src/components/offline/OfflineManager.jsx` warms the offline-critical chunks
  (`OfflineMode` page + its two lazy tabs) at idle time while online, so they're in
  the module graph and the SW's asset cache before connectivity drops.
- `src/main.jsx` skips the reload-based stale-chunk recovery when
  `navigator.onLine === false`.
- `src/components/utils/ErrorBoundary.jsx` now distinguishes an offline chunk
  failure from a stale-chunk failure and shows a "This page isn't available
  offline" card that auto-reloads when the connection returns, instead of
  reload-looping.

### 4. Manifest icons: wrong declared sizes, cross-origin, no maskable variant
`manifest.json` declared the same Supabase-hosted PNG as both `192x192` and
`512x512`; the file is actually **1024×1024**. Store packaging tools (PWABuilder,
Bubblewrap) validate declared-vs-actual sizes and may refuse or mis-render. Icons
hosted on a third-party storage origin are also a fragility (deleted object = no
app icon) and there was no `purpose: maskable` icon, so Android adaptive icons
would letterbox/shrink the logo. The artwork also has a baked-in rounded-rect on a
white field, which produces white corners under Android/iOS masks.

**Fixed:** generated a proper local icon set under `public/icons/` from the 1024px
source — `icon-192/512` (any), `icon-maskable-192/512` (tile composited on the
brand-navy full-bleed background inside the safe zone), and a 180×180
`apple-touch-icon.png`. `manifest.json` now declares correct sizes/purposes, gains
an `"id"`, and `index.html` points favicon + apple-touch-icon at the local files.

### 5. iOS standalone: invisible status bar text
`apple-mobile-web-app-status-bar-style` was `black-translucent`, which always draws
**white** status-bar text — over the app's **white** fixed mobile header. Installed
to an iPhone home screen, the clock/battery were invisible.

**Fixed:** switched to `default` (dark text). The existing `safe-top`/`safe-bottom`
inset handling in the mobile header/bottom nav is unaffected (insets collapse to 0
where not applicable).

### 6. Floating sync widget collided with the bottom nav on notched phones
`Layout.jsx` pinned `OfflineSyncStatus` at a fixed `bottom-20` (5rem), but the
mobile bottom nav's real height is `4rem + env(safe-area-inset-bottom)` — overlap
on devices with a home indicator.

**Fixed:** the offset now includes `env(safe-area-inset-bottom)`.

### 7. Print/popup crashes in installed webviews
`window.open('', '_blank')` returns `null` in iOS standalone/WKWebView (and under
popup blockers). Two components dereferenced it unguarded and **threw**:
`EducationMaterialGenerator.jsx`, `NextStepsSummaryGenerator.jsx`. Three
certificate print flows (`AnnualTranscriptCenter`, `EmployeeTranscriptCenter`,
`MyAnnualEducationDashboard`) null-chained and failed **silently**.

**Fixed:** all five now toast a clear "allow pop-ups / use Download" message when
the window can't be opened.

### 8. Internal navigation via `window.open(_blank)`
`PatientAlertsDashboard.jsx` opened the patient chart with `window.open(..., '_blank')`.
Installed apps have no "new tab" — this breaks out of the app shell (TWA) or
no-ops (iOS standalone). **Fixed:** now an in-app router navigation.

### 9. Screen share failed silently on unsupported devices
`VideoRoom.jsx`'s screen-share toggle relied on `getDisplayMedia`, which doesn't
exist on iOS (Safari, standalone, WKWebView) — the error was only `console.error`'d,
and production builds strip `console.*`, so tapping the button did nothing.
**Fixed:** the toggle now detects missing support and toasts "Screen sharing isn't
supported on this device", and non-user-cancel failures surface a visible error.

### 10. Offline patient pickers were empty exactly when offline
The Offline Mode "Document Visit" tab and the Offline Documentation hub tab load
their patient lists with plain network queries. Worse, React Query's default
`networkMode: 'online'` **pauses** the query function while offline — so even
SmartNoteAssistant's existing IndexedDB fallback could never execute in the one
situation it exists for. Offline, a nurse had no patient to document against.
**Fixed:** new `src/lib/offlinePatients.js` helper (`withOfflineRosterFallback`,
unit-tested) serves the IndexedDB roster cached by OfflineManager when the fetch
fails while offline (online API errors still surface); both offline tabs use it
with `networkMode: 'always'`, and SmartNoteAssistant's query got the same
`networkMode` fix.

### 11. Non-functional "Push Notifications" settings
`NotificationPreferences.jsx` rendered a master Push toggle plus a per-type Push
column that only persisted booleans — there is no Web Push subscription or native
push pipeline (the backend merely echoes the flag). Store reviewers flag settings
that visibly do nothing. **Fixed:** the dead controls are removed (with a comment
explaining how to restore them alongside a real delivery pipeline); the entity
fields remain so no migration is needed later.

### 12. Offline UI promised features that don't exist
The "How Offline Mode Works" / "Storage & Sync Information" cards claimed
30-second auto-save, 3-attempt exponential-backoff retry, conflict detection, and
2-second auto-sync — none of which are implemented in `src/lib/offlineSync.js`.
For a clinical tool this overstated data-loss protection. **Fixed:** copy now
matches the real behavior (queue on device → drain on reconnect/startup → failed
items stay queued; unsynced work survives logout; caches are per-device/per-app).

### 13. Offline patient caches and installed-app previews were still split
The status tab counted only the retired `offline_patient_data` localStorage cache,
while the working offline patient pickers read the IndexedDB roster maintained by
`OfflineManager`. Admin training previews also used internal links with
`target="_blank"`, which can leave or no-op inside installed app shells.

**Fixed:** Offline Mode now merges the detailed legacy cache with the canonical
IndexedDB roster for counts, storage, and the cached-patient list; explicit
offline downloads also write selected patients into IndexedDB and notify mounted
views to refresh. Internal training preview links now stay inside the router.

---

## Part 2 — Findings that need action OUTSIDE this repo (store packaging)

These cannot be fixed from the web codebase; they're the checklist for whoever
packages and submits the app.

### Google Play (TWA / PWABuilder)
1. **Digital Asset Links** — serve
   `/.well-known/assetlinks.json` from the production origin containing the Play
   signing certificate's SHA-256 fingerprint. Without it the TWA shows the browser
   URL bar over the whole app. The file must be added once the signing key exists
   (Play Console → App integrity). It can live in this repo at
   `public/.well-known/assetlinks.json` at that point.
2. **Orientation:** the manifest locks `portrait-primary`, and a TWA honors it.
   PDF review and trend charts read better in landscape on tablets. Deliberate
   trade-off to revisit — change `orientation` to `any` if tablet usage matters.
3. Play data-safety form must disclose PHI handling (health data, encrypted in
   transit, deletion path) — this app handles PHI on-device (IndexedDB queue).

### Apple App Store (WKWebView / PWABuilder-iOS wrapper)
1. **Sign-in method:** the login page is served by the Base44 backend. If it
   offers **Google sign-in, Google blocks OAuth inside embedded webviews**
   (`disallowed_useragent`). The wrapper must open auth in
   `ASWebAuthenticationSession`/`SFSafariViewController`, or login must work via
   email/password. Test this FIRST — it's the classic "works in Safari, broken in
   the store app" failure.
2. **Permissions strings:** telehealth video (`getUserMedia`), visit audio
   recording, and camera-fax capture require `NSCameraUsageDescription` and
   `NSMicrophoneUsageDescription` in the wrapper's Info.plist, and camera/mic
   permission forwarding in the WKWebView delegate (iOS 15+
   `requestMediaCapturePermission`).
3. **Screen share will not work on iOS:** `VideoRoom.jsx` uses
   `getDisplayMedia`, unsupported in iOS webviews/Safari. The toggle now detects
   this and shows a clear "isn't supported on this device" message (fixed in this
   pass — previously it failed silently); the capability itself remains
   platform-limited.
4. **Downloads:** the app exports CSV/PDF/JSON/ZIP via `a.download` blobs in ~50
   places, plus `jspdf.save()`. A bare WKWebView ignores `a.download` — the
   wrapper must implement `WKDownloadDelegate` (PWABuilder-iOS ships one; verify
   exports during review testing).
5. **Apple review requirements:** account deletion must be reachable in-app if
   accounts can be created (Guideline 5.1.1(v)); privacy policy URL; and since the
   app is for employees of licensed home-health agencies, distribute accordingly
   (public App Store listing may need a demo account for review, or use Apple
   Business Manager / unlisted distribution).
6. `black-translucent`→`default` status bar fix (Part 1 #5) applies to home-screen
   installs; a custom wrapper controls the status bar natively.

### Both stores
- **Privacy policy URL** and support contact must exist and match the listing.
- **Push notifications:** there is no Push API subscription or native push
  pipeline. The dead settings toggles were removed in this pass (Part 1 #11);
  if push is wanted, it must be built in the wrapper + backend together.
- **Storage partitioning:** an installed app has its OWN storage partition —
  tokens, the offline queue, and cached patients do not carry over from the
  browser. Users must log in again after installing, and any visits queued
  offline in the *browser* will only sync from the browser. The offline info card
  now says this explicitly.

---

## Part 3 — Known gaps kept as-is (documented, not fixed)

1. **React Query offline reads:** default `networkMode: 'online'` pauses queries
   offline; most pages show empty/loading states rather than cached data. The
   dedicated offline surfaces (Offline Mode tabs, SmartNote patient picker) now
   have working IndexedDB fallbacks (Part 1 #10), and Offline Mode's status/list
   now reads the same canonical roster (Part 1 #13); general pages remain
   online-first by design.
2. **`orientation: portrait-primary`** kept (phone-first product decision) — see
   Play checklist above for the tablet trade-off.
3. **Old hashed assets accumulate** in the SW cache across deploys until the next
   cache-name bump evicts them; bounded by browser cache quotas and the existing
   version-bump convention in `sw.js`.

---

## Part 4 — Verification

- `pnpm run build` — passes; `dist/` contains `manifest.json`, `sw.js`,
  `offline.html`, `icons/`, and relative `./assets/...` entrypoints (verified
  post-change).
- `pnpm run lint` — passes (0 errors).
- `pnpm test` — passes (node --test + Vitest); latest run covered 67 Vitest
  files / 412 component tests plus the Node utility/contract/security/dedupe
  suites, including the offline sync/queue suites.
- Icon set visually verified (any + maskable + apple-touch renders).
