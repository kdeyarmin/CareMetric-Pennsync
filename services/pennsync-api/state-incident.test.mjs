import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportText, submitStateIncident } from './state-incident.mjs';
import { HANDLERS } from './handlers.mjs';

/**
 * The state-reportable handler's own behaviour.
 *
 * The contract decides what is stored and its suite proves that. What is
 * proved here is the report TEXT — D67's split, because it is arithmetic over
 * what the caller typed — and the two pauses, which must be REPORTED rather
 * than silently skipped.
 */
const PAYLOAD = Object.freeze({
  patient_id: 'patient-a1', event_type: 'Injury of Unknown Origin', event_type_id: 'IE',
  event_date: '2026-06-15', event_time: '14:30', location_of_event: 'Bathroom',
  medications: 'Warfarin 5mg daily', diagnosis: 'CHF',
  factual_description: 'Found on floor.', followup_action: 'MD notified.',
  submitted_by_name: 'Somebody Else', submitted_by_title: 'RN',
});
const harness = (overrides = {}) => {
  const asked = [];
  return {
    asked,
    params: { ...PAYLOAD, ...overrides.params },
    contract: async (name, args) => {
      asked.push({ name, args });
      if (overrides.contractThrows) throw overrides.contractThrows;
      return overrides.answer ?? { success: true, notified: 2,
        incident: { id: 'incident-1', severity: 'high', state_reportable: true } };
    },
  };
};

test('both paused halves are reported on every path', async () => {
  const fresh = await submitStateIncident(harness());
  assert.equal(fresh.document_retention_paused, true);
  assert.equal(fresh.email_paused, true);
  assert.equal(fresh.notified, 2);
  assert.equal(fresh.deduplicated, false);
  // A replay reports them too, so a caller cannot read it as a send that
  // happened the first time.
  const replay = await submitStateIncident(harness({
    answer: { success: true, deduplicated: true, incident: { id: 'incident-1' } } }));
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.document_retention_paused, true);
  assert.equal(replay.email_paused, true);
  assert.equal(replay.notified, 0);
});

/**
 * `patient_name` is admitted and not honoured, and both halves matter.
 *
 * It was absent from `STATE_INCIDENT_FIELDS` while `submitted_by_name`, the
 * other field the report text reads, was present -- so `exactObject` refused
 * the whole body and both screens that send it failed every submission. The
 * parity test below already passed `patient_name` straight to
 * `buildReportText`, which is why nothing caught it: the FUNCTION was
 * reachable and the ENDPOINT was not.
 *
 * So this drives the REGISTRY ENTRY rather than `submitStateIncident`. A first
 * draft called the module function directly and asserted the report text, and
 * passed with the key still refused -- `exactObject` lives in the handler and
 * nothing below it has an allowlist. A test that cannot fail for the defect it
 * names reads exactly like one that works.
 *
 * The second half is the divergence, asserted so it cannot drift into the
 * original's shape by accident: the original overrides the caller's
 * `patient_name` with one it derived from the chart, and this service has no
 * patient read to derive one with, so the line carries the id. A change that
 * spread the caller's value through would pass the first assertion and fail
 * this one.
 */
test('the endpoint admits patient_name and never prints the claimed one', async () => {
  const asked = [];
  const contract = async (name, args) => {
    asked.push({ name, args });
    return { success: true, notified: 0, incident: { id: 'incident-1' } };
  };
  await HANDLERS.submitStateReportableIncident.handle({
    params: { ...PAYLOAD, patient_name: 'Ada Lovelace' }, contract });
  assert.equal(asked.length, 1, 'the body was refused before it reached the contract');
  const { incident } = asked[0].args;
  assert.ok(incident.report_text.includes('Patient: patient-a1'),
    'the report names the chart, not what the form claimed');
  assert.equal(incident.report_text.includes('Ada Lovelace'), false);
  assert.equal('patient_name' in incident, false,
    'the contract derives the stored name itself; a caller may not supply it');

  // And the gate still refuses a key nobody declared. `exactObject` throws
  // BEFORE the handler returns a promise, so this is `throws` and not
  // `rejects` -- the first draft used `rejects` and reported the correct
  // refusal as a test failure.
  assert.throws(
    () => HANDLERS.submitStateReportableIncident.handle({
      params: { ...PAYLOAD, severity: 'low' }, contract }),
    error => error.code === 'INVALID_PARAMS',
    'widening the list must not have widened it to everything');
  assert.equal(asked.length, 1, 'a refused body reaches no contract');
});

