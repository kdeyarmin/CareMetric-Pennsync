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

test('patch cannot write status or the review stamps', () => {
  const start = SRC.indexOf('const PATCHABLE_FIELDS');
  const list = SRC.slice(start, SRC.indexOf(']', start));
  for (const forbidden of ['status', 'reviewed_by', 'reviewed_at', 'closed_by', 'closed_at']) {
    assert.doesNotMatch(
      list,
      new RegExp(`'${forbidden}'`),
      `${forbidden} must not be patchable, or the transition graph can be `
        + 'sidestepped by relabelling a status write as a field update',
    );
  }
});
