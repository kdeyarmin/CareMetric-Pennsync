# CY 2026 CMS HHGS evidence and implementation gate

> **Payment remains unavailable.** This repository does not yet implement or
> host the complete CMS Home Health PPS Grouper Software (HHGS). The legacy
> factorized payment approximation is retired, every reimbursement/UI gate is
> default-off, and `calculatePDGM` returns a static unavailable response before
> SDK client creation, request-body parsing, authentication, or data access.

## Primary CMS releases

CMS publishes date-effective HHGS releases. The claim-from date—not download
date and not “latest available”—selects the package.

| Claim-from date | CMS release | CMS posted | Distribution SHA-256 |
| --- | --- | --- | --- |
| 2026-01-01 through 2026-03-31 | `07.0.26` | 2025-12-01 | `40cdaad09e83ec67d37ae041b59bdc2a9f9fd8b76638dd36702da0236f4628e7` |
| 2026-04-01 through 2026-09-30 | `07.1.26` | 2026-02-10 | `0c8c35996fea3be516c000afa5ae67dac64e25d9fb3123ce0f5e16d9f95bf0e7` |
| 2026-10-01 through 2026-12-31 | `07.2.26` | 2026-08-20 | `ff3efb8e4a09f5fb9d111df133129dc2e2dbfea829a39b4498e405b3cdcb7f26` |

Primary source and distributions:

- [CMS HHGS release page](https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-grouper-software)
- [January 2026 v07.0.26 ZIP](https://www.cms.gov/files/zip/jan-2026-hh-pps-grouper-software-hh-pdgm-v07-0-26-posted-12-1-2025.zip)
- [April 2026 v07.1.26 ZIP](https://www.cms.gov/files/zip/apr-2026-hh-pps-grouper-software-hh-pdgm-v07-1-26-posted-02-10-2026.zip)
- [October 2026 v07.2.26 ZIP](https://www.cms.gov/files/zip/oct-2026-hh-pps-grouper-software-hh-pdgm-v07-2-26-posted-08-20-2026.zip)

CMS says v07.2.26 has no logic or interface changes, but its diagnosis tables
change grouping and HIPPS assignments effective 2026-10-01. Using it early is
therefore incorrect. The strict resolver in
`src/components/pdgm/cmsHhgsReleasesCy2026.js` encodes the three CY 2026 ranges
and rejects timestamps, invalid dates, dates outside CY 2026, and gaps. It is an
audited building block; it is **not yet wired into a PennSync payment path**.

## Immutable artifact manifest

`src/components/pdgm/cmsHhgsReleasesCy2026.js` records the exact byte length and
SHA-256 of each CMS ZIP plus the matching:

- `HomeHealth.jar`;
- `Version_Range.txt` and `Claim_Layout.txt`;
- version-specific diagnosis, code-first, subchapter, clinical-group,
  comorbidity, functional-response, HIPPS, validity, and return-code tables; and
- both official normal and irregular/GRC fixture files.

The hashes were recomputed from fresh CMS downloads on 2026-09-03. Full hashes,
not prefixes, are stored in source and enforced by tests.

## Exact offline CMS fixture verification

The CMS ZIPs are roughly 52–57 MiB each and are not committed. After downloading
all three primary distributions, run the verifier with Java 17 and `unzip`:

```bash
pnpm verify:cms-hhgs -- /path/to/v07.0.26.zip /path/to/v07.1.26.zip /path/to/v07.2.26.zip
```

The verifier:

1. rejects any ZIP whose byte count or SHA-256 differs from the manifest;
2. verifies every pinned inner artifact before execution;
3. runs the matching official `HomeHealth.jar` against both CMS fixture files;
4. extracts the expected 16-character `VER + HIPPS + GVF + GRC` result from
   one-based columns 601–616 defined by `Claim_Layout.txt`; and
5. requires exact line-for-line output for all **310** CMS cases:
   `50 + 51` for v07.0.26, `17 + 51` for v07.1.26, and `90 + 51` for v07.2.26.

A 2026-09-03 audit run matched 310/310 using OpenJDK 17. That proves the pinned
CMS packages and offline runner reproduce the expected CMS results. It does
**not** prove parity for PennSync: the application has no complete HHGS port or
wired official-JAR service to compare yet.

## What is verified in source today

- `cmsPdgmFunctionalDataCy2026.js` transcribes the byte-identical CY 2026
  `FI_Responses.txt` table (SHA-256
  `36a4646815903eceb7d16ee67b787c7a97f53beeb71397cd2546ba2094542efa`).
- `hhCaseMixWeightsCy2026.js` contains the separately published official CY 2026
  432-row case-mix-weight/HIPPS/LUPA table and is strict-parsed in tests.
- `cmsHhgsReleasesCy2026.js` resolves the correct 07.0/07.1/07.2 release for a
  valid CY 2026 claim-from date.
- `pdgmGrouper.js` fails closed and cannot report a complete/billable result.
- The former base × clinical × functional × comorbidity approximation is
  explicitly retired. User-supplied rate data cannot unlock it or make it
  official.

These pieces are evidence and validation aids, not a payment calculator. The
432-row table cannot itself apply diagnosis validity, code-first/manifestation,
secondary-diagnosis promotion, subchapter exclusions, date-effective table
selection, admission source, timing, LUPA, outlier, or other HHGS rules.

## Remaining external and implementation blockers

Before any PennSync payment amount, reimbursement comparison, or “official” flag
can be enabled:

1. choose and security-review one supported architecture: an authorized
   server-side Java 17 HHGS service or an exact, maintainable port;
2. wire claim-from-date version selection and preserve the complete official
   input/output record contract;
3. implement every required HHGS rule/table without client-side PHI or browser
   trust;
4. compare the PennSync result—not merely the official JAR against itself—to all
   310 pinned CMS fixtures plus boundary and regression cases;
5. add tenant authorization, immutable source provenance, audit, rollback, and
   hosted nonproduction evidence; and
6. obtain clinical, coding, billing, security, and release-owner sign-off.

Until then, use the official EMR/CMS-approved grouper for all billing and
reimbursement decisions.
