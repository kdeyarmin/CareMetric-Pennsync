import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_EXPORT_MODEL, CHART_EXPORT_SCHEMA, buildChartPrompt, exportPatientChart,
} from './chart-export.mjs';

/**
 * The chart export handler's own behaviour.
 *
 * `pennsyncApiOriginalParity` proves the prompt is the original's, line for
 * line. What is proved here is the order — authorize, ask, record — and the
 * two things that are decided outside the contract: the flags, which are
 * booleans because they reach a privileged audit record, and the trail entry,
 * which carries three fields and no chart.
 */
const PATIENT = Object.freeze({
  id: 'patient-a1', first_name: 'Ada', middle_name: 'Q', last_name: 'Lovelace',
  date_of_birth: '1815-12-10', medical_record_number: 'MRN-1', address: '1 Main St',
  phone: '555-0100', email: 'ada@example.invalid', physician_name: 'Dr Who',
  physician_phone: '555-0199', physician_email: 'dr@example.invalid',
  emergency_contact_name: 'Next Kin', emergency_contact_phone: '555-0111',
  emergency_contact_relationship: 'sibling', primary_diagnosis: 'CHF',
  secondary_diagnoses: ['COPD', 'Diabetes'], allergies: 'Penicillin',
  past_medical_history: ['Stroke 2019', 'MI 2021'],
  baseline_vitals: { heart_rate: 72, blood_pressure_systolic: 120 },
  functional_status: { ambulation: 'walker' }, social_history: { primary_language: 'Welsh' },
  advance_directives: { has_living_will: true },
});
const harness = (overrides = {}) => {
  const asked = [];
  const audits = [];
  return {
    asked,
    audits,
    params: { patient_id: 'patient-a1', ...overrides.params },
    contract: async (name, args) => {
      asked.push({ name, args });
      if (overrides.contractThrows) throw overrides.contractThrows;
      return overrides.context ?? { patient: PATIENT, visits: [], incidents: [] };
    },
    integration: async (operation, payload) => {
      asked.push({ operation, payload });
      return overrides.answer === undefined
        ? JSON.stringify({ document_content: 'CHART', page_count: 3 })
        : overrides.answer;
    },
    audit: async (action, options) => {
      audits.push({ action, options });
      if (overrides.auditThrows) throw new Error('trail unavailable');
      return { audit_event_id: 'evt-1' };
    },
  };
};

test('the chart is authorized before the model call is paid for', async () => {
  const h = harness({ contractThrows: Object.assign(new Error('nope'),
    { code: 'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE' }) });
  await assert.rejects(() => exportPatientChart(h),
    error => error?.code === 'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE');
  assert.equal(h.asked.filter(call => call.operation).length, 0, 'nothing was asked of a model');
  assert.equal(h.audits.length, 0, 'and nothing was recorded');
});

test('the order is read contract, model, trail', async () => {
  const h = harness();
  const result = await exportPatientChart(h);
  assert.deepEqual(h.asked.map(call => call.name ?? call.operation),
    ['readChartExportContext', 'InvokeLLM']);
  assert.deepEqual(h.asked[0].args,
    { patient_id: 'patient-a1', include_visits: true, include_incidents: true });
  assert.equal(h.asked[1].payload.model, CHART_EXPORT_MODEL);
  assert.deepEqual(h.asked[1].payload.response_json_schema, CHART_EXPORT_SCHEMA);
  assert.equal(result.success, true);
  assert.equal(result.document, 'CHART');
  assert.equal(result.pages, 3);
  assert.equal(result.patient_name, 'Ada Lovelace');
  assert.equal(result.mrn, 'MRN-1');
  assert.match(result.export_date, /^\d{4}-\d{2}-\d{2}T/);
  // The carried `user` table has no name column (D38), so the original's
  // `user.full_name` has no source and is null rather than invented.
  assert.equal(result.exported_by, null);
  assert.equal(result.audit_recorded, true);
});

test('the trail entry carries three fields and no chart', async () => {
  const h = harness();
  await exportPatientChart(h);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, 'export_patient_chart_pdf');
  assert.deepEqual(h.audits[0].options, { detail: { patient_id: 'patient-a1',
    includes_visits: true, includes_incidents: true } });
  // D25's trail is a broad operational surface, not a second copy of a chart.
  const recorded = JSON.stringify(h.audits[0]);
  for (const leak of ['Ada', 'Lovelace', '1815-12-10', 'CHF', 'Penicillin', '1 Main St',
    '555-0100', 'CHART']) {
    assert.equal(recorded.includes(leak), false, `the trail must not carry ${leak}`);
  }
  // The original's `ip_address: 'server-side'` is dropped: a constant standing
  // in for an address is worse than an absent one (D36).
  assert.equal(recorded.includes('ip_address'), false);
  assert.equal(recorded.includes('server-side'), false);
});

