import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_REPORT_MODEL, AI_REPORT_PARAMS, generateAiReport, insightPrompt, reportFilename,
} from './ai-report.mjs';
import { reportWindow } from './report-metrics.mjs';
import { HANDLERS } from './handlers.mjs';

/**
 * The AI report handler's own behaviour.
 *
 * `pennsyncApiOriginalParity` proves the arithmetic and the prompt are the
 * original's. What is proved here is the ORDER of the refusals, which is the
 * one thing this port rearranged, and the partial: the document is served and
 * the delivery branch answers the original's own 503.
 */
const AGGREGATES = Object.freeze({
  visits_total: 4, visits_completed: 3, patients_total: 2, patients_active: 2,
  falls: 1, hospitalizations: 0, medication_errors: 0,
  audits_total: 1, audit_score_sum: 90, audits_passed: 1, audits_flagged: 0, audits_critical: 0,
  notes_total: 2, note_quality_sum: 150, note_improvement_sum: 10,
  critical_alerts: 1, tasks_total: 2, tasks_completed: 1,
  roster: ['nurse@example.invalid'], roster_size: 1,
  daily_notes: [{ day: '2026-09-01', count: 2 }],
  nurse_visits: [{ email: 'nurse@example.invalid', total: 4, completed: 3 }],
  nurse_notes: [{ email: 'nurse@example.invalid', count: 2,
    quality_sum: 150, improvement_sum: 10 }],
  training_completed: 'served_by_hub', training_score: 'served_by_hub',
});
const INSIGHTS = Object.freeze({
  executive_summary: 'Visits are up.',
  performance_highlights: ['Completion improved'],
  priority_actions: [{ action: 'Staff the weekend', rationale: 'Gaps', expected_impact: 'Fewer falls' }],
  predictive_insights: ['Steady'],
  areas_of_concern: [{ concern: 'Falls', impact: 'Safety' }],
});
const harness = (overrides = {}) => {
  const asked = [];
  const calls = [];
  return {
    asked,
    calls,
    now: new Date('2026-09-20T12:00:00.000Z'),
    params: { report_type: 'monthly_operations', ...overrides.params },
    contract: async (name, args) => {
      asked.push({ name, args });
      if (overrides.contractThrows) throw overrides.contractThrows;
      return overrides.aggregates ?? AGGREGATES;
    },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer : INSIGHTS;
    },
  };
};
const refused = async (run, status, code) => {
  await assert.rejects(run, error => {
    assert.equal(error.status, status, `expected ${status}, got ${error.status}`);
    assert.equal(error.code, code);
    return true;
  });
};

test('the document is served and it is a PDF', async () => {
  const h = harness();
  const answer = await generateAiReport(h);
  assert.equal(answer.binary, true);
  assert.equal(answer.contentType, 'application/pdf');
  assert.equal(answer.filename, 'monthly_operations-report-2026-09-20.pdf');
  assert.ok(answer.body.byteLength > 1000, 'a rendered report is not an empty buffer');
  assert.equal(Buffer.from(answer.body.slice(0, 5)).toString('latin1'), '%PDF-');
});

