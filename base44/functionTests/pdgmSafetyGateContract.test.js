import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const exists = (path) => existsSync(fileURLToPath(new URL(path, root)));

// Every non-test frontend module, as repository-relative paths.
function frontendModules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(fileURLToPath(new URL(dir, root)), { withFileTypes: true })) {
      const rel = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${rel}/`);
      else if (/\.(?:js|jsx|ts|tsx|mjs)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) out.push(rel);
    }
  };
  walk("src/");
  return out.sort();
}

// The owner removed every user-visible clinical risk-prediction feature and every
// PDGM payment / reimbursement / revenue-estimate feature from the frontend. The
// backend PDGM and risk functions stay deployed (and stay paused, below) but lost
// their frontend callers. What is worth pinning is that the removed surfaces do
// not come back — as files, as routes, as invocations, or as dormant flags that a
// one-line edit could switch on.
const REMOVED_FRONTEND_FILES = [
  // Pages
  "src/pages/PredictiveAnalytics.jsx",
  "src/pages/DocumentationImpact.jsx",
  "src/pages/PDGMRateSettings.jsx",
  "src/pages/ClinicalInsightsDashboard.jsx",
  // Tabs, reports and cards
  "src/components/hub-tabs/OASISRevenueAnalysis.jsx",
  "src/components/reports/PDGMReimbursementReport.jsx",
  "src/components/alerts/PatientAlertAnalyzer.jsx",
  "src/components/alerts/RiskAlertWidget.jsx",
  "src/components/clinical/ProactiveClinicalSupport.jsx",
  "src/components/referral/ClinicalManagerBriefCard.jsx",
  "src/components/referral/clinicalManagerBrief.js",
  "src/components/referral/followUpRevenueImpact.js",
  // Risk prediction
  "src/components/predictive/PatientRiskScorecard.jsx",
  "src/components/predictive/PopulationRiskOverview.jsx",
  "src/components/predictive/RehospitalizationPredictor.jsx",
  "src/components/predictive/PatientDeteriorationPredictor.jsx",
  "src/components/predictive/explainableRisk.js",
  "src/components/predictive/pphWorklistEngine.js",
  "src/components/analytics/PredictiveRiskAnalyzer.jsx",
  "src/components/analytics/DiseaseProgressionPredictor.jsx",
  "src/components/analytics/PopulationTrendAnalyzer.jsx",
  "src/components/patient/PatientRiskStratification.jsx",
  "src/components/patient/AIPatientAnalyzer.jsx",
  "src/components/oasis/PredictiveOutcomesAnalyzer.jsx",
  "src/components/oasis/AuditRiskPredictor.jsx",
  "src/components/oasis/AIAuditRiskPredictor.jsx",
  // PDGM payment, navigator, scenario and forecast
  "src/components/oasis/AutomatedPDGMNavigator.jsx",
  "src/components/oasis/pdgmFinancialEngine.js",
  "src/components/oasis/pdgmNavigatorPrompts.jsx",
  "src/components/oasis/PDGMRevenueComparison.jsx",
  "src/components/oasis/PDGMPredictiveForecaster.jsx",
  "src/components/oasis/PDGMScenarioModeler.jsx",
  "src/components/oasis/PDGMTrendDashboard.jsx",
  "src/components/oasis/OASISScenarioManager.jsx",
  "src/components/oasis/EnhancedMultiReportComparison.jsx",
  "src/components/oasis/EnhancedPDGMCaseMixAnalyzer.jsx",
  "src/components/pdgm/pdgmAvailability.js",
  "src/components/pdgm/pdgmRates.js",
  "src/components/pdgm/PDGMCalculationPreview.jsx",
  "src/components/pdgm/PayerRatesManager.jsx",
  "src/components/pdgm/CaseMixWeightsUpload.jsx",
  "src/components/pdgm/WageIndexUpload.jsx",
  "src/components/pdgm/reimbursementImpact.js",
  "src/components/pdgm/payerRates.js",
  "src/components/pdgm/wageIndex.js",
  "src/functions/calculatePDGM.js",
  "src/functions/generatePDGMComparisonPDF.js",
  "src/functions/generatePDGMNavigatorPDF.js",
];

test("removed risk-prediction and PDGM payment frontend modules stay deleted", () => {
  const back = REMOVED_FRONTEND_FILES.filter(exists);
  assert.deepEqual(back, [], `removed with the risk-prediction / PDGM payment features: ${back.join(", ")}`);
  // The PDGM clinical grouping / coding-validation half is deliberately kept.
  for (const kept of [
    "src/components/pdgm/pdgmGrouper.js",
    "src/components/pdgm/cmsPdgmFunctionalDataCy2026.js",
    "src/components/pdgm/cmsHhgsReleasesCy2026.js",
    "src/components/referral/intakeDiagnosisValidator.js",
    "src/components/referral/diagnosisCodeGenerator.js",
    "src/components/visit/pdgmClinicalGroup.js",
  ]) {
    assert.ok(exists(kept), `${kept} is clinical grouping/coding support and must stay`);
  }
});

test("removed pages are not routed, and their old paths redirect to a surviving home", async () => {
  const [manifest, routes] = await Promise.all([read("src/lib/nav.manifest.js"), read("src/routes.jsx")]);
  const pages = new Set([...manifest.matchAll(/page:\s*["']([^"']+)["']/g)].map((m) => m[1]));
  for (const [page, home] of [
    ["PredictiveAnalytics", "/PatientAlerts"],
    ["ClinicalInsightsDashboard", "/PatientAlerts"],
    ["DocumentationImpact", "/ReportsAnalytics"],
    ["PDGMRateSettings", "/AgencySettings"],
    ["OASISRevenueAnalysis", "/OASISCenter"],
  ]) {
    assert.ok(!pages.has(page), `${page} must not be a manifest-routed page`);
    assert.match(routes, new RegExp(`\\{ from: '/${page}', to: '${home}' \\}`), `${page} must redirect to ${home}`);
  }
  const [oasisCenter, reports] = await Promise.all([read("src/pages/OASISCenter.jsx"), read("src/pages/ReportsAnalytics.jsx")]);
  assert.doesNotMatch(oasisCenter, /value="revenue"|OASISRevenueAnalysis/);
  assert.doesNotMatch(reports, /value="pdgm"|PDGMReimbursementReport/);
});

test("no frontend module invokes a PDGM payment or AI risk-scoring endpoint", async () => {
  const PAYMENT_OR_RISK_ENDPOINTS = [
    "calculatePDGM",
    "generatePDGMComparisonPDF",
    "generatePDGMNavigatorPDF",
    "rankDiagnosesByPDGM",
    "getPDGMRateConfig",
    "savePDGMRateConfig",
    "savePayerRateConfig",
    "analyzeClinicalRisks",
  ];
  const offenders = [];
  for (const path of frontendModules()) {
    const source = await read(path);
    for (const name of PAYMENT_OR_RISK_ENDPOINTS) {
      const invoked = new RegExp(`functions\\s*\\.\\s*(?:invoke|fetch)\\s*\\(\\s*['"\`]${name}['"\`]`).test(source);
      const wrapped = new RegExp(`from\\s+['"][^'"]*/functions/${name}['"]`).test(source);
      if (invoked || wrapped) offenders.push(`${path} -> ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no frontend module keeps a dormant PDGM reimbursement flag or payment formatter", async () => {
  const DORMANT = /\b(?:PDGM_REIMBURSEMENT_ENABLED|PDGM_LEGACY_SURFACES_ENABLED|LEGACY_FACTORIZED_PDGM_MODEL_RETIRED|PDGM_PAYMENT_FEATURE_AVAILABLE|getPdgmPaymentState|formatPdgmCurrency|estimateFollowUpRevenueImpact|fetchCallerPdgmRateConfig|fetchCallerPayerRateConfig)\b/;
  const offenders = [];
  for (const path of frontendModules()) {
    if (DORMANT.test(await read(path))) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test("no frontend screen renders a revenue, reimbursement or risk-score estimate", async () => {
  // User-visible labels of the removed money and prediction surfaces. A label
  // reappearing in a component is the cheapest signal that one came back.
  const LABELS = /Revenue Impact|Est\. Revenue|Total Revenue|Revenue Analysis|Revenue Optimization|PDGM Optimization|Open exposure|Payment vs Quality|Total PDGM Payment|Predictive Revenue|Multi-Factor Risk Scoring|Risk Detection Sensitivity|Auto-Run Risk Analysis|PDGM Location Settings|Cost Analysis Settings/;
  const offenders = [];
  for (const path of frontendModules()) {
    if (!/\.jsx$/.test(path)) continue;
    // Comments may name a removed surface to explain its absence; rendered
    // text may not.
    const source = (await read(path)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const match = LABELS.exec(source);
    if (match) offenders.push(`${path}: ${match[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test("the backend PDGM reimbursement gate defaults off", async () => {
  const backend = await read("base44/_shared/backendHelpers.mjs");
  assert.match(backend, /PDGM_REIMBURSEMENT_ENABLED\s*=\s*false/);
  assert.match(backend, /LEGACY_FACTORIZED_PDGM_MODEL_RETIRED\s*=\s*true/);
  assert.match(backend, /PDGM_LEGACY_SURFACES_ENABLED\s*=\s*PDGM_REIMBURSEMENT_ENABLED\s*&&\s*!LEGACY_FACTORIZED_PDGM_MODEL_RETIRED/);
  assert.match(backend, /paymentAvailable:\s*false/);
  assert.match(backend, /(?:totalPayment|amount):\s*null/);
  assert.match(backend, /not a \$0 result/i);
});

test("calculatePDGM returns before client creation, body parsing, or service reads", async () => {
  const source = await read("base44/functions/calculatePDGM/entry.ts");
  const handler = source.slice(source.indexOf("Deno.serve"));
  assert.match(source, /LEGACY_FACTORIZED_PDGM_MODEL_RETIRED\s*=\s*true/);
  const gate = handler.indexOf("if (!PDGM_LEGACY_SURFACES_ENABLED)");
  assert.ok(gate >= 0, "handler must check the global gate");
  assert.ok(gate < handler.indexOf("createClientFromRequest("));
  assert.ok(gate < handler.indexOf("req.json()"));
  assert.match(handler.slice(gate, handler.indexOf("createClientFromRequest(")), /status:\s*409/);
});

test("every backend raw reimbursement-flag consumer carries the retirement lock", async () => {
  const paths = [
    "base44/functions/batchAIAnalysis/entry.ts",
    "base44/functions/calculatePDGM/entry.ts",
    "base44/functions/generateComprehensiveOASISReport/entry.ts",
    "base44/functions/generatePDGMComparisonPDF/entry.ts",
    "base44/functions/generatePDGMNavigatorPDF/entry.ts",
    "base44/functions/rankDiagnosesByPDGM/entry.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /PDGM_REIMBURSEMENT_ENABLED\s*=\s*false/, `${path} raw gate must default off`);
    assert.match(source, /LEGACY_FACTORIZED_PDGM_MODEL_RETIRED\s*=\s*true/, `${path} must carry retirement lock`);
    assert.match(
      source,
      /PDGM_LEGACY_SURFACES_ENABLED\s*=\s*PDGM_REIMBURSEMENT_ENABLED\s*&&\s*!LEGACY_FACTORIZED_PDGM_MODEL_RETIRED/,
      `${path} must derive its effective gate from both locks`,
    );
    assert.match(source, /featureEnabled:\s*PDGM_LEGACY_SURFACES_ENABLED/);
  }
});

test("dedicated PDGM/AI scoring endpoints are static unavailable handlers", async () => {
  const paths = [
    "base44/functions/rankDiagnosesByPDGM/entry.ts",
    "base44/functions/generatePDGMNavigatorPDF/entry.ts",
    "base44/functions/generatePDGMComparisonPDF/entry.ts",
    "base44/functions/analyzeOASISNarrativeMatch/entry.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    const handler = source.slice(source.indexOf("Deno.serve"));
    assert.match(handler, /status:\s*409/);
    assert.doesNotMatch(handler, /createClientFromRequest|\.auth\.me\s*\(|req\.json\s*\(|asServiceRole|InvokeLLM|invokeLLM/);
  }
});

test("OASIS/clinical AI endpoints stop before auth, data, AI, or writes", async () => {
  const endpoints = [
    ["base44/functions/analyzeClinicalRisks/entry.ts", "CLINICAL_RISK_AI_ENABLED", "clinical_risk_ai_paused"],
    ["base44/functions/savePayerRateConfig/entry.ts", "PAYER_RATE_CONFIG_ENABLED", "payer_rate_configuration_paused"],
    // generateComprehensiveReport, monitorComplianceRisks and batchAIAnalysis
    // were released on 2026-10-08 as documentation and reporting tools (none
    // predicts risk). reportComplianceBatchAuthorizationContract.test.js
    // drives each real handler and pins how it is safe to serve.
  ];

  for (const [path, flag, reason] of endpoints) {
    const source = await read(path);
    assert.match(source, new RegExp(`${flag}\\s*=\\s*false`));
    const handler = source.slice(source.indexOf("Deno.serve"));
    const gate = handler.indexOf(`if (!${flag})`);
    const client = handler.indexOf("createClientFromRequest(");
    assert.ok(gate >= 0 && client > gate, `${path} must gate before Base44 client creation`);
    const preClient = handler.slice(gate, client);
    assert.ok(preClient.includes(reason));
    assert.match(preClient, /status:\s*409/);
    assert.doesNotMatch(preClient, /req\.json\s*\(|InvokeLLM|asServiceRole|\.entities\./);
  }
});

// Released by the owner on 2026-10-08 ("approve everything"). What stays
// pinned is how each one is safe to serve: a chart read only after the caller's
// own access to that chart is decided from membership and the care-team table,
// a batch only for an agency lead and only over the app's own storage, and the
// two report formatters reading no record at all.
test("released OASIS endpoints decide the caller's authority before any record or model", async () => {
  for (const [path, flag] of [
    ["base44/functions/generateOASISAssessment/entry.ts", "OASIS_ASSESSMENT_AI_ENABLED"],
    ["base44/functions/mapNoteToOASIS/entry.ts", "NOTE_TO_OASIS_MAPPING_ENABLED"],
  ]) {
    const source = await read(path);
    assert.match(source, new RegExp(`${flag}\\s*=\\s*true`));
    const handler = source.slice(source.indexOf("Deno.serve"));
    assert.match(handler, /withTrustedClaims\(base44, await base44\.auth\.me\(\)\)/, `${path} reads trusted claims`);
    const check = handler.indexOf("assertOasisChartAccess(");
    assert.ok(check > 0, `${path} checks chart access`);
    assert.ok(handler.indexOf("InvokeLLM") > check, `${path} asks the model only after the chart check`);
    assert.ok(handler.indexOf("entities.OASISUpload") < 0 || handler.indexOf("entities.OASISUpload") > check,
      `${path} reads OASIS records only after the chart check`);
    const helper = source.slice(source.indexOf("async function assertOasisChartAccess"), source.indexOf("Deno.serve"));
    assert.match(helper, /PatientCareTeamAssignment/);
    assert.doesNotMatch(helper, /assigned_nurses|agency_name/, `${path} never authorizes from editable profile fields`);
  }

  const batch = await read("base44/functions/processOASISBatch/entry.ts");
  assert.match(batch, /OASIS_BATCH_AI_ENABLED\s*=\s*true/);
  assert.match(batch, /const BATCH_FILE_HOSTS = \['qtrypzzcjebvfcihiynt\.supabase\.co', 'base44\.app', 'base44\.io'\]/);
  const batchHandler = batch.slice(batch.indexOf("Deno.serve"));
  const lead = batchHandler.indexOf("holdsAgencyLeadMembership(base44, user)");
  assert.ok(lead > 0 && lead < batchHandler.indexOf("InvokeLLM"), "processOASISBatch admits only an agency lead before any model call");
  const hosts = batchHandler.indexOf("fileUrls.every(isAppStorageUrl)");
  assert.ok(hosts > 0 && hosts < batchHandler.indexOf("ExtractDataFromUploadedFile"),
    "processOASISBatch extracts only files in the app's own storage");

  const uploads = await read("base44/functions/listOASISUploads/entry.ts");
  assert.match(uploads, /OASIS_UPLOAD_LIST_ENABLED\s*=\s*true/);
  assert.doesNotMatch(uploads.slice(uploads.indexOf("Deno.serve")), /asServiceRole/,
    "listOASISUploads reads as the caller, so OASISUpload's own read rule decides");

  for (const path of [
    "base44/functions/generateOASISReportPDF/entry.ts",
    "base44/functions/generateComprehensiveOASISReport/entry.ts",
  ]) {
    const handler = (await read(path)).slice((await read(path)).indexOf("Deno.serve"));
    assert.doesNotMatch(handler, /asServiceRole|\.entities\./, `${path} formats the caller's payload and reads no record`);
  }
});

test("referral packet permanently excludes fabricated clinical, OASIS, risk, and care-plan sections", async () => {
  const source = await read("base44/functions/generateReferralOASISPacket/entry.ts");
  const disabled = source.slice(source.indexOf("const disabledSections"), source.indexOf("// Helper to check if section is selected"));
  for (const section of [
    "ai_risk_analysis",
    "oasis_assessment",
    "nursing_notes",
    "homebound_status",
    "sample_assessment",
    "care_plans",
  ]) {
    assert.ok(disabled.includes(`'${section}'`), `${section} must be hard-excluded`);
  }
  assert.match(source, /if \(disabledSections\.has\(section\)\) return false/);
});

test("legacy Patient Details context is permanently retired before any data access", async () => {
  const source = await read("base44/functions/getPatientContext/entry.ts");
  assert.match(source, /code:\s*'legacy_patient_context_retired'/);
  assert.match(source, /status:\s*410/);
  assert.doesNotMatch(source, /createClientFromRequest|OASISAssessment|Patient\.filter|Visit\.filter/);
});

test("OASIS analyzer remains paused and Patient Details mounts no OASIS child", async () => {
  const [analyzer, patientDetails] = await Promise.all([
    read("src/components/hub-tabs/OASISAnalyzer.jsx"),
    read("src/pages/PatientDetails.jsx"),
  ]);
  assert.match(analyzer, /OASIS_ANALYZER_ENABLED\s*=\s*false/);
  assert.match(analyzer, /if \(!OASIS_ANALYZER_ENABLED\)[\s\S]*OASIS AI Analyzer Paused/);
  assert.doesNotMatch(patientDetails, /<AIProactiveOASISAssistant|<AIGeneratedOASISAssessment/);
});

test("OASIS AI, analytics, reporting, and workflow surfaces default to static pre-hook pauses", async () => {
  const surfaces = [
    ["src/components/hub-tabs/OASISReview.jsx", "OASIS_AI_REVIEW_ENABLED", "OASIS AI Suggestion Review Paused"],
    ["src/components/hub-tabs/OASISAnalyticsDashboard.jsx", "OASIS_AI_ANALYTICS_ENABLED", "OASIS AI Analytics Paused"],
    ["src/components/hub-tabs/OASISClinicalReview.jsx", "OASIS_CLINICAL_AI_ENABLED", "OASIS Clinical AI Review Paused"],
    ["src/components/hub-tabs/OASISAuditDashboard.jsx", "OASIS_AUDIT_AI_ENABLED", "OASIS AI Audit Dashboard Paused"],
    ["src/components/reports/OASISComplianceReport.jsx", "OASIS_COMPLIANCE_REPORT_ENABLED", "OASIS Compliance Report Paused"],
    ["src/components/hub-tabs/SmartOASISAssessment.jsx", "SMART_OASIS_ASSESSMENT_ENABLED", "Smart OASIS Assessment Paused"],
    ["src/components/clinical/OASISQuickUpdate.jsx", "OASIS_QUICK_UPDATE_ENABLED", "OASIS Quick Update Paused"],
    ["src/components/hub-tabs/OASISComplianceReview.jsx", "OASIS_COMPLIANCE_REVIEW_ENABLED", "OASIS Compliance AI Review Paused"],
    ["src/components/hub-tabs/OASISDocumentationReview.jsx", "OASIS_DOCUMENTATION_REVIEW_ENABLED", "OASIS Documentation AI Review Paused"],
    ["src/components/oasis/AIGeneratedOASISAssessment.jsx", "AI_OASIS_ASSESSMENT_ENABLED", "AI OASIS Assessment Guidance Paused"],
  ];

  for (const [path, flag, notice] of surfaces) {
    const source = await read(path);
    assert.match(source, new RegExp(`${flag}\\s*=\\s*false`), `${path} must default off`);
    const wrapperAndTail = source.slice(source.lastIndexOf("export default function"));
    const enabledMount = wrapperAndTail.indexOf("return <");
    const wrapperEnd = enabledMount >= 0 ? wrapperAndTail.indexOf("\n}", enabledMount) : -1;
    const wrapper = wrapperEnd >= 0 ? wrapperAndTail.slice(0, wrapperEnd + 2) : wrapperAndTail;
    assert.match(wrapper, new RegExp(`if \\(!${flag}\\)`), `${path} must gate before enabled component mount`);
    assert.ok(wrapper.includes(notice), `${path} must render its static pause notice`);
    assert.doesNotMatch(wrapper, /useQuery\s*\(|useMutation\s*\(|base44\.|InvokeLLM|invokeLLM/);
  }
});

test("browser PDGM rate configuration has no reader, and the backend pair stays paused", async () => {
  const [settings, reader, writer] = await Promise.all([
    read("src/lib/agencySettings.js"),
    read("base44/functions/getPDGMRateConfig/entry.ts"),
    read("base44/functions/savePDGMRateConfig/entry.ts"),
  ]);
  assert.doesNotMatch(settings, /fetchCallerPdgmRateConfig|PDGMRateConfig|PayerRateConfig/);
  for (const source of [reader, writer]) {
    assert.match(source, /status:\s*409/);
    assert.doesNotMatch(source, /asServiceRole|\.auth\.me\s*\(|req\.json\s*\(/);
  }
});

// Released by the owner on 2026-10-08 ("turn everything on"): the care-plan
// and referral drafting endpoints. Their gate stays (an operator's off
// switch, still answered before the SDK), and what is pinned is the order:
// authority from service-owned rows before the body, any record or the
// model, and drafts that write no care plan. carePlanAiAuthorizationContract
// drives each one.
test("released care-plan AI endpoints decide authority before the body, any record or the model", async () => {
  for (const [path, flag, authority] of [
    ["base44/functions/generateCarePlanSuggestions/entry.ts", "CARE_PLAN_SUGGESTIONS_AI_ENABLED", "loadAccessiblePatient("],
    ["base44/functions/generateCarePlansFromReferral/entry.ts", "REFERRAL_CARE_PLAN_AI_ENABLED", "loadAccessiblePatient("],
    ["base44/functions/generateCarePlanFromReferral/entry.ts", "REFERRAL_CARE_PLAN_DRAFT_ENABLED", "requireActiveMember("],
    ["base44/functions/generateAdmissionNoteFromReferral/entry.ts", "REFERRAL_ADMISSION_NOTE_AI_ENABLED", "requireActiveMember("],
  ]) {
    const source = await read(path);
    assert.match(source, new RegExp(`${flag}\\s*=\\s*true`), path);
    const handler = source.slice(source.indexOf("Deno.serve"));
    const gate = handler.indexOf(`if (!${flag})`);
    const client = handler.indexOf("createClientFromRequest(");
    const me = handler.indexOf("base44.auth.me()");
    const check = handler.indexOf(authority);
    const llm = handler.indexOf("InvokeLLM");
    assert.ok(gate >= 0 && gate < client && client < me && me < check && check < llm, `${path} order`);
    assert.doesNotMatch(handler, /\.create\(|\.update\(|updateMany|assigned_nurses|agency_name/, `${path} writes nothing and reads no profile scope`);
    assert.doesNotMatch(handler, /PDGM|reimbursement tips/i, `${path} is payment-neutral`);
  }
  for (const path of [
    "base44/functions/generateCarePlanSuggestions/entry.ts",
    "base44/functions/generateCarePlansFromReferral/entry.ts",
  ]) {
    const source = await read(path);
    const handler = source.slice(source.indexOf("Deno.serve"));
    const body = handler.indexOf("await readBoundedBody(");
    const check = handler.indexOf("await loadAccessiblePatient(");
    const records = handler.search(/entities\.(?:ClinicalEvent|CarePlan|Visit|Incident)\s*\.filter/);
    assert.ok(body > 0 && body < check && check < records, `${path} reads the chart's records only after access`);
  }
});
