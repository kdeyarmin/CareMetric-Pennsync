# Frontend decision docket — the 203 call sites with nowhere to land

`pnpm run check:frontend-destination` finds 203 of the frontend's 445 production
entity call sites reaching an entity the owned store will have **no table for**
(D80). Each one needs a product answer before Stage J can finish, not an edit.
This lays out what is already decided, what is not, and a recommendation for
each — so the owner can answer rather than defer.

Two things are true of all 203 today, measured:

- **The dispositions themselves are decided.** Learning moves to the Support Hub
  (D8); fax, OASIS, calls and the other paused domains are carried paused (D7).
  What is open is narrower: *what the PennSync screens that read these entities
  do after the exit.*
- **In the independent build they now refuse by name** —
  `STAGING_OPERATION_UNAVAILABLE`, with `operation: entities.<Entity>.<op>` —
  where they used to crash with a raw `TypeError`. So an answer can be applied
  and tested one screen at a time.

| # | Domain | Decided | Call sites | Screens | The open question |
| --- | --- | --- | ---: | ---: | --- |
| 1 | Training | `hub` — move to the Support Hub (D8) | 119 | 41 | 81 sites in 35 screens are outside the learning cutover's switch |
| 2 | OASIS | `preserved_paused` (D7) | 45 | 27 | live screens, no table after the exit |
| 3 | Fax and calls | `preserved_paused` (D7) | 30 | 13 | same, plus one realtime subscription |
| 4 | Admin edits of reference data | `broker` — served readonly | 9 | 3 | the family refuses writes |

---

## 1. Training — 119 sites: sequencing, not destination

D8 settled that learning leaves PennSync for the Support Hub, and
[`CENTRAL_LEARNING_CUTOVER.md`](CENTRAL_LEARNING_CUTOVER.md) has its own cutover:
a frontend switch, `VITE_CENTRAL_LEARNING_ENABLED`, that replaces the in-service,
annual-mandatory and SME publishing screens with Hub launchers. Both of its
controls are still unset.

**Measured: the switch reaches files holding 38 of the 119 call sites. The other
81, in 35 screens, are in files that never read it.** That document says so in
words — its switch *"is not a complete prohibition on all education writes"* —
but nothing counted what it leaves behind. They include:

- the course player itself — `pages/TrainingCoursePlayer.jsx`;
- learner views — `MyTrainingDashboard`, `MyAnnualEducationDashboard`,
  `LearningPathProgress`, `useMyTrainingCompletions`;
- annual plans — `AnnualLearningPlanPanel` (11 sites), `LearningPlanManager` (8);
- **compliance evidence** — `CertificateExpirationReport`,
  `StaffEducationComplianceReport`, `EmployeeTranscriptCenter`,
  `AnnualTranscriptCenter`, `ComplianceCenter`, `ComplianceMonitoringDashboard`.

`hub` gets no table in the owned store, so after the exit all 81 have nowhere to
read. The compliance reports are the ones that matter: annual mandatory education
is evidence an agency is inspected on.

| Option | Consequence |
| --- | --- |
| **A. Finish the learning cutover first, and extend its switch to all 35 screens** — Hub launchers, or reads from the Hub | Training leaves PennSync before PennSync leaves Base44. The cutover's own steps 2–3 already require mapping learners, progress, certificates and attestations to Hub identities |
| B. Keep a read-only history view in PennSync | Needs a table for historical training records, which reopens D8 for the read side |
| C. Retire the 35 screens | Only acceptable once the Hub serves the same learner and compliance views |

**Recommendation: A**, and treat it as a **sequencing dependency of the exit**:
the learning cutover completes before Stage J's frontend cutover, or an agency's
training-compliance evidence becomes unreadable. The cutover document already
requires *"historical access before changing the learning entry point"* — this
counts how much of the product that sentence covers.

---

## 2 and 3. OASIS (45) and fax and calls (30): a contradiction to resolve

D7 carries these domains paused: *"keep their current paused state through the
cutover… Disabling a working feature is not preservation… their schemas and
data still migrate; only their execution stays off."*

Three measurements say the screens are **live today**, not paused:

1. D7 pauses **execution** — the backend functions (`sendFax`, `scheduleSms`,
   the OASIS v2 functions). These 75 call sites are **direct entity reads and
   writes**, which never pass through those functions, so the pause does not
   reach them.
2. Their pages are routable with **no route-level gate**: `/OASISCenter` and its
   seven tabs, and `/SendFax` with its logs tab, in `src/routes.jsx`.
3. **71 of the 75 sit in files that consult no release or pause gate at all.**
   (Only `WorkflowExecutionEngine` and `NumberPoolPanel` do.) This is a
   file-level check — a page could still hide a tab — so it is evidence, not
   proof.

That is where D7 contradicts itself at the exit. `preserved_paused` entities get
**no table** in the owned store, so these working screens lose their data source,
and *"data still migrates"* can only mean the export archive, which nothing
reads. Either the screens stop — which D7's own rationale calls *not
preservation* — or the entities need somewhere readable.

| Option | Consequence |
| --- | --- |
| **A. Carry these entities as tables; keep their functions paused** | The screens keep working exactly as today; execution stays off. Changes the entity disposition while leaving D7's function pauses alone |
| B. Gate the screens behind each domain's own pause, now, on the Base44 path too | Production matches "execution off" before the exit removes the tables — but it is disabling a working feature, which D7 rules out |
| C. Accept that the screens stop at the exit | Must be recorded as a decision that overrides D7's rationale |

**Recommendation: A for OASIS; decide fax and calls separately.** OASIS uploads,
audits and action items are clinical and billing documentation with a retention
obligation; an agency reviewing a prior assessment cannot be told the history is
in an archive nothing reads. Fax contacts, templates and call logs are lower
stakes, but they are live data somebody maintains. One call site —
`RealtimeFaxStatusTracker`'s `FaxLog.subscribe` — goes with the fax answer; the
owned store has no realtime seam at all, so under any option it becomes a poll
or disappears.

---

## 4. Admin edits of three reference tables — 9 sites

`Announcement`, `FacilityDocumentationRule` and `RegulatoryUpdate` are the only
three entities the generic broker family serves, and it serves them **readonly**
(D2's ceiling, re-checked per schema by D22). The frontend creates, updates and
deletes them from exactly three admin screens — `AnnouncementManager`,
`FacilityDocumentationRulesManager` and `RegulatoryMonitor` — so those writes
have nowhere to go.

| Option | Consequence |
| --- | --- |
| **A. A small write contract per entity, gated to `agency_admin` (D40)** | Mechanical, and the same shape as the dozens of contracts already written. `RegulatoryUpdate` already has a writer — `syncCMSRegulations`' contract — so an admin edit path sits beside it |
| B. Make the three writable in the broker family | Refused by construction: the family is generic, and a write is an authority decision it cannot evaluate |
| C. Retire in-app editing | The content then changes only by migration |

**Recommendation: A.** It is the one part of this docket that needs no product
judgment, only work, and it can start as soon as it is asked for.

---

## What an answer unblocks

| Answer | Call sites it settles |
| --- | ---: |
| Training: extend the learning cutover's switch to the 35 screens | 81 |
| OASIS: carry the entities as tables | 45 |
| Fax and calls: any of the three | 30 |
| Training: the 38 already inside the switch, once it is turned on | 38 |
| Admin reference writes: build the three contracts | 9 |
| **Total** | **203** |