test('asking for delivery gets the original s own paused refusal', async () => {
  // The original refuses this branch ITSELF, through the generated
  // `outboundDeliveryGate`: `recipients.length > 0 && !outboundDeliveryReleased()`
  // answers 503 `OUTBOUND_DELIVERY_RELEASE_PAUSED` before it fetches anything.
  // That is why the capability could be ported at all (D79's discriminator: it
  // has a success answer that is not the integration's result).
  await refused(generateAiReport(harness({ params: { recipients: ['x@example.invalid'] } })),
    503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  // An empty list is not a request to deliver, so it is served.
  const served = await generateAiReport(harness({ params: { recipients: [] } }));
  assert.equal(served.contentType, 'application/pdf');
});

test('nothing is rendered or asked of a model on the paused branch', async () => {
  const h = harness({ params: { recipients: ['x@example.invalid'] } });
  await refused(generateAiReport(h), 503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  assert.equal(h.calls.length, 0, 'no model call is paid for a refusal');
});

test('authorization is the contract s, and it answers before the body is judged', async () => {
  // The ONE ordering divergence, and it is a narrowing: the original checks its
  // role gate, then `report_type`, then the pause. Authorization lives in the
  // contract now, so a caller who may not run the report cannot learn whether
  // their body was well formed.
  const denied = Object.assign(new Error('forbidden'),
    { status: 403, code: 'PENNSYNC_REPORT_FORBIDDEN' });
  const h = harness({ params: { report_type: '', recipients: ['x@example.invalid'] },
    contractThrows: denied });
  await refused(generateAiReport(h), 403, 'PENNSYNC_REPORT_FORBIDDEN');
  assert.equal(h.asked.length, 1, 'the contract was asked');

  // And for a caller who IS allowed, the body is judged before the pause, as
  // the original judges it.
  const allowed = harness({ params: { report_type: '', recipients: ['x@example.invalid'] } });
  await refused(generateAiReport(allowed), 400, 'AI_REPORT_TYPE_REQUIRED');
});

test('the window is the original s clamp and it reaches the contract', async () => {
  const h = harness({ params: { date_range_days: 7 } });
  await generateAiReport(h);
  assert.equal(h.asked[0].name, 'readReportMetrics');
  assert.equal(h.asked[0].args.end, '2026-09-20T12:00:00.000Z');
  assert.equal(h.asked[0].args.start, '2026-09-13T12:00:00.000Z');

  // The original's own clamp, which this port keeps: 1..365, floored, with a
  // non-number falling to its default of 30. Note the quirk in its own
  // expression, `Math.floor(Number(raw) || 30)` — ZERO is falsy, so a caller
  // asking for no days gets the default month rather than the floor of one
  // day, while a negative number does get floored to one. Kept as written.
  assert.equal(reportWindow(0).days, 30);
  assert.equal(reportWindow(-5).days, 1);
  assert.equal(reportWindow(1e8).days, 365);
  assert.equal(reportWindow('nonsense').days, 30);
  assert.equal(reportWindow(undefined).days, 30);
  assert.equal(reportWindow(7.9).days, 7);
});

test('the model is asked once, with the model and schema the original names', async () => {
  const h = harness();
  await generateAiReport(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].operation, 'InvokeLLM');
  assert.equal(h.calls[0].payload.model, AI_REPORT_MODEL);
  assert.equal(h.calls[0].payload.response_json_schema.properties.benchmarking.type, 'string');
  assert.ok(h.calls[0].payload.prompt.startsWith(
    'Analyze these healthcare metrics and provide actionable AI insights.'));
});

test('insights are optional and the document is still produced without them', async () => {
  const h = harness({ params: { include_ai_insights: false } });
  const answer = await generateAiReport(h);
  assert.equal(h.calls.length, 0);
  assert.equal(answer.contentType, 'application/pdf');
});

test('a model reply that is text is parsed, and one that is nothing still renders', async () => {
  // Base44 honoured `response_json_schema` and handed the original an object.
  const asText = harness({ answer: JSON.stringify(INSIGHTS) });
  assert.equal((await generateAiReport(asText)).contentType, 'application/pdf');
  // The original's own guards cover a reply missing every field; its comment
  // says a bad response "must not 500 the whole report after all the entity
  // fetches + LLM call were paid for".
  const asNoise = harness({ answer: 'not json at all' });
  assert.equal((await generateAiReport(asNoise)).contentType, 'application/pdf');
});

test('the flags are booleans and the recipients are a list', async () => {
  await refused(generateAiReport(harness({ params: { recipients: 'someone@example.invalid' } })),
    400, 'AI_REPORT_RECIPIENTS_INVALID');
  await refused(generateAiReport(harness({ params: { include_ai_insights: 'yes' } })),
    400, 'AI_REPORT_INSIGHTS_FLAG_INVALID');
});

test('the handler refuses a parameter the original never accepted', () => {
  // `metrics` IS accepted and ignored, because the original destructures it
  // with a default and never reads it again — D81's four client controls, same
  // reading. Something it never named is refused rather than ignored.
  assert.deepEqual([...AI_REPORT_PARAMS].sort(),
    ['date_range_days', 'include_ai_insights', 'metrics', 'recipients', 'report_type']);
  assert.throws(() => HANDLERS.generateAIReport.handle({
    params: { report_type: 'x', agency_id: 'agency-b' },
    contract: async () => AGGREGATES, integration: async () => INSIGHTS,
  }), error => {
    assert.equal(error.code, 'INVALID_PARAMS');
    return true;
  });
});

test('the handler is declared binary and as needing the integration runtime', () => {
  // It calls `InvokeLLM` by default, so releasing the name without a runtime
  // configured would be a service that answers ready and then refuses.
  assert.equal(HANDLERS.generateAIReport.binary, true);
  assert.equal(HANDLERS.generateAIReport.needsIntegration, true);
});

test('the filename is the original s, down to the date it uses', () => {
  assert.equal(reportFilename('weekly_quality', new Date('2026-01-05T23:30:00.000Z')),
    'weekly_quality-report-2026-01-05.pdf');
});

test('the prompt carries no colleague and the six questions the original asks', () => {
  const prompt = insightPrompt({
    overview: { total_visits: 4 },
    staff_performance: { total_nurses: 1,
      nurse_stats: [{ name: 'nurse@example.invalid', email: 'nurse@example.invalid',
        visits_completed: 3 }] },
  }, 'monthly_operations');
  assert.equal(prompt.includes('nurse@example.invalid'), false);
  assert.ok(prompt.includes('"visits_completed": 3'), 'the numbers still reach the model');
  for (const question of ['Executive summary', 'Performance highlights', 'Areas of concern',
    'Priority actions', 'Predictive insights', 'Benchmarking analysis']) {
    assert.ok(prompt.includes(question), `the prompt still asks for ${question}`);
  }
});
