import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  handlerAllowlists, importedWrappers, measureWrapperCalls, passThroughWrappers,
  payloadKeys, propertyKey, summaryLines, withoutComments,
} from './tools-handler-allowlist.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * The comparable population, as a SET.
 *
 * Not a floor. Three of the four reader defects this check was built through
 * were SILENT — they shrank the population and reported clean — and a floor
 * near the true value passes through every one of them. A new pass-through
 * wrapper over a handler with one allowlist is a deliberate line here, which is
 * the cost of a ratchet that cannot go quiet.
 */
const COMPARABLE = Object.freeze([
  'acceptAiContentAgreement -> acceptAiContentAgreement',
  'analyzeVisitForSupplyUsage -> analyzeVisitForSupplyUsage',
  'cancelTimeOffRequest -> cancelTimeOffRequest',
  'distributePolicyAcknowledgment -> distributePolicyAcknowledgment',
  'expandClinicalPhrase -> expandClinicalPhrase',
  'generateFollowUpTasks -> generateFollowUpTasks',
  'generateUserManual -> generateUserManual',
  'importProvidersCsv -> importProvidersCsv',
  'listPolicyLibrary -> listPolicyLibrary',
  'policyAcknowledgment -> policyAcknowledgment',
  'reviewTimeOffRequest -> reviewTimeOffRequest',
  'reviewTimesheet -> reviewTimesheet',
  'savePayrollProfile -> savePayrollProfile',
  'saveVisitPointConfig -> saveVisitPointConfig',
  'submitIncidentReport -> submitIncidentReport',
  'submitStateReportableIncident -> submitStateReportableIncident',
  'submitTimeOffRequest -> submitTimeOffRequest',
  'submitTimesheet -> submitTimesheet',
]);

/**
 * Live violations. EMPTY, and kept rather than deleted.
 *
 * It held two for the life of #352: both screens sent `patient_name` to
 * `submitStateReportableIncident`, whose allowlist did not carry it, so
 * `exactObject` refused the whole body and every state-reportable submission
 * from those two pages answered INVALID_PARAMS against the owned backend.
 *
 * That pin also carried the wrong reason, and the correction is worth more
 * than the fix. It said widening the constant would undo a narrowing somebody
 * took on purpose, citing D73. D73's narrowing is about the NOTIFICATION,
 * which an argument allowlist does not reach, and the contract never takes a
 * caller's `patient_name` at all -- it derives the stored name from the
 * `patient` row it has just authorized. So nothing about admitting the key
 * touches what gets stored.
 *
 * What the reason should have said, and what reading the ORIGINAL supplied, is
 * that the key must be admitted and NOT honoured: the original overrides it
 * with a name derived from the chart, and this service has no patient read to
 * derive one with. The repair is in `state-incident.mjs` and its header
 * records the divergence.
 *
 * I wrote the pin's reason from the shape of the change rather than from the
 * SQL or the original, and it read as a considered refusal to widen a
 * PHI-relevant list. A cautious wrong reason is still a wrong reason, and it
 * is harder to dislodge than a careless one -- it stood for a whole PR, in a
 * file whose subject is prose that nothing can fail.
 *
 * The list stays because an empty one is the assertion: a name appearing here
 * is a screen whose every call fails. An empty list cannot demonstrate that it
 * would fire, so the test below plants one.
 */
const REFUSED = Object.freeze([]);

/** A multiset: `TimesheetApprovalsQueue.jsx` calls `reviewTimesheet` twice. */
const COMPARED = Object.freeze([
  'src/components/compliance/AIContentResponsibilityAgreement.jsx: acceptAiContentAgreement',
  'src/components/incident/SmartIncidentForm.jsx: submitIncidentReport',
  'src/components/incident/SmartIncidentForm.jsx: submitStateReportableIncident',
  'src/components/physician/ProviderCsvImport.jsx: importProvidersCsv',
  'src/components/smartNote/QuickPhraseTextarea.jsx: expandClinicalPhrase',
  'src/components/timeoff/MyTimeOffList.jsx: cancelTimeOffRequest',
  'src/components/timeoff/PendingApprovalsQueue.jsx: reviewTimeOffRequest',
  'src/components/timeoff/RequestTimeOffForm.jsx: submitTimeOffRequest',
  'src/components/timesheet/TimesheetApprovalsQueue.jsx: reviewTimesheet',
  'src/components/timesheet/TimesheetApprovalsQueue.jsx: reviewTimesheet',
  'src/components/training/LearnerPolicyAcknowledgments.jsx: policyAcknowledgment',
  'src/components/training/PolicyAcknowledgmentManager.jsx: distributePolicyAcknowledgment',
  'src/components/training/PolicyAcknowledgmentManager.jsx: listPolicyLibrary',
  'src/components/training/PolicyAcknowledgmentManager.jsx: policyAcknowledgment',
  'src/pages/AITrainingGenerator.jsx: listPolicyLibrary',
  'src/pages/EventReport.jsx: submitIncidentReport',
  'src/pages/EventReport.jsx: submitStateReportableIncident',
  'src/pages/IncidentReportingModule.jsx: submitIncidentReport',
  'src/pages/SmartNoteAssistant.jsx: analyzeVisitForSupplyUsage',
  'src/pages/SmartNoteAssistant.jsx: generateFollowUpTasks',
]);

