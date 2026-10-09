import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Behavioral contract for the OASIS Center's server side, turned on by the
 * owner on 2026-10-08 ("turn everything on"): the OASIS record broker
 * (manageOASISRecords) and the scoped saved-analysis list (listOASISUploads).
 *
 * Both run here as PRODUCTION source against an in-memory store. What they pin
 * is what makes the released capability safe to serve:
 *   - authority comes from the built-in admin role or ONE canonical active
 *     AgencyMembership (rebuilt by withTrustedClaims), never from the
 *     self-editable agency_id / account_type / is_manager on the User row —
 *     every non-owner fixture below carries lying claims for exactly that;
 *   - a chart is opened only by the platform owner, an agency lead of the
 *     chart's agency, its recorded creator, or an exact active care-team
 *     assignment;
 *   - an agency lead sees and changes only their own agency's records;
 *   - writes are create-once or compare-and-set, so a retry or a race never
 *     leaves two records for one action; and
 *   - no money-shaped field is stored or returned.
 */

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const STORAGE = "https://base44.app/api/apps/app/files/oasis.pdf";

function membership(id, agencyId, userId, email, tenantRole, status = "active") {
  return {
    id,
    agency_id: agencyId,
    user_id: userId,
    membership_key: `${agencyId}:${userId}`,
    user_email_normalized: email,
    tenant_role: tenantRole,
    status,
    version: 1,
    created_by_user_id: "u-admin",
    last_transition_by_user_id: "u-admin",
    last_transition_by_email_normalized: "admin@example.com",
    last_transition_at: "2026-01-01T00:00:00.000Z",
    last_transition_reason: "initial activation",
    activated_at: status === "pending" ? null : "2026-01-01T00:00:00.000Z",
    revoked_at: null,
    revocation_reason: null,
  };
}

// Every non-owner profile lies about its tenancy and role. None of it may count.
const LIES = { agency_id: "ag2", agency_name: "Other Agency", account_type: "agency_admin", is_manager: true };
const NURSE = { id: "u1", email: "rn@example.com", role: "user", ...LIES };
const MANAGER = { id: "u2", email: "mgr@example.com", role: "user", ...LIES };
const OUTSIDER = { id: "u3", email: "out@example.com", role: "user", agency_id: "ag1", account_type: "agency_admin", is_manager: true };
const NOBODY = { id: "u4", email: "none@example.com", role: "user", ...LIES };
const OWNER = { id: "u-owner", email: "owner@example.com", role: "admin" };

function baseState() {
  return {
    Agency: [
      { id: "ag1", agency_name: "Maple Home Health", status: "active" },
      { id: "ag2", agency_name: "Birch Home Health", status: "active" },
      { id: "ag3", agency_name: "Closed Agency", status: "cancelled" },
    ],
    AgencyMembership: [
      membership("m1", "ag1", "u1", "rn@example.com", "clinician"),
      membership("m2", "ag1", "u2", "mgr@example.com", "manager"),
      membership("m3", "ag2", "u3", "out@example.com", "clinician"),
      membership("m5", "ag1", "u5", "admin2@example.com", "agency_admin"),
    ],
    Patient: [
      { id: "p1", agency_id: "ag1", first_name: "Ada", last_name: "Lovelace", created_by_user_id: "u9", created_by_user_email_normalized: "other@example.com" },
      { id: "p2", agency_id: "ag1", first_name: "Bo", last_name: "Diddley", created_by_user_id: "u9", created_by_user_email_normalized: "other@example.com" },
      { id: "p3", agency_id: "ag2", first_name: "Cy", last_name: "Young", created_by_user_id: "u3", created_by_user_email_normalized: "out@example.com" },
    ],
    PatientCareTeamAssignment: [
      { id: "a1", agency_id: "ag1", patient_id: "p1", user_id: "u1", status: "active" },
      { id: "a2", agency_id: "ag1", patient_id: "p2", user_id: "u1", status: "revoked" },
    ],
    OASISUpload: [],
    OASISAudit: [],
    OASISAutomationRule: [],
    OASISWorkflowExecution: [],
    OASISFeedback: [],
    OASISAssessment: [],
    ComplianceAudit: [],
    ClinicalPathway: [],
    Task: [],
    PatientAlert: [],
  };
}

