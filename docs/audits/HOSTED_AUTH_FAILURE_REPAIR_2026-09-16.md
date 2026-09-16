# Hosted authentication-error repair

On September 16, 2026 at 13:54:46Z, independent unsigned POST requests to the existing production app returned HTTP 401 from manageVehicleMaintenance but HTTP 500 from getTeamTrainingReadiness, submitTimesheet and submitTimeOffRequest. The latter returned only an error field and no successful result; no records or provider operations were requested.

The three handlers checked a null auth.me() result but treated an SDK rejection from that same operation as a generic internal error. The previous no-session harness supplied a null user and therefore did not exercise the real SDK rejection shape. This distinction is now explicitly covered by the workforce contracts.

The new canonical authReadFailure helper tags errors ONLY at the auth.me() promise boundary. Known 401 and 403 statuses produce the corresponding safe public response; network/unknown authentication failures produce 503. Later datastore/provider errors cannot be mislabeled as caller authentication failures. Original error messages and credentials are not returned; all tagged responses use no-store. No permission grant, identity, membership or release control changes.

Regression tests cover SDK status and Axios response.status, 401, 403, unknown/network failures, zero record access or writes on failed authentication, and a post-authentication payroll lookup failure that retains its own error meaning. 29 workforce tests pass; combined workforce/shared-claims/audit-harness tests total 53 (included in the 889-case security suite, not additional to it). Source lint, high-signal typecheck, 282 backend targets, 225 shared-helper consumers and the hosted-style build with 501 inspected JavaScript files pass locally.

This record describes the source repair and pre-deployment observations. Exact-head CI, merge and fresh hosted response verification are separately required before marking the live issue resolved. The source is not proof of a valid signed-in employee workflow.