test('the report text is the original\'s, and a caller-supplied one wins', async () => {
  const text = buildReportText({ ...PAYLOAD, patient_name: 'Ada Lovelace' }, '6/15/2026');
  for (const line of ['STATE REPORTABLE EVENT REPORT', '==============================',
    'Patient: Ada Lovelace', 'Date of Event: 2026-06-15', 'Time of Event: 14:30',
    'Event Type: Injury of Unknown Origin', 'Location of Event: Bathroom',
    'Medications (Name & Frequency):', 'Warfarin 5mg daily', 'Diagnosis of Patient:',
    'CHF', 'Factual Description:', 'Found on floor.',
    'Description of Follow-up Action:', 'MD notified.',
    'Submitted By: Somebody Else (RN)', 'Submitted On: 6/15/2026']) {
    assert.ok(text.includes(line), `the report lost: ${line}`);
  }
  // Every fallback the original has.
  const bare = buildReportText({ patient_id: 'patient-a1' }, 'now');
  assert.match(bare, /Patient: patient-a1/);
  assert.match(bare, /Not provided/);
  assert.match(bare, /Submitted By: Unknown$/m);
  assert.equal(bare.startsWith('STATE REPORTABLE'), true, 'the leading newline is trimmed');
  assert.equal(bare.endsWith('Submitted On: now'), true, 'and the trailing one');

  // The handler builds one when none is sent and forwards the caller's when
  // one is: a clinician who edited the narrative is submitting what they wrote.
  const built = harness();
  await submitStateIncident(built);
  assert.match(built.asked[0].args.incident.report_text, /^STATE REPORTABLE EVENT REPORT/);
  const supplied = harness({ params: { report_text: 'My own words.' } });
  await submitStateIncident(supplied);
  assert.equal(supplied.asked[0].args.incident.report_text, 'My own words.');
  // A blank one is not a narrative, so the template answers.
  const blank = harness({ params: { report_text: '   ' } });
  await submitStateIncident(blank);
  assert.match(blank.asked[0].args.incident.report_text, /^STATE REPORTABLE/);
});

test('the four required inputs are refused before anything is written', async () => {
  for (const [params, code] of [
    [{ patient_id: '' }, 'STATE_INCIDENT_PATIENT_REQUIRED'],
    [{ patient_id: '   ' }, 'STATE_INCIDENT_PATIENT_REQUIRED'],
    [{ patient_id: 42 }, 'STATE_INCIDENT_PATIENT_REQUIRED'],
    [{ event_type: '' }, 'STATE_INCIDENT_EVENT_TYPE_REQUIRED'],
    [{ event_type: null }, 'STATE_INCIDENT_EVENT_TYPE_REQUIRED'],
    [{ event_date: '' }, 'STATE_INCIDENT_EVENT_DATE_REQUIRED'],
    [{ event_date: undefined }, 'STATE_INCIDENT_EVENT_DATE_REQUIRED'],
    [{ photo_urls: 'one.png' }, 'STATE_INCIDENT_PHOTOS_INVALID'],
    [{ photo_urls: {} }, 'STATE_INCIDENT_PHOTOS_INVALID'],
  ]) {
    const h = harness({ params });
    await assert.rejects(() => submitStateIncident(h),
      error => error?.code === code, JSON.stringify(params));
    assert.equal(h.asked.length, 0, 'nothing was written');
  }
});