function matches(row, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === "object" && Array.isArray(expected.$in)) return expected.$in.includes(row[key]);
    if (expected && typeof expected === "object") return false;
    return row[key] === expected;
  });
}

function sorted(rows, sort) {
  if (!sort) return rows;
  const descending = sort.startsWith("-");
  const field = sort.replace(/^-/, "");
  return [...rows].sort((a, b) => {
    const left = a[field] ?? "";
    const right = b[field] ?? "";
    if (left === right) return 0;
    return (left < right ? -1 : 1) * (descending ? -1 : 1);
  });
}

function makeStore(state, runtime) {
  let counter = 0;
  const stamp = () => new Date(NOW + (counter += 1) * 1000).toISOString();
  const entities = {};
  for (const name of Object.keys(state)) {
    entities[name] = {
      filter: async (query, sort, limit) => {
        runtime.reads.push({ entity: name, query: structuredClone(query) });
        // A leaky store ignores the query entirely, as a provider that drops an
        // unsupported operator would: the caller's own checks must still hold.
        const hits = runtime.leakyFilters?.has(name) ? state[name] : state[name].filter((row) => matches(row, query));
        return structuredClone(sorted(hits, sort).slice(0, limit ?? 50));
      },
      list: async (sort, limit) => {
        runtime.reads.push({ entity: name, query: null });
        return structuredClone(sorted(state[name], sort).slice(0, limit ?? 50));
      },
      create: async (record) => {
        const at = stamp();
        const row = { id: `${name}-${state[name].length + 1}-${counter}`, created_date: at, updated_date: at, ...structuredClone(record) };
        state[name].push(row);
        runtime.writes.push({ entity: name, op: "create", row: structuredClone(row) });
        return structuredClone(row);
      },
      update: async (id, patch) => {
        const row = state[name].find((candidate) => candidate.id === id);
        if (!row) throw new Error("not found");
        Object.assign(row, structuredClone(patch), { updated_date: stamp() });
        runtime.writes.push({ entity: name, op: "update", id, patch: structuredClone(patch) });
        return structuredClone(row);
      },
      updateMany: async (query, { $set }) => {
        const hits = state[name].filter((row) => matches(row, query));
        if (runtime.loseRaces) return { success: true, updated: 0 };
        for (const row of hits) Object.assign(row, structuredClone($set), { updated_date: stamp() });
        runtime.writes.push({ entity: name, op: "updateMany", query: structuredClone(query), patch: structuredClone($set) });
        return { success: true, updated: hits.length };
      },
      delete: async (id) => {
        state[name] = state[name].filter((row) => row.id !== id);
        runtime.writes.push({ entity: name, op: "delete", id });
        return { success: true };
      },
    };
  }
  return entities;
}

