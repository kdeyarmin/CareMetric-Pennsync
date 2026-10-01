# Dependency advisory baseline

Measured 2026-10-01 on `main` at `00ccac41`, and on this branch after the change
below. Every figure here is a reading of a moment: the advisory database is
remote and moves on its own, so re-run the commands rather than quoting the
numbers.

## What was wrong, and it was the detector rather than the dependency

`.github/workflows/ci.yml` runs `pnpm audit --prod --audit-level high` under
`continue-on-error: true`. The step prints its findings and can never fail a
build. Between 2026-09-29 and 2026-09-30 the production audit went from one low
advisory to fourteen, seven of them high, with nothing in the tree moving, and
every CI run in that window reported green. The step's own log ended in
`exit code 1` the whole time.

Removing `continue-on-error` would have turned `main` red on advisories that were
already known, which gets reverted rather than fixed. So the step stays as the
report it is, and a second step gates on a baseline of the advisories this
repository has read and accepted.

## The fourteen, measured

`pnpm audit --prod --audit-level high` prints a table per high finding and a
footer counting everything. On this repository that reads as seven axios
findings when there are twelve, because the five moderate ones are counted and
not printed. **The level flag filters the display, not the measurement**, so
every reading below was taken at `--audit-level low`:

| severity | package | count | path |
| --- | --- | --- | --- |
| high | axios | 7 | `.>@base44/sdk>axios` |
| moderate | axios | 5 | `.>@base44/sdk>axios` |
| low | dompurify | 1 | `.>dompurify`, `.>jspdf>dompurify` |
| low | quill | 1 | `.>react-quill-new>quill` |

`axios@1.18.1` resolved in the lockfile; all twelve say patched in `>=1.20.0`.
There is no direct axios dependency in `package.json`.

## Reachability: presence is not exposure

The seven highs were measured against the shipped artifact rather than against
the dependency graph, by building the app and reading the bundle. The axios
package's own `browser` field maps `./lib/adapters/http.js` to
`./lib/helpers/null.js`, and the built bundle confirms it: the adapter registry
in `dist/assets/base44Client-*.js` reads

```
{http:null,xhr:<fn>,fetch:{get:<fn>}}   adapter:['xhr','http','fetch']
```

so the Node HTTP adapter is **absent from the artifact**, and `xhr` is first in
the default order and available in every browser the app targets. The strings
`http2`, `ClientHttp2`, `shouldBypassProxy`, `fromDataURI` and `createConnection`
do not occur anywhere in `dist/assets/*.js`. The SDK sets no `adapter`, no
`proxy`, no `http2Options` and no `maxRedirects`, and nothing in `src/` imports
axios directly.

| advisory | what it needs | reachable in the shipped app |
| --- | --- | --- |
| GHSA-c29m-xwm3-cm6r — ReDoS in `fromDataURI` | Node HTTP adapter | **No** — code not in the bundle |
| GHSA-mghh-pgcx-3jjj — ReDoS in `shouldBypassProxy` | Node HTTP adapter, proxy config | **No** — code not in the bundle |
| GHSA-3pq3-5fj3-cg6v — HTTP/2 adapter bypasses DNS and proxy controls | Node `http2` | **No** — code not in the bundle |
| GHSA-542g-h47m-68v8 — DoS via `ClientHttp2Session` | Node `http2` | **No** — code not in the bundle |
| GHSA-m8m8-qj5v-23w3 — socket hijack via inherited `createConnection` | Node HTTP adapter | **No** — code not in the bundle |
| GHSA-r4gj-5m52-g5wh — `maxRedirects: 0` not enforced by the fetch adapter | fetch adapter selected | **No** — bundled but never selected, `xhr` wins; and nothing here sets `maxRedirects` |
| GHSA-x97p-jq2g-jp4f — prototype pollution gadget in `toFormData` options | `toFormData`, plus a pollution primitive | **Present** — see below |

So **six of the seven highs were code that never shipped**. The one that did,
and four of the five moderates, are prototype-pollution *gadgets*: each one
turns an existing `Object.prototype` pollution into a worse outcome, and none of
them is a pollution primitive. Whether this application has such a primitive is
a separate question and **is not measured here**. On that basis this was a real
finding to fix and not an incident.

Unit tests run the SDK under Node, which does select the Node adapter; a test
runner is not a production surface and no conclusion here rests on it.

## The server side, measured from the source rather than the platform

The Base44 Deno functions under `base44/functions/` import
`npm:@base44/sdk@0.8.31` and resolve their own dependencies on Base44's hosted
platform. **Which axios version that resolves is not measurable from here and the
override above does not reach it.** That is a fact about the resolution, not
about the code, and the code is in this repository, so the reach is measurable
even though the version is not. Deno provides no `XMLHttpRequest`, so the Node
adapter would be selected there and the bundle argument above does not apply.

**No function reaches axios directly.** Across 282 function directories there is
no axios import; the only occurrence of the string is a comment in
`testAutomations/entry.ts` about an SDK return shape. Every axios call is the
SDK's own internal client, created with `baseURL: ${serverUrl}/api`.

**Every axios call in the SDK passes a relative path.** Enumerated across
`node_modules/@base44/sdk/dist/`: 40 distinct call sites, every URL a template
literal under `/apps/${appId}/...` or a module-local `baseURL` of the same shape.
The three that pass a bare `url` variable (`sso.js` twice, `connectors.js` once)
build it from the same template one line above. **The SDK sets no `adapter`, no
`proxy`, no `http2Options`, no `maxRedirects` and no `maxContentLength` anywhere.**