test('the caller\'s claimed name never reaches the contract', async () => {
  const h = harness();
  await submitStateIncident(h);
  const sent = h.asked[0].args.incident;
  // It IS in the report narrative, which is the clinician's own account, and
  // it is NOT a field the record stores as the reporter: the contract stamps
  // the verified address.
  assert.match(sent.report_text, /Submitted By: Somebody Else \(RN\)/);
  assert.equal(Object.hasOwn(sent, 'submitted_by_name'), false);
  assert.equal(sent.submitted_by_title, 'RN');
  // And nothing a caller sends decides severity, the flag, or the status.
  for (const reserved of ['severity', 'state_reportable', 'status', 'created_by',
    'incident_type', 'incident_name']) {
    assert.equal(Object.hasOwn(sent, reserved), false, `${reserved} is the contract's`);
  }
  assert.equal(sent.patient_id, 'patient-a1');
  assert.equal(sent.event_type_id, 'IE');
  assert.deepEqual(sent.photo_urls, []);
  // An absent request id is absent rather than null: the contract reads an
  // empty string as "no dedupe" and a key of `null` would be a third case.
  assert.equal(Object.hasOwn(sent, 'client_request_id'), false);
  const keyed = harness({ params: { client_request_id: 'req-1' } });
  await submitStateIncident(keyed);
  assert.equal(keyed.asked[0].args.incident.client_request_id, 'req-1');
});

test('a contract refusal crosses back as itself', async () => {
  const h = harness({ contractThrows: Object.assign(new Error('nope'),
    { code: 'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE' }) });
  await assert.rejects(() => submitStateIncident(h),
    error => error?.code === 'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE');
});

test('a submission with no narrative is refused, as the original refuses it', async () => {
  /*
   * The Base44 original guards with
   *     !(payload.factual_description || payload.report_text)
   * and this port had no equivalent, so a request carrying only patient, type
   * and date produced a template whose factual-description section was blank
   * and stored it as a state-reportable incident. That is a WIDENING of a
   * compliance submission contract, on the most serious incident class the
   * product has.
   */
  const bare = { patient_id: 'patient-a1', event_type: 'Injury of Unknown Origin',
    event_type_id: 'IE', event_date: '2026-06-15' };
  const { asked, ...rest } = harness();
  await assert.rejects(
    () => submitStateIncident({ ...rest, params: bare }),
    error => error.status === 400 && error.code === 'STATE_INCIDENT_NARRATIVE_REQUIRED');
  // Refused BEFORE the contract, so nothing was stored.
  assert.deepEqual(asked, []);

  // Either field satisfies it, exactly as the original's `||` does.
  for (const patch of [{ factual_description: 'Found on floor.' },
    { report_text: 'A narrative the clinician wrote themselves.' }]) {
    const run = harness();
    const answer = await submitStateIncident({ ...run, params: { ...bare, ...patch } });
    assert.equal(answer.success, true);
  }
  // Whitespace is not a narrative.
  const blank = harness();
  await assert.rejects(
    () => submitStateIncident({ ...blank, params: { ...bare, factual_description: '   ' } }),
    error => error.code === 'STATE_INCIDENT_NARRATIVE_REQUIRED');
});

test('the answer carries the keys the live callers actually read', async () => {
  /*
   * `EventReport.jsx` branches on `admin_count`, then `emails_sent`, then
   * `pdf_retained`. This port returned none of them, so `(data.admin_count ??
   * 0) === 0` was always true and every submission took the "NO
   * administrators were found" branch even when notifications were minted.
   */
  const answer = await submitStateIncident(harness());
  assert.equal(answer.admin_count, 2, 'the number actually notified in-app');
  assert.equal(answer.admin_count, answer.notified);
  // Truthful rather than flattering: both halves are paused, so these are the
  // values that make EventReport.jsx tell the reporter to keep their own copy.
  assert.equal(answer.emails_sent, 0);
  assert.equal(answer.pdf_retained, false);
  assert.equal(answer.delivery_paused, true);
  // And a submission that reached nobody says so rather than claiming one.
  const none = await submitStateIncident(harness({
    answer: { success: true, notified: 0, incident: { id: 'incident-2' } },
  }));
  assert.equal(none.admin_count, 0);
});