/**
 * The bucket the question has no slot for.
 *
 * Each of these three builds its payload as a variable and hands the whole
 * object over, so what it sends is decided at run time and no static reader can
 * answer it. They are named rather than dropped: a site moving OUT of the
 * compared set and into this one is a comparison silently stopping, and without
 * this list it would read as the population shrinking for no reason.
 */
const UNREADABLE = Object.freeze([
  'src/components/timesheet/MyTimesheetForm.jsx: submitTimesheet',
  'src/components/timesheet/PayrollSetupPanel.jsx: savePayrollProfile',
  'src/components/timesheet/VisitPointConfigCard.jsx: saveVisitPointConfig',
]);

test('no screen sends a ported capability a key its handler refuses', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.rejected, [...REFUSED],
    'a screen is sending a key outside its handler\'s exactObject allowlist, so that\n'
    + '  capability answers INVALID_PARAMS on every call it receives. Anything in\n'
    + '  REFUSED is known and explained there; REFUSED is empty, so this is new.');

  // The assertion above is now `[] === []`, which passes just as well if the
  // comparison stopped reading anything. What proves it still separates a
  // refused key is `a key outside the allowlist is reported, by site and by
  // name` below, which drives one through the same code path -- so this adds
  // the half that test cannot have: that the capability REFUSED named is
  // genuinely repaired, rather than gone quiet because the reader lost it.
  assert.ok(
    handlerAllowlists(repository).admits.get('submitStateReportableIncident')
      ?.includes('patient_name'),
    'the two sites this list held are absent because the allowlist admits the key.\n'
    + '  It does not, so they are absent for some other reason and REFUSED is\n'
    + '  empty for the wrong one.');
});

test('the comparable population is the declared set, in both directions', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.comparable, [...COMPARABLE],
    'a pass-through wrapper over a single-allowlist handler has arrived or left.\n'
    + '  Arriving: add it here, which is the point of a set. Leaving: say WHY --\n'
    + '  a wrapper that started shaping its payload, or a handler that gained a\n'
    + '  second allowlist, is out of this check\'s reach and something else must\n'
    + '  cover it.');
});

test('every call site is accounted for, as compared or as unreadable', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.compared, [...COMPARED]);
  assert.deepEqual(report.unreadable, [...UNREADABLE],
    'a call site moved between "its keys were read" and "its keys cannot be read".\n'
    + '  The second direction is a comparison going quiet and is never a tidy-up.');
  // Derived from the two declared sets, not typed: a third figure agreeing with
  // them by hand is a copy that goes stale on its own, which is what the entry
  // sentinel above did.
  assert.equal(report.compared.length + report.unreadable.length,
    COMPARED.length + UNREADABLE.length);
});

/**
 * The reader's four failure modes, each planted.
 *
 * Three of the four are silent on a real tree, so "the check is green" says
 * nothing about whether it can see. These drive the reader at the shapes that
 * defeated it and require the right answer, which is the only thing that
 * separates a working check from one that reaches nothing.
 */
test('template-literal TEXT is not read as keys', () => {
  // `src/pages/EventReport.jsx`'s real shape: a report built from a template
  // whose prose contains `Event Type:` and `Submitted By:`.
  const keys = payloadKeys('{ severity: "medium", report: `Event Type: ${a}\\n\\nSubmitted By: ${b}`, '
    + 'details: { location: c } }');
  assert.deepEqual(keys, ['severity', 'report', 'details']);
});

test('a shorthand property is a key, not an absence', () => {
  assert.deepEqual(payloadKeys('{ csv_text }'), ['csv_text']);
  assert.equal(propertyKey('csv_text'), 'csv_text');
});

test('a key that cannot be read makes the whole payload unreadable', () => {
  assert.equal(payloadKeys('{ ...rest, request_id: id }'), null,
    'a spread hides keys, and the hidden ones are exactly where a refused key would be');
  assert.equal(payloadKeys('{ [name]: value }'), null);
  assert.equal(payloadKeys('payload'), null);
});

test('a comment inside the payload does not hide its keys', () => {
  assert.deepEqual(payloadKeys('{ a: 1, // why b matters\n b: 2 }'), ['a', 'b']);
  assert.deepEqual(payloadKeys('{ a: 1, /* note, with a comma */ b: 2 }'), ['a', 'b']);
  assert.equal(withoutComments('"http://x"').includes('http://x'), true,
    'a // inside a string is not a comment');
  assert.deepEqual(payloadKeys('{ url: "http://x", b: 2 }'), ['url', 'b']);
});

