# Offline CMS HHGS adapter

This is a local, server-side integration building block. It has **no endpoint,
tenant authority, payment calculation, production import, or deployment**.
All PennSync payment, external-integration and browser-operation gates remain
disabled. Do not supply live patient records until the authorization, source
mapping, hosting and clinical acceptance work in `docs/pdgm-cy2026.md` is complete.

`groupCmsClaims({ records, javaExecutable, jarPaths, timeoutMs })` requires:

- Node matching `.nvmrc` and an absolute path to **JDK 17** `java` (the source
  launcher requires a JDK, not a stripped JRE);
- trusted operator-configured absolute JAR paths keyed by `07.0.26`, `07.1.26`,
  and `07.2.26`, from the official manifest; paths must never come from requests;
- 1–1000 complete CMS input records, exactly 600 printable ASCII bytes each.

No field is guessed, normalized, padded or truncated. The official claim-from
date at columns 25–32 selects the JAR. Missing, invalid, or unsupported dates
are adapter errors; other clinical input validation remains with CMS. The
action byte at column 600 must be blank: diagnostic and skip flags are forbidden.
The original input order survives batches spanning multiple releases.

The bridge calls the CMS string API with its complete input contract, using the
tables embedded in the hash-pinned JAR. It receives claims over stdin and emits
only the 16-character version/HIPPS/validity/return-code protocol. Claims are not
written to disk or passed as process arguments. JVM environment agents and
classpaths are excluded, diagnostic output is suppressed, and process output,
heap size and per-release execution time are bounded. Java crash/heap dumps are
disabled. Temporary copies of verified public JAR bytes and the reviewed bridge
are removed on success and failure. The adapter returns fixed error codes only.
The trusted host and OS still need production isolation, retention, access and
crash-handling review before any PHI processing.

Returned records contain `version`, `hipps`, `validityFlag`, `returnCode`, `raw`
(the 16-character CMS result only), and `jarSha256`. A successful invocation is
**not** necessarily a successful CMS grouping: callers must inspect both CMS
codes. Internal/fatal, malformed, wrong-version or incomplete responses reject
the entire batch. `paymentAvailable` is always `false`. The adapter does not
calculate a dollar amount or establish billability.

Run boundary tests with `pnpm test:hhgs`. After extracting the three official
packages, run `pnpm verify:hhgs-adapter -- /absolute/path/to/java17
<January-package-root> <April-package-root> <October-package-root>` (omit the
line break). No binary or CMS distribution is vendored. The dedicated GitHub
workflow downloads only pinned public CMS packages, validates hashes before
extraction, and checks all 310 synthetic cases through this adapter on JDK 17.

The fixture set includes three March 31 records within the April package. The
adapter correctly selects January's JAR for those: 104 January, 65 April and 141
October results, all returned in original fixture order. This is adapter parity,
not evidence for chart-to-claim mapping, payment adjustments, tenant isolation,
or a hosted clinical workflow.
