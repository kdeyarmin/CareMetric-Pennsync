// The AI report, ported from base44/functions/generateAIReport/entry.ts.
//
// The NINTH partial port (after D31, D35, D36, D59, D73 and D81): the document
// is served and `recipients` gets the original's own paused refusal, in the
// original's order. It is D81's shape exactly — one `Core.SendEmail`, on a
// branch the module already refuses itself through the generated
// `outboundDeliveryGate` — and the discriminator D79 wrote for that case
// applies here too: this capability has a success answer that is not the
// integration's result, because what it answers with is a PDF.
//
// What the contract does and what this file does is D71's split. Which rows may
// be counted is decided in SQL; the arithmetic over the counts, the prompt and
// the page are here. `report-metrics-source.mjs` carries the original's own
// arithmetic and page, and `report-metrics.mjs` says why feeding them rebuilt
// arrays is faithful.
//
// THREE things the original accepts and does not honour, recorded rather than
// implemented (D81's four client controls, same reading):
//
//   * `metrics` — destructured with a default of `['all']` and never referenced
//     again. Every report is the full report.
//   * `date_range_days` beyond 1..365 — clamped, as the original clamps it, and
//     the contract re-applies the ceiling because a bound a caller could raise
//     is not a bound (D71).
//   * `recipients` — see above.
//
// ONE ordering divergence. The original checks its role gate, then
// `report_type`, then the delivery pause. Authorization here belongs to the
// contract, so the required-field check moves AFTER it: a caller who may not
// run the report can no longer learn whether their body was well formed. That
// is a narrowing.

import { fail } from './contracts.mjs';
import { parseLLMJson } from './llm-json.mjs';
import {
  buildAiReport, insightPayload, reportMetrics, reportWindow,
} from './report-metrics.mjs';

export const AI_REPORT_PARAMS = Object.freeze([
  'report_type', 'date_range_days', 'recipients', 'include_ai_insights', 'metrics',
]);

/** The original's prompt and schema, which decide what the model is asked. */
export const AI_REPORT_MODEL = 'automatic';

export const AI_REPORT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    executive_summary: { type: 'string' },
    performance_highlights: { type: 'array', items: { type: 'string' } },
    areas_of_concern: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concern: { type: 'string' },
          impact: { type: 'string' },
          data_points: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    priority_actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          rationale: { type: 'string' },
          expected_impact: { type: 'string' },
          timeline: { type: 'string' },
        },
      },
    },
    predictive_insights: { type: 'array', items: { type: 'string' } },
    benchmarking: { type: 'string' },
  },
});

/** The original's prompt, over the payload D64 allows to reach a model. */
export function insightPrompt(metrics, reportType) {
  return `Analyze these healthcare metrics and provide actionable AI insights.

REPORT TYPE: ${reportType}

METRICS:
${JSON.stringify(insightPayload(metrics), null, 2)}

Provide:
1. Executive summary (2-3 sentences highlighting key findings)
2. Performance highlights (3-5 positive trends)
3. Areas of concern (3-5 issues requiring attention)
4. Priority actions (top 3 recommendations with rationale)
5. Predictive insights (trends and forecasts)
6. Benchmarking analysis (compare to industry standards if applicable)

Be specific, actionable, and data-driven.`;
}

export const reportFilename = (reportType, endDate) =>
  `${reportType}-report-${endDate.toISOString().split('T')[0]}.pdf`;

export async function generateAiReport({ params, contract, integration, now = new Date() }) {
  const recipients = params.recipients === undefined ? [] : params.recipients;
  if (!Array.isArray(recipients)) fail(400, 'AI_REPORT_RECIPIENTS_INVALID');
  const includeInsights = params.include_ai_insights === undefined
    ? true : params.include_ai_insights;
  if (typeof includeInsights !== 'boolean') fail(400, 'AI_REPORT_INSIGHTS_FLAG_INVALID');

  const { days, startDate, endDate } = reportWindow(params.date_range_days, now);

  // Authorization and the counting, in one round trip. Every refusal below is
  // the contract's; nothing here re-decides who may ask.
  const aggregates = await contract('readReportMetrics', {
    start: startDate.toISOString(), end: endDate.toISOString(),
  });

  const reportType = params.report_type;
  if (typeof reportType !== 'string' || reportType.trim() === '') {
    fail(400, 'AI_REPORT_TYPE_REQUIRED');
  }
  // The original's own refusal, on the branch the original itself refuses.
  if (recipients.length > 0) fail(503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');

  const metricsData = reportMetrics(aggregates, startDate, endDate);
  let aiInsights = null;
  if (includeInsights) {
    const answer = await integration('InvokeLLM', {
      model: AI_REPORT_MODEL,
      prompt: insightPrompt(metricsData, reportType),
      response_json_schema: structuredClone(AI_REPORT_SCHEMA),
    });
    // Base44 honoured `response_json_schema` and handed the original an
    // object; the runtime can answer with the JSON text instead. Parsing it
    // here is what makes the carried page see what the original saw. A reply
    // that parses to nothing becomes an empty object rather than a null,
    // because the original renders the section with its own "No summary
    // available." fallbacks rather than dropping it — its comment says so.
    const parsed = typeof answer === 'string' ? parseLLMJson(answer) : answer;
    aiInsights = (parsed && typeof parsed === 'object') ? parsed : {};
  }

  const { jsPDF } = await import('jspdf');
  const body = buildAiReport(new jsPDF(), {
    report_type: reportType,
    date_range_days: days,
    startDate,
    endDate,
    metricsData,
    aiInsights,
    user: null,
    generatedAt: now.toLocaleString(),
  });
  return {
    binary: true,
    body,
    contentType: 'application/pdf',
    filename: reportFilename(reportType, endDate),
  };
}
