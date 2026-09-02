import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("canonical frontend and backend PDGM reimbursement gates default off", async () => {
  const [frontend, backend] = await Promise.all([
    read("src/components/pdgm/pdgmAvailability.js"),
    read("base44/_shared/backendHelpers.mjs"),
  ]);
  assert.match(frontend, /PDGM_REIMBURSEMENT_ENABLED\s*=\s*false/);
  assert.match(backend, /PDGM_REIMBURSEMENT_ENABLED\s*=\s*false/);
  for (const source of [frontend, backend]) {
    assert.match(source, /paymentAvailable:\s*false/);
    assert.match(source, /(?:totalPayment|amount):\s*null/);
    assert.match(source, /not a \$0 result/i);
  }
});

test("calculatePDGM returns before client creation, body parsing, or service reads", async () => {
  const source = await read("base44/functions/calculatePDGM/entry.ts");
  const handler = source.slice(source.indexOf("Deno.serve"));
  const gate = handler.indexOf("if (!PDGM_REIMBURSEMENT_ENABLED)");
  assert.ok(gate >= 0, "handler must check the global gate");
  assert.ok(gate < handler.indexOf("createClientFromRequest(req)"));
  assert.ok(gate < handler.indexOf("req.json()"));
  assert.match(handler.slice(gate, handler.indexOf("createClientFromRequest(req)")), /status:\s*409/);
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
    ["base44/functions/generateCarePlansFromReferral/entry.ts", "REFERRAL_CARE_PLAN_AI_ENABLED", "referral_care_plan_ai_paused"],
    ["base44/functions/mapNoteToOASIS/entry.ts", "NOTE_TO_OASIS_MAPPING_ENABLED", "note_to_oasis_mapping_paused"],
    ["base44/functions/analyzeClinicalRisks/entry.ts", "CLINICAL_RISK_AI_ENABLED", "clinical_risk_ai_paused"],
    ["base44/functions/listOASISUploads/entry.ts", "OASIS_UPLOAD_LIST_ENABLED", "oasis_upload_listing_paused"],
    ["base44/functions/processOASISBatch/entry.ts", "OASIS_BATCH_AI_ENABLED", "oasis_batch_ai_paused"],
    ["base44/functions/savePayerRateConfig/entry.ts", "PAYER_RATE_CONFIG_ENABLED", "payer_rate_configuration_paused"],
    ["base44/functions/generateOASISReportPDF/entry.ts", "OASIS_REPORT_PDF_ENABLED", "oasis_report_pdf_paused"],
    ["base44/functions/generateComprehensiveOASISReport/entry.ts", "COMPREHENSIVE_OASIS_REPORT_ENABLED", "comprehensive_oasis_report_paused"],
    ["base44/functions/generateComprehensiveReport/entry.ts", "COMPREHENSIVE_REPORT_ENABLED", "comprehensive_report_paused"],
    ["base44/functions/generateOASISAssessment/entry.ts", "OASIS_ASSESSMENT_AI_ENABLED", "oasis_assessment_ai_paused"],
    ["base44/functions/generateCarePlanSuggestions/entry.ts", "CARE_PLAN_SUGGESTIONS_AI_ENABLED", "care_plan_suggestions_ai_paused"],
    ["base44/functions/monitorComplianceRisks/entry.ts", "COMPLIANCE_RISK_MONITOR_ENABLED", "compliance_risk_monitor_paused"],
    ["base44/functions/batchAIAnalysis/entry.ts", "BATCH_CLINICAL_AI_ENABLED", "batch_clinical_ai_paused"],
    ["base44/functions/generateCarePlanFromReferral/entry.ts", "REFERRAL_CARE_PLAN_DRAFT_ENABLED", "referral_care_plan_draft_paused"],
    ["base44/functions/generateAdmissionNoteFromReferral/entry.ts", "REFERRAL_ADMISSION_NOTE_AI_ENABLED", "referral_admission_note_ai_paused"],
  ];

  for (const [path, flag, reason] of endpoints) {
    const source = await read(path);
    assert.match(source, new RegExp(`${flag}\\s*=\\s*false`));
    const handler = source.slice(source.indexOf("Deno.serve"));
    const gate = handler.indexOf(`if (!${flag})`);
    const client = handler.indexOf("createClientFromRequest(req)");
    assert.ok(gate >= 0 && client > gate, `${path} must gate before Base44 client creation`);
    const preClient = handler.slice(gate, client);
    assert.ok(preClient.includes(reason));
    assert.match(preClient, /status:\s*409/);
    assert.doesNotMatch(preClient, /req\.json\s*\(|InvokeLLM|asServiceRole|\.entities\./);
  }
});

