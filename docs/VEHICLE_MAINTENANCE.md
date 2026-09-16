# Company Vehicle Maintenance

## Location

PennSync → **Tools → Vehicles**. The page title is **Vehicle Maintenance** and its route is `/VehicleMaintenance`. It is also searchable in the app's command palette using car, fleet, maintenance, repair, inspection, or odometer.

## First-time setup for an administrator

1. Open Vehicles. The platform owner chooses the agency; agency staff use the agency already selected in PennSync.
2. Select **Add vehicle**. Enter a recognizable unit name, model year, make, model, and starting odometer in miles. License plate, VIN, and notes are optional.
3. Select the employee from the active agency roster, or leave the vehicle unassigned for a shared/admin-managed car.
4. Save. Repeat for the remaining company vehicles.

No vehicles, employee assignments, mileage, invoices, or costs were invented or pre-populated. Existing users need an active, server-owned agency membership; this feature does not create memberships or elevate staff roles.

## Employee: log completed work

Open Vehicles, choose the assigned car, and select **Log maintenance or repair**. The required fields are service date, odometer at service, service type, and what was done. The default date is today in the explicitly labeled Eastern Time business calendar, shared by the form and server. The form works on narrow mobile screens.

Optional details: shop/provider, total cost, invoice or receipt reference, and next service due date/mileage. A blank cost means unknown; zero means no charge. The next-service section is collapsed until needed.

Service categories are oil/filter change, tires/rotation, brakes, inspection/emissions, scheduled maintenance, repair, and other service. The server records the employee identity and entry timestamp. Employees cannot submit another author or mark their own entry reviewed.

Employees can read the service history of their currently assigned, nonretired vehicles. Unassigned/shared cars are managed by an administrator. A vehicle marked out of service displays a warning; recording a repair does not itself authorize driving the car.

## Administrator: oversee the fleet

An agency administrator can enter service for any vehicle in that agency, manage vehicle details and assignments, and review its entire maintenance and repair log. The protected platform owner can explicitly select an agency.

Select **Review entry** to mark a record Reviewed or Needs follow-up. A follow-up note is required for the latter. Reviewer identity, time, result, and note are added to the entry's review history. The original service facts remain unchanged. Use an explanatory review note and, when needed, a clearly labeled additional entry to document a correction rather than silently rewriting history.

Vehicle reassignment changes the employee who can access it without moving or deleting the car's prior service history. Retirement preserves the record and history; administrators can include retired vehicles in their list. Retired vehicles cannot receive new entries until restored.

## Reading the complete history

Records are sorted by service date, newest first. Each shows mileage, work performed, cost when known, provider/reference when entered, author, recorded time, and review status/history.

Lists are paginated in groups of 50. Service history uses a scoped date-and-record-ID cursor with stable tie ordering, not numeric offsets. Existing entries remain traversable during new insertions; new entries above the consumed cursor appear after Refresh (this is not a frozen snapshot). **Load older entries** retrieves earlier service records instead of silently cutting off the log. Until all pages are loaded, the cost, mileage and review summary explicitly describes loaded records rather than claiming a complete total. Unknown-cost entries are counted separately. Historical service entries can have mileage below the current starting reading; the highest recorded mileage is calculated without overwriting old readings.

**Refresh records** reloads the current vehicle and service history. If access is rejected during a refresh, cached service facts are no longer displayed as accessible records.

## Current scope

This version includes structured vehicle records, employee/admin entry, administrator review history, assignments, status, cost summaries, historical entry, and optional next-service reference fields. It does **not** yet upload receipt photographs/PDFs, send automated maintenance reminders, schedule appointments, ingest telematics/GPS, or import an existing spreadsheet. The invoice field stores a reference, not a file attachment. A next-service date/mileage is displayed information, not an automated reminder or manufacturer-maintenance recommendation.

## Security and operational details

- `FleetVehicle`, `FleetServiceEntry`, and `FleetServiceReview` deny all direct client create/read/update/delete operations.
- `manageVehicleMaintenance` is the sole app access path. It verifies built-in User identity and active AgencyMembership for every request; self-editable account/agency/manager profile fields are not authorization inputs.
- Employees are limited to assigned vehicles. Fleet administration requires agency_admin membership or the configured protected platform owner.
- The broker stamps author/reviewer identities, scopes records to agency and vehicle, validates inputs, rechecks authority, and does not offer deletion or replacement of original service facts.
- Vehicle/service/review creation uses permanent ordered native-append reservations on the existing parent. Retrying the same request reconciles an existing record without issuing another child create. An uncertain reservation is not expired or taken over; contact an administrator for reconciliation. Hosted append/consistency acceptance remains separate from synthetic tests.
- Vehicle-profile edits use a version-filter/readback check with an explicitly complete acknowledgement; this remains best-effort, not proven hosted CAS. New review annotations are immutable FleetServiceReview rows. Legacy arrays remain unchanged and combine with review rows only in the response; malformed history is rejected rather than discarded.
- New review creation refuses an observed history of 100 or more annotations, without truncating any already-created concurrent annotations. Reservation arrays and bounded review reads have explicit 5,000-item reconciliation limits. The owner agency picker has an explicit 200-agency bound. None of these paths silently deletes vehicle service history.
- The page's records and dialog forms carry `data-no-record-block` markers. The new module does not change Base44's app-wide recording toggle and does not resolve recording concerns elsewhere in the clinical app.
- Enter vehicle and service information only, not patient names, visits, diagnoses, or clinical details.

## Initial feature verification performed on September 16, 2026

- 23 backend contract tests passed using the actual transpiled handler with a synthetic SDK, including scope, role/identity forgery, assigned-only access, review rules, idempotent sequential retry, version conflicts, and history pagination.
- 31 vehicle utility/UI tests passed, including employee entry, administrator assignment and review, failed-save form retention, paging, stale-access handling, input validation, and accessibility checks.
- 49 existing schema, reference, write, query-key, route, and test-registry integration checks passed.
- Source lint, high-signal typecheck, 282 backend syntax/target checks, and 225 shared-helper consistency checks passed. The broader informational type baseline is not claimed clean.
- A clean Node 24.18.0 / pnpm 11.9.0 dependency installation passed. The managed Node 20 mixed install could not start the jsdom test worker; the clean pinned environment ran the tests without application-dependency changes.
- The hosted-form build command `npm run build -- --mode production` passed; the prepared bundle inspected 501 JavaScript files without diagnostic findings.
- Ten existing Chromium public-page and isolated-preview regression tests passed with retries disabled. These do not substitute for a signed-in fleet write/read/review acceptance test.
- A real anonymous POST to the hosted fleet `context` action returned HTTP 401 and the expected sign-in-required error at `2026-09-16T04:22:12.703Z`.
- Live schema readback confirmed both entities; the production fleet tables were empty when checked. No synthetic production records were inserted.

Source tests, schema registration, hosted anonymous rejection, frontend publication, and authenticated employee/admin acceptance are separate milestones. Publication and acceptance results must be recorded explicitly rather than inferred from a passing build.

## Review follow-up

PR #182 contains the follow-up to retrospective PR #181. See `docs/audits/VEHICLE_REVIEW_181_2026-09-16.md` for full review mapping, focused test results, and hosted acceptance limits. Vehicle/history failures conceal and block pending forms while retaining their in-memory draft and retry ID; restoring verified read access reveals the same form. Save callbacks keep the originating form mounted until post-save refresh completes. Context/tenant failure still unmounts and removes caches. Draft recovery is not persisted across logout or reload.
