# Trusted caller claims — 2026-09-10 (owner-approved)

## Problem

Base44 `auth.updateMe` (`/entities/User/me`) lets every signed-in account rewrite
every custom User field on its own record. Only built-in fields (`id`, `email`,
`role`) are platform protected. With hosted visibility at "Public (login
required)", anyone can sign up, set `account_type: 'super_admin'` or
`agency_name: '<a real agency>'` on themselves, and call legacy backend handlers
that branch on those claims.

A local harness (spoofed `super_admin` + agency claims, no membership) reached
past authorization in, among others, `generateUserRosterPDF`, `getCommsDashboard`,
`getTeamTrainingReadiness`, `exportLearningReportCSV`, `rebuildExistingInServices`
and the in-service seeding tools.

## Fix

New shared helper `trustedCallerClaims` (`base44/_shared/backendHelpers.mjs`)
exposes `withTrustedClaims(base44, profile)`. 73 legacy handlers that read the
caller's `account_type` / `agency_name` / `agency_id` / `is_approved` now wrap every
`base44.auth.me()` call in it, so those claims are rebuilt before any handler
logic runs:

| Caller | Claims after `withTrustedClaims` |
|---|---|
| Built-in `role: 'admin'` (owner included) | Unchanged. The protected role already grants platform-level RLS, so its self-scoping claims cannot widen access. |
| Exactly one active, service-owned `AgencyMembership` (matching immutable user id and built-in email) in an active Agency | `agency_name` / `agency_id` from the Agency; `account_type: 'agency_admin'` only for `tenant_role: 'agency_admin'`; approved. |
| Anyone else | No agency, not approved, and `super_admin` / `agency_admin` downgraded to `user`. |

Missing callers pass through, so existing 401 branches are unchanged. Membership
lookup failures fail closed.

Enforced by `base44/functionTests/trustedCallerClaimsContract.test.js`: helper
behavior (spoof stripping, membership derivation, ambiguous/inactive/failing
lookups, admin pass-through) and a repository-wide scan requiring every handler
that reads caller claims to wrap each `auth.me()` call, except the reviewed
`PROTECTED_CLAIM_READERS` list (handlers that already authorize through the
protected role, platform-owner, or membership helpers).

## Still open

- Handlers still trust **other users'** self-editable fields when choosing
  notification recipients (`u.account_type === 'super_admin'`) or building agency
  rosters (`u.agency_name === caller.agency_name`). A spoofed account can join a
  recipient list or roster; move these to `AgencyMembership` joins.
- Several handlers validate the request body before authorization, so an
  unauthorized caller can learn validation errors (no data).
- Staff onboarding must provision an `AgencyMembership` (manageAgencyMembership
  `provision`). Without one, a user's legacy agency features fail closed.
