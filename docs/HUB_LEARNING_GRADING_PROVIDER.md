# Hub learning grading provider

`centralLearningGrade` is a server-only adapter for the existing Base44 Core
InvokeLLM educator grading path. The Hub owns enrollment, attempts, certificates,
tenant access and the durable result store. This function writes no learning
entities and does not create accounts or assignments.

## Configuration inventory

| Setting | Location | Required behavior |
| --- | --- | --- |
| `HUB_LEARNING_GRADING_SECRET` | Base44 backend secrets and Hub Railway server variables | New random internal credential; never reuse a vendor key or publish to the browser. |
| `CAREMETRIC_HUB_GRADING_ENABLED` | Base44 backend secrets | Exactly `true` enables the adapter; all other values keep it unavailable. Enable only after the paired Hub job writer and callbacks pass their release checks. |

Neither value is needed by the existing PennSync-native grader. This adapter adds
no direct OpenAI credential and no HeyGen dependency.

## Fixed transport

POST a single `{ticket}` to the native function, authenticated with
`X-CareMetric-Grading-Key`. The function rejects browser Origins, wrong app IDs,
nonproduction data contexts, oversized bodies and extra caller fields. The SDK
receives only the pinned app identity and hosted service credential.

The two callbacks are fixed under the live Hub origin:

- `/api/internal/pennsync-grading/claim` consumes a `cmg_` ticket exactly once.
- `/api/internal/pennsync-grading/result` accepts an independently scoped `cmr_`
  result ticket and an exact canonical result hash. Replays of identical results
  must return the same receipt; changed results must conflict.

Both use the new shared server credential. Redirects are rejected. No caller may
choose an origin, model, prompt, rubric, source question or result recipient.

The claim binds the Hub job, enrollment, immutable version, tenant, answer hash,
source cohort hash, native learner/account IDs, course/question revisions,
submitted answers, point bounds and expiry. Native account, agency and unique
active membership checks run before grading and after it. Source revisions are
checked on both sides of the provider call. The educator prompt is generated
directly from `gradeTrainingAttempt`; a parity check prevents drift.

## Durable outcomes

The adapter invokes the provider at most once after claiming the job. It persists
one of `graded`, `not_dispatched`, `unknown`, or `invalid` before returning a stored
receipt. Partial, duplicate, foreign, nonfinite or out-of-bounds grades are not
accepted. Source/access changes do not become a completed grade.

The completion callback may retry the exact same payload three times. It never
reinvokes the model. If the callback remains unavailable, the native response is
`202 pending`; the consumed job stays pending/unknown in the Hub. A lost dispatch
connection after grading begins does not cancel the attempt to save its outcome.
Unknown provider outcomes must never automatically consume a learner attempt or
trigger another paid invocation. The Hub must expose explicit recovery semantics.

## Release sequence

1. Validate native contract tests, lint, high-signal typecheck, build and function
   transpilation; run the paired Hub PostgreSQL/HTTP/provider recovery tests.
2. Deploy the fixed Hub callbacks and durable job writer before enabling traffic.
3. Provision the new random server credential to both sides without printing it.
4. Deploy only `centralLearningGrade`, then enable its flag after the Hub contract
   is verified. Existing course-delivery cutover flags remain separate.
5. Verify production behavior using legitimate learner submissions. Synthetic
   paid grades and synthetic certificates are not production health checks.