That leaves one request-derived input reaching axios, and it is worth naming
because it looks like the finding and is not. `createClientFromRequest` takes
`serverUrl` from the `Base44-Api-Url` request header with no scheme validation:
`serverUrl: serverUrlHeader || "https://base44.app"`. This repository already
treats that header as request-controlled — `centralAdminRead/entry.ts` rebuilds
the request to strip it before handing it to the SDK, saying in its own comment
that `Base44-Api-Url` must not be able to "redirect a service credential". The
other 246 `createClientFromRequest(req)` call sites pass the request through.

So the question is whether a `data:` value in that header reaches
`fromDataURI`, the ReDoS in GHSA-c29m-xwm3-cm6r. **Measured on axios 1.18.1
itself, in an isolated install, in the exact shape the SDK produces: it does
not.** The data branch feeds the parser `config.url`, not the base URL and not
the combined path:

```js
convertedData = fromDataURI(own('url'), responseType === 'blob', { ... });
```

A `data:` baseURL with any relative path appended is refused before the parse
(`ERR_BAD_REQUEST`), while a `data:` URL passed as the request `url` resolves and
reaches the parser. Both readings were taken with the adapter instrumented to
print its computed `fullPath` and protocol, which is how the discriminator was
found: the baseURL case and the url case produce a byte-identical `fullPath` and
the same `data:` protocol, and only the second parses. **So `fullPath` was not the
discriminator and reasoning from it would have given the wrong answer.** The one
place the base URL can reach a data-URL scanner is the content-length estimator,
which needs an empty `config.url` and a finite `maxContentLength`; the SDK sets
neither, and every call site passes a non-empty path.

The other four highs under a Node adapter resolve the same way, except for one
residual that is honestly open:

- GHSA-3pq3-5fj3-cg6v and GHSA-542g-h47m-68v8 need the HTTP/2 transport, which
  axios selects only on an explicit `http2Options`. Nothing sets it.
- GHSA-m8m8-qj5v-23w3 and GHSA-x97p-jq2g-jp4f are prototype-pollution gadgets and
  need a primitive, which is not measured here. `toFormData` is additionally not
  entered: where the SDK sets `multipart/form-data` it has already built a real
  `FormData`, and the plain-object branch sends `application/json`.
- **GHSA-mghh-pgcx-3jjj is the open one.** `shouldBypassProxy` is called only when
  `getProxyForUrl` returns something, which reads `HTTP_PROXY`/`HTTPS_PROXY` from
  the process environment, and it normalises the *redirect target*. So it needs
  proxy environment variables set in the function's runtime and a redirect whose
  Location is attacker-influenced. **Both are properties of Base44's platform and
  of what its own API returns, and neither is measurable from this repository.**

That residual cannot be closed here and cannot be fixed here either: it concerns
whatever axios the platform resolves for `@base44/sdk@0.8.31`. What would close
it is reading the function runtime's environment for proxy variables, which is a
platform question for whoever can see it.

## The fix

`pnpm-workspace.yaml` already pins `socket.io-parser: 4.2.7` for the same shape
of problem — an advisory under `@base44/sdk` that nothing here depends on
directly. axios follows it:

```yaml
overrides:
  axios: 1.20.0
```

`@base44/sdk` declares `axios: ^1.18.1`, so `1.20.0` is inside its own range and
the SDK does not have to move. Measured after the override: the lockfile resolves
`axios@1.20.0`, the build succeeds, the adapter registry in the rebuilt bundle is
unchanged, and the audit drops from fourteen to two.

`dompurify` went the same way for the remaining patchable low: `3.4.16` is inside
the declared `^3.4.15` and inside `jspdf`'s own `^3.3.1`, so a lockfile bump took
it. The audit is then **one** advisory.

## What is left, and why

`GHSA-v3m3-f69x-jf25` against `quill` has **no patched version**: it names
`=2.0.3` vulnerable and `2.0.3` is the latest quill published, so the existing
`quill: 2.0.3` override is already at the ceiling. Its single call site,
`src/components/documents/VisualPDFTemplateEditor.jsx`, already passes quill's
exported HTML through `sanitizeHtml` (DOMPurify) before it reaches app state or
storage, naming this advisory in its own comment. It is recorded in
`audit-advisory-baseline.json` with that reason and re-checked when quill ships a
fix.

## The gate

`pnpm run check:audit-advisories` (`tools-audit-advisory-baseline.mjs`) runs the
audit at `--audit-level low`, takes the finding set from `--json`, and compares
it with `audit-advisory-baseline.json`. It fails on an advisory that is **new**,
one whose severity **escalated**, one that reached a dependency path the baseline
does not record (**widened**), a baseline entry whose advisory is gone
(**stale**), and a baseline entry with no stated reason (**unexplained**). There
is no warn level: a finding kind that only warns is the `continue-on-error` step
again, one layer in.

It fails closed. An audit that cannot be run is reported as unmeasured rather
than as nothing found, and a payload whose shape it does not understand raises
rather than yielding an empty set — a quiet pass is the failure mode this whole
tool exists to stop.

Re-record after a dependency moves with

```
node tools-audit-advisory-baseline.mjs --write
```

which carries each existing `reason` and `recordedAt` forward and leaves a new
entry's reason blank, failing until one is written.

`tools-audit-advisory-baseline.test.mjs` plants every finding kind and asserts
the clean case too, since a comparison that failed on everything would pass each
sabotage for the wrong reason. Each detection was disabled in turn and the suite
confirmed to fail: new 3 failures, escalated 2, stale 2, widened 1, unexplained
2, and the bad-payload refusal 1.
