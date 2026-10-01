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

Two things the table does not cover. The Base44 Deno functions under
`base44/functions/` import `npm:@base44/sdk@0.8.31` and resolve their own
dependencies on Base44's hosted platform, so they are outside this lockfile and
outside this reading — a server-side axios there would select the Node adapter,
and nothing in this repository can measure what that platform resolves. And unit
tests run the SDK under Node, which does select the Node adapter; a test runner
is not a production surface and no conclusion here rests on it.

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