test("unsafe AI PDGM prompt builders contain no dormant grouping or payment prompt", async () => {
  const source = await read("src/components/oasis/pdgmNavigatorPrompts.jsx");
  assert.match(source, /buildNavigationRequest\s*=\s*refusePdgmAiPrompt/);
  assert.match(source, /buildFinancialPredictionRequest\s*=\s*refusePdgmAiPrompt/);
  assert.match(source, /buildResolutionWorkflowRequest\s*=\s*refusePdgmAiPrompt/);
  assert.doesNotMatch(source, /Every diagnosis MUST|functional points|calculated_payment|higher reimbursement|optimal primary diagnosis/i);
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

test("Patient Details context never reads or returns raw OASIS assessment rows", async () => {
  const source = await read("base44/functions/getPatientContext/entry.ts");
  const handler = source.slice(source.indexOf("Deno.serve"));
  assert.doesNotMatch(handler, /entities\.OASISAssessment|e\.OASISAssessment/);
  assert.match(handler, /oasisAssessments:\s*\[\]/);
});

test("OASIS analyzer and patient proactive scoring stop before child mounts", async () => {
  const [analyzer, patientDetails] = await Promise.all([
    read("src/components/hub-tabs/OASISAnalyzer.jsx"),
    read("src/pages/PatientDetails.jsx"),
  ]);
  assert.match(analyzer, /OASIS_ANALYZER_ENABLED\s*=\s*false/);
  assert.match(analyzer, /if \(!OASIS_ANALYZER_ENABLED\)[\s\S]*OASIS AI Analyzer Paused/);
  assert.match(patientDetails, /PDGM_REIMBURSEMENT_ENABLED\s*&&\s*\(\s*<AIProactiveOASISAssistant/);
});

test("OASIS/PDGM AI, analytics, reporting, and workflow surfaces default to static pre-hook pauses", async () => {
  const surfaces = [
    ["src/components/hub-tabs/OASISReview.jsx", "OASIS_AI_REVIEW_ENABLED", "OASIS AI Suggestion Review Paused"],
    ["src/components/hub-tabs/OASISAnalyticsDashboard.jsx", "OASIS_AI_ANALYTICS_ENABLED", "OASIS AI Analytics Paused"],
    ["src/components/hub-tabs/OASISClinicalReview.jsx", "OASIS_CLINICAL_AI_ENABLED", "OASIS Clinical AI Review Paused"],
    ["src/components/hub-tabs/OASISAuditDashboard.jsx", "OASIS_AUDIT_AI_ENABLED", "OASIS AI Audit Dashboard Paused"],
    ["src/pages/ClinicalPathwayManager.jsx", "CLINICAL_PATHWAY_MANAGER_ENABLED", "Clinical Pathway AI Paused"],
    ["src/pages/PredictiveAnalytics.jsx", "PREDICTIVE_OASIS_ANALYTICS_ENABLED", "Predictive OASIS analysis unavailable"],
    ["src/components/hub-tabs/RealTimeComplianceDashboard.jsx", "REALTIME_COMPLIANCE_ANALYTICS_ENABLED", "Real-Time Compliance Analytics Paused"],
    ["src/pages/DocumentationImpact.jsx", "PDGM_PAYMENT_FEATURE_AVAILABLE", "OASIS/PDGM documentation impact"],
    ["src/components/reports/OASISComplianceReport.jsx", "OASIS_COMPLIANCE_REPORT_ENABLED", "OASIS Compliance Report Paused"],
    ["src/components/reports/PDGMReimbursementReport.jsx", "PDGM_REPORT_ENABLED", "PDGM Report Paused"],
    ["src/components/clinical/ProactiveClinicalSupport.jsx", "PROACTIVE_CLINICAL_AI_ENABLED", "Proactive Clinical AI Paused"],
    ["src/components/compliance/AIComplianceAuditor.jsx", "AI_COMPLIANCE_AUDITOR_ENABLED", "AI Compliance Audit Paused"],
    ["src/components/hub-tabs/SmartOASISAssessment.jsx", "SMART_OASIS_ASSESSMENT_ENABLED", "Smart OASIS Assessment Paused"],
    ["src/components/clinical/OASISQuickUpdate.jsx", "OASIS_QUICK_UPDATE_ENABLED", "OASIS Quick Update Paused"],
    ["src/components/hub-tabs/OASISComplianceReview.jsx", "OASIS_COMPLIANCE_REVIEW_ENABLED", "OASIS Compliance AI Review Paused"],
    ["src/components/hub-tabs/OASISDocumentationReview.jsx", "OASIS_DOCUMENTATION_REVIEW_ENABLED", "OASIS Documentation AI Review Paused"],
    ["src/components/clinical/AIAdmissionDocumentationAssistant.jsx", "AI_ADMISSION_DOCUMENTATION_ENABLED", "AI Admission Documentation Paused"],
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

test("browser PDGM rate configuration is paused without direct or brokered reads", async () => {
  const [settings, reader, writer] = await Promise.all([
    read("src/lib/agencySettings.js"),
    read("base44/functions/getPDGMRateConfig/entry.ts"),
    read("base44/functions/savePDGMRateConfig/entry.ts"),
  ]);
  const pdgmFetcher = settings.slice(settings.indexOf("export function fetchCallerPdgmRateConfig"), settings.indexOf("export function fetchCallerFollowUpRuleConfig"));
  assert.match(pdgmFetcher, /Promise\.resolve\(null\)/);
  assert.doesNotMatch(pdgmFetcher, /functions\.invoke|entities\.PDGMRateConfig/);
  for (const source of [reader, writer]) {
    assert.match(source, /status:\s*409/);
    assert.doesNotMatch(source, /asServiceRole|\.auth\.me\s*\(|req\.json\s*\(/);
  }
});
