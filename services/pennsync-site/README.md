# `services/pennsync-site` — the owned static host

Serves the built PennSync frontend from our own infrastructure instead of
Base44. This is the hosting half of D3's second step (`complete_hosting_exit`);
`docs/HOSTING_EXIT_RUNBOOK.md` is the ordered procedure and says who does each
part.

**It is paused and deploying it changes nothing a visitor can see.**
`PENNSYNC_SITE_RELEASED` must read exactly `enabled-v1`; with anything else, or
absent, every route but `/healthz` answers `503
PENNSYNC_SITE_RELEASE_PAUSED`. That is deliberate: the service can be built,
deployed and observed long before the DNS record moves, and releasing it is a
separate act from deploying it.

## What it does and does not do

It reads `dist` once at boot into an inventory and answers requests from that
map. It holds no credential, opens no database connection, and runs no business
logic. The bundle it serves still reaches `services/pennsync-api`, the
integration runtime and the authority store exactly as the Base44-hosted bundle
does — moving the host does not move anything else.

| Route | Answer |
| --- | --- |
| `/healthz` | 200 JSON, released or not, so a deployment is observable while paused |
| `/` and any extensionless path | `index.html`, 200, `cache-control: no-store` |
| a file in the inventory | its bytes, with an ETag and a 304 on revalidation |
| `/assets/<hashed>` | `public, max-age=31536000, immutable` |
| anything under `/assets/` that is not in the inventory | 404, never the app shell |
| any other path with a file extension | 404 |
| anything but `GET`/`HEAD` | 405 with `Allow` |

Response headers are the set measured on both production addresses on
2026-10-01 (`referrer-policy`, `strict-transport-security`,
`x-content-type-options`, `x-frame-options`) and no more. The
Content-Security-Policy stays where it is today, in `index.html`'s
`<meta http-equiv>`.

## Two things it must keep refusing

**No service worker.** App-Bound Domains restrict service workers, and
`src/lib/hostedPaths.spec.js` asserts the frontend registers none. A static
host that added one would change the iOS analysis in
`docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md`, so this service never serves one and
would refuse the file's extension anyway.

**No sourcemap.** `.map` is in `REFUSED_EXTENSIONS`, so a build that started
emitting one fails the boot walk — and the Dockerfile runs that walk against
the real `dist`, so it fails the image build rather than a request.

## Building

The image build context is the repository root. Three build arguments have no
default and refuse when empty — `VITE_BASE44_APP_ID`,
`VITE_BASE44_BACKEND_URL`, `PENNSYNC_ASSET_REVISION` — because each one decides
what the bundle talks to or what its assets are named. The asset revision is
the subtle one: without it `vite.config.js` falls back to a timestamp, and a
timestamped build cannot be compared with a local one by
`tools-live-frontend-sync.mjs`.

```sh
docker build -f services/pennsync-site/Dockerfile \
  --build-arg VITE_BASE44_APP_ID=<app id> \
  --build-arg VITE_BASE44_BACKEND_URL=https://base44.app \
  --build-arg PENNSYNC_ASSET_REVISION=$(git rev-parse HEAD) \
  -t pennsync-site .
```

Locally, against a `dist` you already built:

```sh
pnpm run build && PENNSYNC_SITE_RELEASED=enabled-v1 node services/pennsync-site/server.mjs
```

## Verifying a deployment

`node tools-live-frontend-sync.mjs` compares a local build with a published
origin asset by asset. Before the DNS move the owned host has no production
hostname, so point it at the deployment's own address:

```sh
pnpm run build
PENNSYNC_SITE_VERIFY_ORIGIN=https://<deployment-host> node tools-live-frontend-sync.mjs --json
```

The report marks that run `"origin_allowlist": "environment"` rather than
`"production"`, so a green against a preview host is never read as proof about
production.

## What is NOT in this directory

Creating the service, setting its variables and pointing a domain at it are all
outside the repository. The runbook names them and who performs each.
