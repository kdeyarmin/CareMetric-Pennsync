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

Open Vehicles, choose the assigned car, and select **Log maintenance or repair**. The required fields are service date, odometer at service, service type, and what was done. The default date is today and the form works on narrow mobile screens.

Optional details: shop/provider, total cost, invoice or receipt reference, and next service due date/mileage. A blank cost means unknown; zero means no charge. The next-service section is collapsed until needed.

Service categories are oil/filter change, tires/rotation, brakes, inspection/emissions, scheduled maintenance, repair, and other service. The server records the employee identity and entry timestamp. Employees cannot submit another author or mark their own entry reviewed.

Employees can read the service history of their currently assigned, nonretired vehicles. Unassigned/shared cars are managed by an administrator. A vehicle marked out of service displays a warning; recording a repair does not itself authorize driving the car.

## Administrator: oversee the fleet

An agency administrator can enter service for any vehicle in that agency, manage vehicle details and assignments, and review its entire maintenance and repair log. The protected platform owner can explicitly select an agency.

Select **Review entry** to mark a record Reviewed or Needs follow-up. A follow-up note is required for the latter. Reviewer identity, time, result, and note are added to the entry's review history. The original service facts remain unchanged. Use an explanatory review note and, when needed, a clearly labeled additional entry to document a correction rather than silently rewriting history.

Vehicle reassignment changes the employee who can access it without moving or deleting the car's prior service history. Retirement preserves the record and history; administrators can include retired vehicles in their list. Retired vehicles cannot receive new entries until restored.

## Reading the complete history

Records are sorted by service date, newest first. Each shows mileage, work performed, cost when known, provider/reference when entered, author, recorded time, and review status/history.

Lists are paginated in groups of 50. **Load older entries** retrieves earlier service records instead of silently cutting off the log. Until all pages are loaded, the cost, mileage and review summary explicitly describes loaded records rather than claiming a complete total. Unknown-cost entries are counted separately. Historical service entries can have mileage below the current starting reading; the highest recorded mileage is calculated without overwriting old readings.

**Refresh records** reloads the current vehicle and service history. If access is rejected during a refresh, cached service facts are no longer displayed as accessible records.

## Current scope

This version includes structured vehicle records, employee/admin entry, administrator review history, assignments, status, cost summaries, historical entry, and optional next-service reference fields. It does **not** yet upload receipt photographs/PDFs, send automated maintenance reminders, schedule appointments, ingest telematics/GPS, or import an existing spreadsheet. The invoice field stores a reference, not a file attachment. A next-service date/mileage is displayed information, not an automated reminder or manufacturer-maintenance recommendation.

## Security and operational details

- `FleetVehicle` and `FleetServiceEntry` deny all direct client create/read/update/delete operations.
- `manageVehicleMaintenance` is the sole app access path. It verifies built-in User identity and active AgencyMembership for every request; self-editable account/agency/manager profile fields are not authorization inputs.
- Employees are limited to assigned vehicles. Fleet administration requires agency_admin membership or the configured protected platform owner.
- The broker stamps author/reviewer identities, scopes records to agency and vehicle, validates inputs, rechecks authority, and does not offer deletion or replacement of original service facts.
- Sequential identical retries reuse a request ID and return the existing row. Concurrent uniqueness is not asserted as a guaranteed datastore property; duplicate or uncertain results require refreshing and reconciliation rather than inventing success.
- Vehicle edits and review updates use conditional update requests and readback. Hosted conditional-update concurrency still needs an authenticated acceptance check; mocked contract tests are not proof of hosted datastore atomicity.
- Review history has an explicit 100-annotation safety limit; exceeding it returns an error and does not discard prior reviews. The owner agency picker has an explicit 200-agency bound. These limits do not cap a vehicle's service history.
- The page's records and dialog forms carry `data-no-record-block` markers. The new module does not change Base44's app-wide recording toggle and does not resolve recording concerns elsewhere in the clinical app.
- Enter vehicle and service information only, not patient names, visits, diagnoses, or clinical details.

## Verification performed on September 16, 2026

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
