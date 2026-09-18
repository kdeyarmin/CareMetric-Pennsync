# Disposable private-file and single-object restoration proof

Run only after the owned local Auth acceptance and runtime migration bootstrap:

```sh
node --test services/integration-runtime/tests/http-storage.test.mjs
```

The existing isolated stack supplies real Supabase Auth, PostgREST and Storage. The test accepts its validated local ownership marker and fixed loopback addresses only. All bytes are one tiny, invented CSV. No hosted project, customer file, Base44 endpoint, model provider, email delivery, new account, role grant, membership change or direct Auth-table write is permitted. The final workflow step always destroys only the harness-owned stack and disposable volumes.

The test obtains fresh signed sessions for the two existing local administrator fixtures using the supported Admin `generate_link` and public token-hash verification APIs. It sends no email, checks both exact existing UUID/email identities through Auth, and resolves current agency/legacy identity through the real authority RPC. Session tokens, one-time hashes, keys, signed URLs and file bytes stay in memory. Only fixed phase/error classifications appear on failure. The two newly created sessions are logged out with local scope in `finally`; existing sessions are not revoked.

The unmodified `createStore`, `createProviders` and `performDurable` implementations operate against the local gateway. A test-only authority adapter uses the signed caller token to query current independent authority on every check, then derives the same HMAC subject and snapshot fields as the runtime. This adapter is not wired into the production service or frontend. Production `loadConfig` retains its hosted target pin; both release flags remain false, and explicit calls prove the normal HTTP handlers remain closed. This is a dependency-injected local contract proof, not production authority cutover.

The sequence proves:

1. Upload commits an actual private object and owner-bound metadata with the expected application, path, MIME, byte length and SHA-256. Retrying the exact durable upload returns the same handle and performs no second upload.
2. A foreign signed actor cannot obtain owner metadata or ask the runtime to mint a link. Foreign and anonymous direct Storage reads/signing and metadata RPC calls are denied using valid local gateway identities. No permission or policy is loosened for these tests.
3. The runtime's actual 60-second signed link downloads matching bytes. The test waits for real expiry, requires the old link to fail, requires the expired durable request to demand a new link request, and proves a new link downloads the same bytes without another upload. The entire test is bounded to 180 seconds.
4. With harness admission paused and all earlier requests awaited, only that exact synthetic object's bytes are removed through the Storage API. The test proves it is absent, restores the captured bytes at the same path with upsert disabled, then verifies the unchanged durable metadata/handle, SHA-256, uniqueness and access denials. It never writes Storage catalog rows directly.

A signed URL is a bearer capability: anyone possessing the unexpired URL can use it. The test proves authorization to obtain the link and its expiry; it does not claim that copied links remain actor-bound or are instantly revoked on logout. No signed URL is printed or persisted.

This supplies cutover-plan step 6 and a bounded file component of step 7. It is not a complete database snapshot restoration, legacy URL migration, customer backup/restore, cross-device/UI acceptance, provider rollout, or production rollback rehearsal. The synthetic metadata/job receipts and restored object remain only until scoped stack cleanup. Passing native SQL tests is not a substitute for this Docker-backed HTTP result.

Interfaces checked: [Auth Admin link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [token-hash verification](https://supabase.com/docs/reference/javascript/auth-verifyotp), [Auth REST API](https://github.com/supabase/auth/blob/master/openapi.yaml), and the existing runtime Storage REST implementation in `../providers.mjs`.
