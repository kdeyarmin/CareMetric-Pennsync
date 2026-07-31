import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { canTransitionIncidentStatus, incidentNeedsCorrectiveAction }
  from '../../src/components/incident/incidentLifecycle.js';
import { RECORD_LIFECYCLE_TRANSITIONS } from '../../src/lib/recordLifecycle.js';

/**
 * updateIncident is a self-contained Deno entry, so it inlines the incident
 * status map and the lifecycle transition table rather than importing them.
 * Two copies of a compliance rule drift silently: the UI would keep refusing a
 * transition the server had started allowing, or worse, the reverse.
 *
 * These tests re-evaluate the inlined tables against the shared modules.
 */

const SRC = readFileSync(
  join(process.cwd(), 'base44/functions/updateIncident/entry.ts'),
  'utf8',
);

/** Pull an object literal out of the entry by name. */
function inlinedTable(name) {
  const start = SRC.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} must exist in updateIncident/entry.ts`);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  // The literals are plain data (no expressions), so Function-eval is safe here.
  return Function(`return ${SRC.slice(open, end + 1)}`)();
}

test('the inlined lifecycle transition table matches recordLifecycle.js', () => {
  const inlined = inlinedTable('LIFECYCLE_TRANSITIONS');
  const shared = Object.fromEntries(
    Object.entries(RECORD_LIFECYCLE_TRANSITIONS).map(([k, v]) => [k, [...v]]),
  );
  assert.deepEqual(inlined, shared);
});

test('the inlined incident status map matches incidentLifecycle.js', () => {
  const inlined = inlinedTable('INCIDENT_STATUS_TO_LIFECYCLE');
  assert.deepEqual(inlined, {
    reported: 'submitted',
    under_review: 'in_review',
    corrective_action: 'correction_requested',
    resolved: 'final',
    archived: 'archived',
  });
});

test('server and client agree on every incident transition', () => {
  const INCIDENT_STATUSES = ['reported', 'under_review', 'corrective_action', 'resolved', 'archived'];
  const statusMap = inlinedTable('INCIDENT_STATUS_TO_LIFECYCLE');
  const transitions = inlinedTable('LIFECYCLE_TRANSITIONS');

  // Same predicate the entry implements, evaluated against the inlined tables.
  const serverAllows = (from, to) => {
    if (from === 'corrective_action' && to === 'resolved') return true;
    const f = statusMap[from || 'reported'];
    const t = statusMap[to];
    if (!f || !t) return false;
    if (f === t) return true;
    return (transitions[f] || []).includes(t);
  };

  for (const from of INCIDENT_STATUSES) {
    for (const to of INCIDENT_STATUSES) {
      assert.equal(
        serverAllows(from, to),
        canTransitionIncidentStatus(from, to),
        `disagreement on ${from} -> ${to}: the UI and the server must not `
          + 'diverge on which incident transitions are legal',
      );
    }
  }
});

test('the corrective-action predicate matches the client helper', () => {
  const cases = [
    { severity: 'high' },
    { severity: 'critical' },
    { severity: 'HIGH' },
    { severity: 'low' },
    { severity: 'medium' },
    { state_reportable: true },
    { state_reportable: false, severity: 'low' },
    {},
  ];
  // Same expression as the entry's incidentNeedsCorrectiveAction.
  const serverNeeds = (i = {}) => i.state_reportable === true
    || ['high', 'critical'].includes(String(i.severity || '').toLowerCase());
  for (const c of cases) {
    assert.equal(serverNeeds(c), incidentNeedsCorrectiveAction(c), JSON.stringify(c));
  }
  assert.match(SRC, /state_reportable === true/, 'entry must gate on state_reportable');
  assert.match(SRC, /\['high', 'critical'\]/, 'entry must gate on high/critical severity');
});

test('a no-op transition is refused before the graph check', () => {
  // Deliberate divergence from canTransitionIncidentStatus, which treats
  // from === to as legal. The graph describes which moves are valid; this
  // handler additionally refuses non-moves, because it re-stamps
  // closed_by/closed_at from the current caller and appends a UserActivity row
  // -- so replaying 'resolved' -> 'resolved' would reattribute the closure.
  // The parity tests above still hold: this guard is policy layered on top of
  // the graph, not a different graph.
  const body = SRC.slice(SRC.indexOf('async function transitionIncident'));
  const noOpGuard = body.indexOf('fromStatus === toStatus');
  const graphCheck = body.indexOf('!canTransitionIncidentStatus(');
  assert.notEqual(noOpGuard, -1, 'transitionIncident must refuse from === to');
  assert.ok(
    noOpGuard < graphCheck,
    'the no-op guard must run before the graph check, which would accept from === to',
  );

  const stampBlock = body.slice(body.indexOf("if (toStatus === 'resolved')"));
  assert.match(
    stampBlock,
    /payload\.closed_by = currentUser\.email/,
    'the guard exists because this stamp is unconditional -- if that changes, '
      + 'revisit whether the no-op rejection is still the right rule',
  );
});

test('the CAP trigger fields are admin-only', () => {
  // severity and state_reportable are the inputs to
  // incidentNeedsCorrectiveAction. patchIncident admits the incident's creator,
  // so if these were owner-writable a reporter could downgrade their own
  // high-severity incident and clear the state-reportable flag, and the resolve
  // gate would then read the softened values and let it close with no
  // corrective action -- defeating the whole control.
  const adminOnly = SRC.slice(
    SRC.indexOf('const ADMIN_ONLY_PATCHABLE_FIELDS'),
    SRC.indexOf('const OWNER_PATCHABLE_FIELDS'),
  );
  for (const field of ['severity', 'state_reportable']) {
    assert.match(adminOnly, new RegExp(`'${field}'`), `${field} must be admin-only`);
  }

  const ownerFields = SRC.slice(
    SRC.indexOf('const OWNER_PATCHABLE_FIELDS'),
    SRC.indexOf('const PATCHABLE_FIELDS'),
  );
  for (const field of ['severity', 'state_reportable']) {
    assert.doesNotMatch(ownerFields, new RegExp(`'${field}'`), `${field} must not be owner-writable`);
  }

  assert.match(
    SRC,
    /if \(!isAdmin\) \{[\s\S]*ADMIN_ONLY_PATCHABLE_FIELDS\.includes/,
    'patchIncident must actually enforce the admin-only list, not just declare it',
  );
});

test('patch cannot write status or the review stamps', () => {
  // Slice the two declared lists, not the `PATCHABLE_FIELDS` spread that joins
  // them -- the spread contains no field names, so checking it would pass no
  // matter what the lists held.
  const start = SRC.indexOf('const ADMIN_ONLY_PATCHABLE_FIELDS');
  const end = SRC.indexOf('const PATCHABLE_FIELDS');
  const list = SRC.slice(start, end);
  assert.ok(list.includes("'severity'") && list.includes("'report'"),
    'sanity: the slice must actually contain the field lists');
  for (const forbidden of ['status', 'reviewed_by', 'reviewed_at', 'closed_by', 'closed_at']) {
    assert.doesNotMatch(
      list,
      new RegExp(`'${forbidden}'`),
      `${forbidden} must not be patchable, or the transition graph can be `
        + 'sidestepped by relabelling a status write as a field update',
    );
  }
});

test('submitIncidentReport persists the offline idempotency key', () => {
  // The offline drain dedupes retries by filtering Incident on
  // client_request_id. Routing creation through this function without carrying
  // the key means the filter never matches and an interrupted drain writes a
  // second copy of the same safety event.
  const submit = readFileSync(
    join(process.cwd(), 'base44/functions/submitIncidentReport/entry.ts'),
    'utf8',
  );
  assert.match(submit, /client_request_id: clientRequestId/, 'the key must reach the stored row');
  assert.match(
    submit,
    /filter\(\s*\{ client_request_id: clientRequestId \}/,
    'and the function should short-circuit on an existing row for that key',
  );
});

test('patient-merge reassignment for Incident goes through the function', () => {
  // Incident writes are service-role-only, so a direct entity update here would
  // throw, be swallowed by the merge's best-effort catch, and strand incidents
  // on the archived duplicate chart.
  const merge = readFileSync(
    join(process.cwd(), 'src/components/patient/mergePatients.js'),
    'utf8',
  );
  assert.match(merge, /FUNCTION_BACKED_REASSIGN/, 'merge must route service-role entities via functions');
  assert.match(merge, /Incident: \(recordId, patientId\)/, 'Incident must be in that map');
  assert.doesNotMatch(
    merge,
    /await api\.update\(record\.id, \{ patient_id: primaryId \}\)/,
    'the raw per-record update must go through reassignRecordToPatient',
  );
});