test('the two flags are booleans only, because they reach a compliance record', async () => {
  for (const flags of [{ include_visits: 'yes' }, { include_incidents: 1 },
    { include_visits: null }, { include_incidents: { all: true } },
    { include_visits: [] }]) {
    const h = harness({ params: flags });
    await assert.rejects(() => exportPatientChart(h),
      error => error?.code === 'CHART_EXPORT_FLAGS_INVALID');
    assert.equal(h.asked.length, 0, 'nothing was read');
  }
  // Absent defaults to true, as the original's does; false travels as false.
  const off = harness({ params: { include_visits: false, include_incidents: false } });
  await exportPatientChart(off);
  assert.deepEqual(off.asked[0].args,
    { patient_id: 'patient-a1', include_visits: false, include_incidents: false });
  assert.deepEqual(off.audits[0].options.detail,
    { patient_id: 'patient-a1', includes_visits: false, includes_incidents: false });
});

test('an empty document is a failure rather than a document', async () => {
  for (const answer of [JSON.stringify({ document_content: '   ' }), JSON.stringify({}),
    JSON.stringify({ document_content: 42 }), '', '   ']) {
    const h = harness({ answer });
    await assert.rejects(() => exportPatientChart(h),
      error => error?.code === 'CHART_EXPORT_EMPTY', JSON.stringify(answer));
    assert.equal(h.audits.length, 0, 'an export that produced nothing is not recorded');
  }
  // A model answering with markdown-fenced JSON is still parsed, and a
  // page_count that is not a number is simply absent.
  const fenced = harness({ answer: '```json\n{"document_content":"OK","page_count":"many"}\n```' });
  const result = await exportPatientChart(fenced);
  assert.equal(result.document, 'OK');
  assert.equal(Object.hasOwn(result, 'pages'), false);
  // An answer that is not JSON at all becomes the document, which IS the
  // original's `typeof result === 'string' ? result : ''`. Faithful rather
  // than tidy: a model that answers in prose is answering, and refusing it
  // here would lose a document the Base44 path produces today.
  const prose = harness({ answer: 'I cannot help with that.' });
  assert.equal((await exportPatientChart(prose)).document, 'I cannot help with that.');
});

test('a failed trail append does not lose the document, and is reported', async () => {
  // D53's rule: `audit_recorded` belongs wherever a transaction does not, and
  // a model call and a trail append are two round trips.
  const h = harness({ auditThrows: true });
  const result = await exportPatientChart(h);
  assert.equal(result.success, true);
  assert.equal(result.audit_recorded, false);
  assert.equal(result.document, 'CHART');
  assert.equal(h.audits.length, 1, 'it was attempted');
});

test('an absent patient never reaches the store', async () => {
  for (const patient_id of [undefined, null, '', '   ', 42, { id: 'x' }]) {
    const h = harness({ params: { patient_id } });
    await assert.rejects(() => exportPatientChart(h),
      error => error?.code === 'CHART_EXPORT_PATIENT_REQUIRED');
    assert.equal(h.asked.length, 0);
  }
});

test('the prompt survives a chart with nothing in it', async () => {
  // Every fallback the original has, exercised at once: an empty chart must
  // still produce a document rather than a page of `undefined`.
  const prompt = buildChartPrompt({ patient: {}, visits: null, incidents: undefined });
  assert.match(prompt, /MRN: N\/A/);
  assert.match(prompt, /Allergies: No known allergies/);
  assert.match(prompt, /Secondary Diagnoses: None/);
  assert.match(prompt, /Past Medical History: None/);
  assert.match(prompt, /Primary Language: English/);
  assert.match(prompt, /Has Living Will: No/);
  assert.match(prompt, /RECENT VISITS \(0\)/);
  assert.match(prompt, /CLINICAL INCIDENTS \(0\)/);
  // A stored zero reads 'N/A', which is the original's `||` and not a bug to
  // tidy: tidying it would change the document for a real value.
  assert.match(buildChartPrompt({ patient: { baseline_vitals: { heart_rate: 0 } },
    visits: [], incidents: [] }), /HR: N\/A bpm/);
  // The count is of what was READ and the list is a sample of ten, which is
  // both halves of the original.
  const many = Array.from({ length: 30 }, (unused, index) => ({
    visit_date: `2026-01-${String(index + 1).padStart(2, '0')}`, visit_type: 'skilled_nursing' }));
  const long = buildChartPrompt({ patient: {}, visits: many, incidents: [] });
  assert.match(long, /RECENT VISITS \(30\)/);
  assert.match(long, /^10\. 2026-01-10: skilled_nursing$/m);
  assert.equal(/^11\. /m.test(long), false, 'only ten are listed');
});
