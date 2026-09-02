# Documentation gaps: what clinicians see, what administrators see

Two audiences, one detection engine, and a boundary that is enforced by
structure rather than by a role check on a render.

## The rule

**Findings are triggered by evidence in the record. Never by payment.**

If the trigger were "a different response would pay more," then a clinician
shown that finding is being asked to change a federal assessment for a financial
reason. If they are not told that is the reason, they are attesting to something
they were not shown. The clinician signs the assessment; concealing the motive
makes them the instrument of a decision they did not knowingly make, and
upcoding OASIS to move PDGM is an active False Claims Act enforcement area for
home health.

So the engine has no concept of money at all — not hidden from clinicians,
absent.

## The structural guarantee: symmetry

Every rule fires in **both** directions:

- `suggests_more_dependence` — the note describes more assistance than the recorded response
- `suggests_less_dependence` — the note describes more independence than the recorded response

A rule set that only fires toward more dependence would raise acuity, and
payment, every time it spoke — whatever its comments claimed. `documentationGaps.test.js`
fails the build if any item loses a direction, or if the two directions'
contradiction sets overlap such that one can never fire.

The admin view surfaces the running ratio between the two directions, and warns
when it exceeds 3×: that may be a real documentation habit worth training, or it
may mean the rules have drifted one way and need re-reading before they drive
anything.

## What a clinician sees

`DocumentationGapPanel` shows, per item: the recorded code, the verbatim
sentence(s) from the note, the direction of the mismatch, and a question —
*"Re-read the wording of this item in your EMR and confirm which reflects the
patient."*

It does not suggest a code, imply a direction to move, or mention money. The
reason it states is the whole reason; there is no second, unstated one.

There is deliberately **no `<FinancialGate>` in that component**. A gate there
would imply there is something financial to hide. The point is that the payload
it receives has no financial dimension.

## What an administrator sees

`DocumentationGapAdminPanel`, behind `FinancialGate` (fail-closed: renders
nothing while the user resolves, nothing for any non-admin):

- Gap counts by item and direction — the training signal
- Direction balance, with the drift warning above
- Cohort comparison on **closed** episodes: mean payment and case mix for
  episodes with gaps versus without

`listOASISUploads` already strips `/revenue|payment|reimburs/i` keys server-side
for non-financial users. That is the boundary that actually holds; the client
gate is UX.

## Closed episodes only, and why that is the substantive line

`documentationGapAnalytics` refuses any episode that is not closed. Not a
technicality:

> *"Across last quarter, ambulation was our most common note-versus-code
> mismatch, and those episodes grouped below cohort"* is management information.
> An administrator can act on it by buying training.
>
> *"This open assessment would pay $340 more if M1860 were a 3"* is a coding
> target attached to a named patient and to the nurse who is about to attest to
> it.

The module cannot produce the second sentence, because it will not accept an
open episode and produces no per-episode uplift figure. A test asserts that no
output contains an uplift value or names an individual record.

It also declines to report a cohort comparison below 10 closed episodes per
side, and states the caveat that two self-selected cohorts differing is not
proof that closing the gaps would move the payment.

## Enforcement

| Guarantee | How it is held |
| --- | --- |
| No financial key reaches a clinician | `toClinicianView()` is an **allow-list** — a field added later cannot leak by being forgotten |
| The engine stays money-free | Test scans its executable source for payment vocabulary and currency |
| The clinician panel stays money-free | Test scans it for dollar figures and for imports of the revenue module |
| Rules cannot become one-way | Symmetry test over every rule and both schemas |
| Revenue never touches an open episode | `isClosedEpisode()` is fail-closed; unrecognised status is OPEN |
| No per-assessment coding target | Test asserts no `uplift` and no record identifiers in any aggregate |

All six were mutation-tested: leaking a revenue field fails 3 tests, dropping a
lower-acuity rule fails the symmetry test, accepting open episodes fails 2, and
putting a dollar figure in the clinician panel fails 1.

## What was deliberately not built

A clinician-facing prompt to change a specific response to a specific value,
where the trigger was payment and the stated reason was clinical. That is the
one thing in this area that cannot be made safe by presentation, and building
the concealment into the product would put the agency's knowledge of it in the
source tree.