async function load(functionName, { user, state = baseState(), leaky = [] } = {}) {
  let src = await readFile(new URL(`../functions/${functionName}/entry.ts`, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = globalThis.__orbMakeClient;");
  const tmp = join(tmpdir(), `orb_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, transpileTs(src).outputText);
  const runtime = { reads: [], writes: [], invokes: [], authCalls: 0, loseRaces: false, leakyFilters: new Set(leaky) };
  const service = makeStore(state, runtime);
  let handler;
  globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: () => undefined } };
  globalThis.__orbMakeClient = () => ({
    auth: { me: async () => { runtime.authCalls += 1; return user ? structuredClone(user) : null; } },
    asServiceRole: { entities: service },
    // The caller's own client sees OASISUpload under the entity's read rule:
    // its own rows, or every row for the built-in admin role.
    entities: {
      OASISUpload: {
        filter: async (query, sort, limit) => (await service.OASISUpload.filter(query, sort, limit))
          .filter((row) => user?.role === "admin" || row.created_by === user?.email),
        list: async (sort, limit) => (await service.OASISUpload.list(sort, limit))
          .filter((row) => user?.role === "admin" || row.created_by === user?.email),
      },
    },
    functions: { invoke: async (name, body) => { runtime.invokes.push({ name, body }); return { data: {} }; } },
  });
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  const call = async (body, method = "POST") => {
    const init = { method, headers: { "content-type": "application/json" } };
    if (method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
    const res = await handler(new Request(`http://local/${functionName}`, init));
    return { status: res.status, json: await res.json() };
  };
  return { call, runtime, state };
}

const broker = (user, state) => load("manageOASISRecords", { user, state });

function analysis(overrides = {}) {
  return {
    accuracy_score: 90,
    compliance_score: 92,
    overall_score: 91,
    compliance_concerns: [],
    revenue_uplift: 1234,
    nested: { estimated_payment: 99, keep: "yes" },
    ...overrides,
  };
}

function upload(id, agencyId, patientId, createdBy, extra = {}) {
  return {
    id,
    agency_id: agencyId,
    patient_id: patientId,
    created_by: createdBy,
    analysis_id: `an-${id}`,
    analysis_results: analysis(),
    extracted_data: {},
    updated_date: "2026-10-01T00:00:00.000Z",
    created_date: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

test("the broker refuses a wrong method, an anonymous caller and a caller with no membership before any write", async () => {
  const anonymous = await broker(null);
  assert.equal((await anonymous.call({ action: "list_rules" })).status, 401);
  assert.equal((await anonymous.call(undefined, "GET")).status, 405);

  // u4 has no membership at all and claims ag2 + agency_admin on its profile.
  const nobody = await broker(NOBODY);
  const refused = await nobody.call({ action: "create_tasks", patient_id: "p3", tasks: [{ key: "k1", title: "x" }] });
  assert.equal(refused.status, 403);
  assert.deepEqual(nobody.runtime.writes, []);

  const unknown = await (await broker(NURSE)).call({ action: "drop_everything" });
  assert.equal(unknown.status, 400);
});

test("self-editable profile claims never open a chart or a lead action", async () => {
  // The nurse's profile claims agency_admin + is_manager in ag2. Her one
  // canonical membership is a clinician in ag1.
  const { call, runtime } = await broker(NURSE);
  for (const action of ["list_audits", "supervisor_decision", "save_rule"]) {
    const result = await call({ action, upload_id: "x", rule: {} });
    assert.equal(result.status, 403, action);
  }
  // Not assigned (p2's assignment is revoked) and not the creator: refused.
  assert.equal((await call({ action: "create_tasks", patient_id: "p2", tasks: [{ key: "k", title: "t" }] })).status, 403);
  // Her claimed agency's chart: refused.
  assert.equal((await call({ action: "create_tasks", patient_id: "p3", tasks: [{ key: "k", title: "t" }] })).status, 403);
  assert.deepEqual(runtime.writes, []);
});

test("an assigned clinician adds chart tasks once per key, assigned to herself", async () => {
  const { call, state } = await broker(NURSE);
  const body = { action: "create_tasks", patient_id: "p1", tasks: [{ key: "k-fall", title: "Fall risk follow-up", priority: "high", type: "safety" }] };
  const first = await call(body);
  assert.equal(first.status, 200);
  assert.equal(first.json.results[0].status, "created");
  const retry = await call(body);
  assert.equal(retry.json.results[0].status, "existing");
  assert.equal(state.Task.length, 1);
  const [task] = state.Task;
  assert.equal(task.patient_id, "p1");
  assert.equal(task.assigned_to, "rn@example.com");
  assert.equal(task.created_by, "rn@example.com");
  assert.equal(task.client_request_id, "oasis:u1:k-fall", "the key is scoped to the caller");
});

test("a saved analysis is stamped from the session, stripped of money fields, flagged by its own scores, and saved once", async () => {
  const { call, state } = await broker(NURSE);
  const body = {
    action: "create_upload",
    analysis_id: "an-1",
    file_url: STORAGE,
    patient_id: "p1",
    patient_name: "Spoofed Name",
    analysis_results: analysis({ compliance_score: 50 }),
    pdgm_data: { functional_scores: { m1800_grooming: 2 }, reimbursement: 1 },
    agency_id: "ag2",
    created_by: "someone-else@example.com",
  };
  const saved = await call(body);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.created, true);
  assert.equal(saved.json.audit_flagged, true);
  const [row] = state.OASISUpload;
  assert.equal(row.agency_id, "ag1", "the chart's agency, never the body's");
  assert.equal(row.created_by, "rn@example.com");
  assert.equal(row.patient_name, "Ada Lovelace");
  assert.equal(row.analysis_results.revenue_uplift, undefined);
  assert.equal(row.analysis_results.nested.estimated_payment, undefined);
  assert.equal(row.analysis_results.nested.keep, "yes");
  assert.equal(row.pdgm_data.reimbursement, undefined);
  assert.equal(row.extracted_data.M1800.source, "pdf_extraction");
  assert.equal(state.OASISAudit.length, 1);
  assert.equal(state.OASISAudit[0].flag_reason, "low_compliance");

  const retry = await call(body);
  assert.equal(retry.json.created, false);
  assert.equal(state.OASISUpload.length, 1);
  assert.equal(state.OASISAudit.length, 1);

  // A document outside the app's own storage, or a chart in another agency, is refused.
  assert.equal((await call({ ...body, analysis_id: "an-2", file_url: "https://evil.example/x.pdf" })).status, 400);
  assert.equal((await call({ ...body, analysis_id: "an-3", patient_id: "p3" })).status, 403);
  assert.equal(state.OASISUpload.length, 1);
});

test("extraction review is compare-and-set and closes once a supervisor signs off", async () => {
  const state = baseState();
  state.OASISUpload.push(upload("up1", "ag1", "p1", "other@example.com", {
    extracted_data: { M1800: { value: "2", source: "pdf_extraction" } },
  }));
  const nurse = await broker(NURSE, state);
  const approved = await nurse.call({ action: "review_extracted_item", upload_id: "up1", item_number: "M1800", decision: "approve" });
  assert.equal(approved.status, 200);
  assert.equal(state.OASISUpload[0].extracted_data.M1800.reviewed_by, "rn@example.com");

  nurse.runtime.loseRaces = true;
  const raced = await nurse.call({ action: "review_extracted_item", upload_id: "up1", item_number: "M1800", decision: "edit", value: "3" });
  assert.equal(raced.status, 409, "a concurrent change is never overwritten");
  nurse.runtime.loseRaces = false;

  const manager = await broker(MANAGER, state);
  const signed = await manager.call({ action: "supervisor_decision", upload_id: "up1", decision: "approve" });
  assert.equal(signed.status, 200);
  assert.deepEqual(signed.json.items_signed, ["M1800"]);
  assert.equal(state.OASISUpload[0].supervisor_reviewed_by, "mgr@example.com");
  const late = await nurse.call({ action: "review_extracted_item", upload_id: "up1", item_number: "M1800", decision: "reject", notes: "no" });
  assert.equal(late.status, 409);

  // A nurse who can neither open the chart nor wrote the upload cannot see it.
  state.OASISUpload.push(upload("up2", "ag1", "p2", "other@example.com", { extracted_data: { M1800: { value: "1" } } }));
  const hidden = await nurse.call({ action: "review_extracted_item", upload_id: "up2", item_number: "M1800", decision: "approve" });
  assert.equal(hidden.status, 404);
});

test("the audit queue is an agency lead's, and only for their own agency", async () => {
  const state = baseState();
  state.OASISUpload.push(upload("up1", "ag1", "p1", "rn@example.com"), upload("up3", "ag2", "p3", "out@example.com"));
  state.OASISAudit.push(
    { id: "au1", oasis_upload_id: "up1", patient_id: "p1", status: "pending_review", rescore_opportunities: [{ x: 1 }], estimated_revenue_impact: 9 },
    { id: "au3", oasis_upload_id: "up3", patient_id: "p3", status: "pending_review" },
  );
  const manager = await broker(MANAGER, state);
  const listed = await manager.call({ action: "list_audits" });
  assert.deepEqual(listed.json.audits.map((audit) => audit.id), ["au1"]);
  assert.equal(listed.json.audits[0].rescore_opportunities, undefined);
  assert.equal(listed.json.audits[0].estimated_revenue_impact, undefined);
  assert.equal((await manager.call({ action: "update_audit", audit_id: "au3", patch: { status: "reviewed" } })).status, 404);

  const auditors = await manager.call({ action: "list_auditors", audit_id: "au1" });
  assert.deepEqual(auditors.json.auditors.map((row) => row.email).sort(), ["admin2@example.com", "mgr@example.com"]);
  // Only an ag1 lead may be assigned; the nurse is a member but not a lead.
  assert.equal((await manager.call({ action: "update_audit", audit_id: "au1", patch: { assigned_to: "rn@example.com" } })).status, 400);
  // The reviewer and time are the session's, never the patch's.
  assert.equal((await manager.call({ action: "update_audit", audit_id: "au1", patch: { reviewed_by: "x@example.com" } })).status, 400);
  const reviewed = await manager.call({ action: "update_audit", audit_id: "au1", patch: { status: "reviewed", assigned_to: "admin2@example.com" } });
  assert.equal(reviewed.status, 200);
  assert.equal(state.OASISAudit[0].reviewed_by, "mgr@example.com");
  assert.equal(state.OASISAudit[0].assigned_to, "admin2@example.com");
  assert.equal(state.OASISAudit[1].status, "pending_review");
});

test("automation rules are the platform owner's to change, cleaned on save", async () => {
  const manager = await broker(MANAGER);
  assert.equal((await manager.call({ action: "save_rule", rule: { rule_name: "x", trigger_type: "compliance_issue", action_type: "create_task" } })).status, 403);

  const owner = await broker(OWNER);
  const rule = {
    rule_name: "Low compliance",
    trigger_type: "compliance_issue",
    trigger_conditions: { score_value: 80, severity_levels: ["critical"], injected: "x" },
    action_type: "create_task",
    action_config: { task_priority: "high", due_in_days: 3, task_type: "followup", webhook: "https://evil.example" },
    created_by: "spoof@example.com",
  };
  const saved = await owner.call({ action: "save_rule", rule });
  assert.equal(saved.status, 200);
  const [stored] = owner.state.OASISAutomationRule;
  assert.equal(stored.created_by, "owner@example.com");
  assert.deepEqual(stored.trigger_conditions, { score_value: 80 });
  assert.equal(stored.action_config.webhook, undefined);
  assert.equal((await owner.call({ action: "save_rule", rule: { ...rule, action_type: "schedule_reassessment" } })).status, 400);
  assert.equal((await owner.call({ action: "save_rule", rule: { ...rule, trigger_type: "revenue_opportunity" } })).status, 400);
});

test("a workflow runs on the server against the stored analysis, once per upload and rule", async () => {
  const state = baseState();
  state.OASISAutomationRule.push({
    id: "r1", rule_name: "Low compliance", trigger_type: "compliance_issue", is_active: true,
    trigger_conditions: { score_value: 80 }, action_type: "create_task", action_config: { task_priority: "high", due_in_days: 2 },
  });
  state.OASISUpload.push(upload("up1", "ag1", "p1", "rn@example.com", { analysis_results: analysis({ compliance_score: 55 }) }));
  state.OASISUpload.push(upload("up2", "ag1", "p2", "other@example.com", { analysis_results: analysis({ compliance_score: 10 }) }));
  const { call } = await broker(NURSE, state);

  // The body's analysis is ignored: the stored one decides.
  const first = await call({ action: "execute_workflows", upload_id: "up1", analysis_results: { compliance_score: 99 } });
  assert.equal(first.status, 200);
  assert.equal(first.json.results.length, 1);
  assert.equal(first.json.results[0].status, "completed");
  assert.equal(state.Task.length, 1);
  assert.equal(state.Task[0].assigned_to, "rn@example.com");
  assert.equal(state.OASISWorkflowExecution.length, 1);
  assert.equal(state.OASISWorkflowExecution[0].run_id, "up1:r1");

  const again = await call({ action: "execute_workflows", upload_id: "up1" });
  assert.equal(again.json.results[0].already_executed, true);
  assert.equal(state.Task.length, 1, "a re-run reports the first run instead of acting twice");

  // A chart she cannot open, on an upload she did not write: not visible at all.
  assert.equal((await call({ action: "execute_workflows", upload_id: "up2" })).status, 404);
  assert.equal(state.Task.length, 1);
});

test("feedback is stamped from the session and a patient id is a chart the caller may open", async () => {
  const { call, state } = await broker(NURSE);
  const ok = await call({ action: "record_feedback", feedback: { oasis_upload_id: "an-1", feedback_type: "correct_match", actual_patient_id: "p1", created_by: "x@example.com" } });
  assert.equal(ok.status, 200);
  assert.equal(state.OASISFeedback[0].created_by, "rn@example.com");
  assert.equal((await call({ action: "record_feedback", feedback: { actual_patient_id: "p3" } })).status, 403);
  assert.equal(state.OASISFeedback.length, 1);
});

test("the compliance report and the agency list answer only for the caller's scope", async () => {
  const state = baseState();
  state.OASISAssessment.push(
    { id: "oa1", agency_id: "ag1", patient_id: "p1", visit_type: "Start of Care", status: "completed", assessment_date: "2026-10-01", oasis_items: [{ response_value: { code: "2" } }] },
    { id: "oa2", agency_id: "ag1", patient_id: "p2", visit_type: "Discharge", status: "draft", assessment_date: "2026-10-02" },
    { id: "oa3", agency_id: "ag2", patient_id: "p3", visit_type: "Discharge", status: "draft", assessment_date: "2026-10-02" },
  );
  const nurse = await broker(NURSE, state);
  const mine = await nurse.call({ action: "assessment_report" });
  assert.deepEqual(mine.json.assessments.map((row) => row.id), ["oa1"]);
  assert.equal(mine.json.assessments[0].oasis_items, undefined, "no response value leaves the report");
  const manager = await broker(MANAGER, state);
  assert.deepEqual((await manager.call({ action: "assessment_report" })).json.assessments.map((row) => row.id).sort(), ["oa1", "oa2"]);

  assert.deepEqual((await nurse.call({ action: "list_agencies" })).json.agencies, [{ id: "ag1", name: "Maple Home Health" }]);
  const owner = await broker(OWNER, state);
  assert.deepEqual((await owner.call({ action: "list_agencies" })).json.agencies.map((row) => row.id).sort(), ["ag1", "ag2"]);
});

test("listOASISUploads scopes saved analyses by role, chart and agency, and strips money fields", async () => {
  const state = baseState();
  state.OASISUpload.push(
    upload("own", "ag1", null, "rn@example.com"),
    upload("onChart", "ag1", "p1", "other@example.com"),
    upload("offChart", "ag1", "p2", "other@example.com"),
    upload("foreign", "ag2", "p3", "out@example.com"),
  );
  const ids = (result) => result.json.uploads.map((row) => row.id).sort();

  const nurse = await load("listOASISUploads", { user: NURSE, state });
  const nurseList = await nurse.call({});
  assert.deepEqual(ids(nurseList), ["onChart", "own"]);
  assert.equal(nurseList.json.uploads[0].analysis_results.revenue_uplift, undefined);
  assert.equal(nurseList.json.uploads[0].analysis_results.nested.estimated_payment, undefined);

  const manager = await load("listOASISUploads", { user: MANAGER, state });
  assert.deepEqual(ids(await manager.call({})), ["offChart", "onChart", "own"]);

  const outsider = await load("listOASISUploads", { user: OUTSIDER, state });
  assert.deepEqual(ids(await outsider.call({})), ["foreign"], "an ag2 clinician claiming ag1 admin sees only ag2's own");

  const owner = await load("listOASISUploads", { user: OWNER, state });
  assert.deepEqual(ids(await owner.call({})), ["foreign", "offChart", "onChart", "own"]);

  const anonymous = await load("listOASISUploads", { user: null, state });
  assert.equal((await anonymous.call({})).status, 401);
});

test("listOASISUploads keeps a clinician's scope even when the store ignores a filter", async () => {
  const state = baseState();
  state.OASISUpload.push(
    upload("onChart", "ag1", "p1", "other@example.com"),
    upload("offChart", "ag1", "p2", "other@example.com"),
    upload("foreign", "ag2", "p3", "out@example.com"),
  );
  const nurse = await load("listOASISUploads", { user: NURSE, state, leaky: ["OASISUpload"] });
  assert.deepEqual((await nurse.call({})).json.uploads.map((row) => row.id), ["onChart"]);
  const manager = await load("listOASISUploads", { user: MANAGER, state, leaky: ["OASISUpload"] });
  assert.deepEqual((await manager.call({})).json.uploads.map((row) => row.id).sort(), ["offChart", "onChart"]);
});
