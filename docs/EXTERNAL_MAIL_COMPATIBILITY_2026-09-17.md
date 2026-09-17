# External email compatibility — September 17, 2026

## Why this is needed

PennSync's backend notifications call Base44 Core.SendEmail with branded HTML in
`body` and an optional `from_name`. The first external SendGrid adapter only
accepted `to`, `subject` and `body`, and always labeled the body `text/plain`.
Redirecting existing notification templates into it would either reject the
sender name or show raw HTML instead of the formatted email.

## Implemented contract

The external adapter now accepts an explicit `content_type` of `text/plain` or
`text/html`, and an optional validated `from_name`. Omitting content_type keeps
existing external plain-text behavior; it never guesses HTML by sniffing text.
The configured sender email is still server-owned. Caller-supplied sender
addresses, arbitrary headers, attachments, tracking settings and sandbox flags
are rejected. Recipient count, body/subject size and control-character checks
remain enforced. Names and subjects cannot inject header line breaks.

The pure mail-contract module is shared by browser validation, actual SendGrid
request construction and operator sandbox checks. HTML bytes, escaped entities,
Unicode, table layout and existing links are preserved; this adapter does not
execute/render HTML, sanitize or rewrite templates, fetch external image URLs,
or change existing template interpolation/escaping policies.

Successful production SendGrid requests return provider acceptance only, not
confirmed delivery. Browser/server permissions, immutable agency membership
checks, durable request binding and all release switches are unchanged. Existing
Base44 email calls have not been redirected in this change. A branded caller
must explicitly choose text/html when its path is migrated.

## Bounded actual-provider acceptance procedure

The separate CLI `operator-mail-acceptance.mjs --execute-mail-sandbox-v1` also
requires private confirmation `INTEGRATIONS_MAIL_ACCEPTANCE=explicit-mail-sandbox-v1`.
It refuses when master/browser traffic is enabled or any operations are selected.
The ordinary HTTP server has no operator route/import.

The procedure uses only fixed invented messages to acceptance@example.invalid.
It sends at most two SendGrid sandbox requests (plain text and HTML), using the
same request builder as the production adapter with exactly one added sandbox
flag. SendGrid's sandbox must return HTTP 200; production HTTP 202 is not accepted
as sandbox success. No email is delivered, no model/provider document operation
is requested, and no Base44 authentication or data call is made. Dedicated
synthetic encrypted receipts in the existing integration ledger prevent
accidentally repeating the same provider validation after restart. Uncertain
results are retained for reconciliation, not silently retried.

A successful sandbox result verifies provider request format and acceptance,
not inbox appearance, real sender deliverability, user authorization, clinical
workflow completion, or whole-app zero-credit execution. The procedure reports
only booleans/counts/revision, never credentials, body content, recipient or
signed URLs.

## Preserved resources

No existing app-store package, signing identity, user account, membership,
customer file, document URL, template source, database schema, scheduled job or
production provider release flag is changed. No new npm dependency is required.
The existing provider-acceptance CLI now reuses the same plain-text builder;
its fixed synthetic inputs and delivery-disabled behavior are preserved.

## Verification and remaining work

Native tests cover exact legacy plain-text requests, rich HTML/name handling,
malformed fields, header injection, sender/role/release boundaries, provider
status handling, actual browser parameter/response wiring, strict operator flags,
fixed sandbox recipients, idempotent replay, and no HTTP operator exposure.
The full application CI and exact deployed revision must be recorded separately.
A local test timeout or merely configured key is not an acceptance result.

The remaining full migration includes independent authoritative membership
access, actual browser/backend call cutover, private-file consumer conversion,
unsupported model/search/image/telecom/payment/signing paths, and signed-in
employee/admin/device acceptance. This patch removes the email-format blocker;
it does not silently bypass any of those conditions.

Official provider contract references:
https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sandbox-mode
