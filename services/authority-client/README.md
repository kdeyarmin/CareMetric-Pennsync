# Independent staging authority client

This client exercises the six named RPCs in `services/authority-store` using independent Supabase Auth. It is an acceptance client, not selected by the production frontend. No existing Base44 login, entity, function, URL, native identity, provider route or integration release control changes.

The source inventory at `0afa0ff9f6846fa355b895f9cfbe142be201dc1f` still contained 444 direct entity calls across 69 entity types and 179 frontend files, 188 function invocation occurrences targeting 148 names, and 282 hosted function entries. Porting this first slice does not port those workflows.

## Contract and use

`createStagingAuthorityClient(config)` accepts an operator-selected exact project reference/URL, modern publishable key, the staging app ID, one of the four authorized test aliases, and that actor's independently provisioned Supabase UUID. The four source Base44 user IDs are pinned inside the module. Production and other existing shared Supabase projects are refused. A dedicated hosted staging project or the exact loopback test endpoint is required.

`signIn(password)` verifies the returned identity twice using the Auth sign-in and current-user endpoints. Tokens stay in memory inside the client. No tokens, passwords, refresh credentials, raw provider errors, storage entries or arbitrary SDK handles are returned. `rpc(name, parameters)` only supports context, memberships, patient roster/detail, assignment change and clinician-membership revoke. It validates exact response fields, actor/agency binding, versions and mutation receipts. The database independently authorizes every request. Client checks do not confer privileges or verify a JWT signature.

`invalidate()` cancels pending operations and discards the token. `signOut()` also requests server-side termination of the current session; a failed server logout is reported even though local access is cleared. Every asynchronous result rechecks the session epoch and timeout before returning. Authentication renewal, MFA, account recovery, production enrollment and full frontend integration are outside this staging client.

The new SQL interface is a staging-only contract with synthetic agencies/patients and no platform-owner exception. It does not silently fall back to Base44 if an operation is unsupported or the target is unavailable. Existing production integration controls remain disabled.

## Review and validation

Run `node --test services/authority-client/*.test.mjs`. Tests cover wrong identities and target projects, account verification, stale session completion, timeout implementations that ignore cancellation, cross-agency or malformed responses, exact mutation receipts, and sanitized failures. Review reproduced and corrected three defects before release: a final promise-boundary stale response, missing cursor/extra result fields, and successful completion after an ignored timeout.

These transport tests use synthetic responses. Real signed Auth sessions, four independently enrolled users, an actual browser/network trace without Base44 execution, full workflow acceptance, customer archive/restore and native device tests remain distinct required evidence. Do not label this client as a completed authority migration.
