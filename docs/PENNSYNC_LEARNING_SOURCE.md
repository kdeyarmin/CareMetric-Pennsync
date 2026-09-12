# PennSync learning source transport

`centralAdminRead` accepts `learning.source.snapshot` only with an exact, one-use
Hub SMS capability. Both the mapped protected native administrator and current
Hub authority are checked. The native role is checked again after the read.
Existing SaaS directory operations keep their existing behavior.

The transport projects every declared field in the ten learning entities and
the minimum User, Agency and AgencyMembership identity evidence. It reads every
page twice in stable ID order, rejects inconsistent or incomplete scans, and
returns a revision bound to the exact serialized source. This detects changes
across reads; Base44 does not provide a transaction across these entities, so the
Hub also reads the source again before preserving it. Original source records
are never changed by this operation.

Course, module and question content, credit and certificate policy, annual-plan
associations, assignments, attempts, attestations, certificates and legacy
module history remain distinct. The transport does not turn standalone modules
into courses or infer that a learner email identifies the Hub administrator.
Identity evidence goes only to private Hub storage. Browser inspection receives
counts and course metadata, not the raw source or learner emails.

External URLs, embedded web references and credential-shaped fields become
explicit SHA256 reference markers. Their exact original projected records also
have revision hashes. An unresolved reference requires a separate verified media
transfer and cannot be presented as fully migrated material. Source content is
not published by this operation, and no external URL is fetched.

The source field list and helper are embedded with
`node tools-sync-pennsync-learning-source.mjs`. The native contract tests verify
the generated copy and every declared learning field against the entity schemas.
Deploy only `centralAdminRead` after normal CI and merge. No entity policies,
credentials, schedules, frontend publication or cutover flag changes are part of
this source-reader release.
