import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyzerFaxItems } from "./providerFaxItems.js";
import { buildProviderForm } from "./referralFollowUpEngine.js";

const capture = {
  opportunities: [
    {
      key: "heart_failure",
      label: "Heart failure",
      value: "high",
      evidence: [{ source: "medications", text: "Furosemide 40 mg" }],
      suggestion: "…",
    },
    {
      key: "depression",
      label: "Depression",
      value: "medium",
      evidence: [{ source: "medications", text: "Sertraline 50 mg" }],
      suggestion: "…",
    },
  ],
};

test("comorbidity opportunities become per-condition provider questions with evidence", () => {
  const items = buildAnalyzerFaxItems({ comorbidityCapture: capture });
  assert.equal(items.length, 2);
  const hf = items.find((i) => i.id === "comorbidity_heart_failure");
  assert.equal(hf.severity, "high");
  assert.equal(hf.category, "reimbursement");
  assert.match(hf.provider_request.question, /Is heart failure an active diagnosis/);
  assert.match(hf.provider_request.hint, /Furosemide 40 mg/);
  assert.equal(items.find((i) => i.id === "comorbidity_depression").severity, "medium");
});

test("AI critical-missing items append unless an existing item already covers the topic", () => {
  const existing = [
    { title: "Insurance / Medicare number missing", needed: "payer identifiers", provider_request: { question: "…" } },
  ];
  const items = buildAnalyzerFaxItems({
    analysis: {
      missing_information: {
        critical_missing: [
          { field_name: "Insurance policy number", why_critical: "Cannot bill", how_to_obtain: "Call case manager" },
          { field_name: "Emergency contact", why_critical: "Safety planning" },
        ],
      },
    },
    existingItems: existing,
  });
  // Insurance is covered by the existing engine item; emergency contact is new.
  assert.equal(items.length, 1);
  assert.match(items[0].title, /Emergency contact/);
  assert.equal(items[0].provider_request.question, "Please provide: Emergency contact.");
});

test("AI items also dedupe against the comorbidity items added in the same pass", () => {
  const items = buildAnalyzerFaxItems({
    comorbidityCapture: capture,
    analysis: {
      missing_information: {
        critical_missing: [{ field_name: "Diagnosis codes for heart failure", why_critical: "Coding" }],
      },
    },
  });
  // The diagnosis-family keyword is already covered by the comorbidity items.
  assert.equal(items.filter((i) => i.id.startsWith("ai_missing")).length, 0);
});

test("items slot into buildProviderForm after rule items and render questions", () => {
  const ruleItem = {
    id: "f2f_missing", seq: 1, source: "rules", category: "compliance", severity: "critical",
    title: "Face-to-Face encounter documentation missing", needed: "F2F note", why: "condition of payment",
    citation: "42 CFR 424.22", provider_request: { question: "Attach F2F", response_type: "document", hint: "" },
  };
  const analyzerItems = buildAnalyzerFaxItems({ comorbidityCapture: capture });
  const form = buildProviderForm({ patientName: "J. Doe", agencyName: "Acme HH" }, [...analyzerItems, ruleItem]);
  // Critical rule item sorts first; analyzer items follow by severity.
  assert.equal(form.sections[0].title, "Face-to-Face encounter documentation missing");
  assert.ok(form.sections.some((s) => /Confirm diagnosis: Heart failure/.test(s.title)));
});

test("empty inputs yield no items", () => {
  assert.deepEqual(buildAnalyzerFaxItems({}), []);
  assert.deepEqual(buildAnalyzerFaxItems({ analysis: {}, comorbidityCapture: { opportunities: [] } }), []);
});