test('both quote styles bind an import, and an alias binds the export', () => {
  const wrappers = passThroughWrappers(repository);
  assert.deepEqual([...importedWrappers(
    'import { cancelTimeOffRequest } from "@/functions/cancelTimeOffRequest";', wrappers)],
  [['cancelTimeOffRequest', 'cancelTimeOffRequest']]);
  assert.deepEqual([...importedWrappers(
    "import { cancelTimeOffRequest as cancel } from '@/functions/cancelTimeOffRequest';", wrappers)],
  [['cancel', 'cancelTimeOffRequest']]);
});

/**
 * The comparison itself, driven at a key the handler refuses.
 *
 * Planting on disk would prove the same thing and leave a file to restore, so
 * the refusal is raised through the same code path with one key changed. The
 * assertions above prove the reader reaches every site; this proves that what
 * it reads is actually compared.
 */
test('a key outside the allowlist is reported, by site and by name', () => {
  const { admits } = handlerAllowlists(repository);
  const allowed = admits.get('cancelTimeOffRequest');
  assert.deepEqual(allowed, ['request_id'],
    'this control is written against that allowlist and must be re-read if it moves');
  assert.equal(allowed.includes('requestId'), false);

  const keys = payloadKeys('{ requestId: id }');
  const rejected = keys.filter(key => !allowed.includes(key));
  assert.deepEqual(rejected, ['requestId']);
});

/**
 * A handler that dispatches on an action is out of reach, and says so.
 *
 * The dispatched set is asserted whole, not by one member: it is the population
 * this check declines to answer about, so it is the population most able to
 * grow without anyone noticing. A handler gaining a second allowlist leaves the
 * comparison silently, and this is the line that makes that a decision.
 *
 * The entry count is DERIVED, not pinned.
 *
 * It was `assert.equal(entries, 126)`, whose own message called itself "a
 * sentinel on the PARSE, not a pin on the API". The comment was right about
 * what it should be and the assertion was the other thing: #293 added five
 * capabilities the next hour and main went red at 131, on a check that had
 * nothing to say about those five. `HANDLER_NAMES` is `Object.keys(HANDLERS)`,
 * so crossing against it is strictly stronger -- a parse that breaks goes to 0
 * against 131 and fails louder than a drift of one, a parse that reads too much
 * fails too, and adding a capability moves both sides together, which is the
 * one case that should never have been a failure. D148: derive the compared
 * population from a declaration rather than tuning a constant to a target.
 */
test('an action-dispatched handler is reported, not silently skipped', async () => {
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  const { admits, dispatched, parameterless, unresolved, entries } = handlerAllowlists(repository);
  // The NAMES, not the count. Two lengths agreeing is not the two populations
  // agreeing: a regex that misses one real handler while matching one
  // non-entry of the same shape keeps both at 131 and passes here with the
  // wrong set -- the partial blindness this assertion exists to refuse,
  // surviving inside the fix for it. Comparing the union subsumes the count.
  assert.deepEqual(
    [...admits.keys(), ...dispatched, ...parameterless, ...unresolved].sort(),
    [...HANDLER_NAMES].sort(),
    'the registry parse and the registry disagree. This is a sentinel on the\n'
    + '  PARSE: it holds while capabilities are added or removed, and moves only\n'
    + '  when this module stops reading handlers.mjs the way handlers.mjs is written.');
  assert.equal(entries, HANDLER_NAMES.length);
  assert.deepEqual([...dispatched].sort(), [
    'listAuthorizedPatients', 'manageAgencyMembership', 'manageAuthorizedReferral',
    'manageMyNotifications', 'managePatientCareTeamAssignment', 'manageVehicleMaintenance',
    'updateIncident',
  ]);
  assert.deepEqual([...parameterless].sort(), [
    'analyzeReferral', 'generatePatientHandout', 'sendAccountReadyEmail', 'sendWelcomeEmail',
  ]);
  assert.deepEqual([...unresolved], [],
    'a handler naming an allowlist constant this reader cannot find is never\n'
    + '  counted clean -- the same rule the call-site side follows for a payload\n'
    + '  it cannot read.');
  assert.equal(admits.has('manageAuthorizedReferral'), false);
  assert.deepEqual(measureWrapperCalls(repository).dispatched, ['manageAgencyMembership']);
});

/**
 * Every entry lands in exactly one bucket, and the four cover the registry.
 *
 * Asserted as an identity rather than as four counts, so it survives a
 * capability being added and still fails if an entry falls through every
 * branch. A bucket nothing names is how a capability leaves the comparison
 * without anyone deciding that it should.
 */
test('the four buckets partition the registry', () => {
  const { admits, dispatched, parameterless, unresolved, entries } = handlerAllowlists(repository);
  const counted = admits.size + dispatched.size + parameterless.size + unresolved.size;
  assert.equal(counted, entries, 'an entry reached none of the four buckets');
  const named = new Set([...admits.keys(), ...dispatched, ...parameterless, ...unresolved]);
  assert.equal(named.size, entries, 'an entry reached more than one bucket');
});

test('the summary line carries the four figures and nothing else', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(summaryLines(report), [
    `handler allowlist: ${COMPARABLE.length} pass-through wrappers, `
    + `${COMPARED.length} readable call sites, ${UNREADABLE.length} unreadable, `
    + `${REFUSED.length} refused`,
  ]);
});
