import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePages, summarizePacketVerification, toPersistedVerification } from "./adrPacketReview.js";
import { buildAdrChecklist } from "./adrRequirements.js";

const checklist = buildAdrChecklist({
  letterItems: [
    { text: "Signed plan of care (CMS-485)" },
    { text: "Face-to-face encounter documentation" },
  ],
  auditType: "mac_adr",
});

const idOf = (summary, id) => summary.items.find((it) => it.id === id);

// ── sanitizePages ──

test("sanitizePages clamps, dedupes, sorts, and rejects junk", () => {
  assert.deepEqual(sanitizePages([3, 1, 3, 99, 0, -2, 2.5, "7", null], 10), [1, 3, 7]);
  assert.deepEqual(sanitizePages([1, 2], 0), []);
  assert.deepEqual(sanitizePages(undefined, 10), []);
  assert.deepEqual(sanitizePages([5], 4), []);
});

// ── summarizePacketVerification ──

test("normalizes statuses and clamps AI page references to the packet", () => {
  const summary = summarizePacketVerification({
    checklist,
    pageCount: 20,
    verification: {
      items: [
        { id: "plan_of_care", status: "found", pages: [4, 999], evidence: "CMS-485 signed 2026-01-10" },
        { id: "face_to_face", status: "banana", pages: [2] },
      ],
    },
  });
  const poc = idOf(summary, "plan_of_care");
  assert.equal(poc.status, "found");
  assert.deepEqual(poc.pages, [4]);
  assert.equal(idOf(summary, "face_to_face").status, "missing", "unknown status fails closed");
});

test("found without verifiable pages is downgraded to partial", () => {
  const summary = summarizePacketVerification({
    checklist,
    pageCount: 20,
    verification: { items: [{ id: "plan_of_care", status: "found", pages: [] }] },
  });
  assert.equal(idOf(summary, "plan_of_care").status, "partial");
});

test("checklist items the AI never reported fail closed with a manual-verify follow-up", () => {
  const summary = summarizePacketVerification({ checklist, pageCount: 20, verification: { items: [] } });
  const oasis = idOf(summary, "oasis_assessment");
  assert.equal(oasis.status, "missing");
  assert.equal(oasis.reviewed, false);
  assert.ok(oasis.issues.some((i) => /verify manually/i.test(i.problem)));
  const fu = summary.follow_ups.find((f) => f.item_id === "oasis_assessment");
  assert.match(fu.why, /did not cover/);
});

test("AI entries for unknown checklist ids are ignored", () => {
  const summary = summarizePacketVerification({
    checklist,
    pageCount: 20,
    verification: { items: [{ id: "not_a_rule", status: "found", pages: [1] }] },
  });
  assert.ok(!summary.items.some((it) => it.id === "not_a_rule"));
});

test("missing critical items block readiness; clean packets are ready", () => {
  const allFound = {
    items: checklist.map((it, i) => ({ id: it.id, status: "found", pages: [i + 1], evidence: "ok" })),
  };
  const ready = summarizePacketVerification({ checklist, pageCount: 50, verification: allFound });
  assert.equal(ready.readiness.level, "ready");
  assert.equal(ready.readiness.score, 100);
  assert.equal(ready.follow_ups.length, 0);

  const withMissing = {
    items: checklist.map((it, i) =>
      it.id === "face_to_face"
        ? { id: it.id, status: "missing", pages: [] }
        : { id: it.id, status: "found", pages: [i + 1] }
    ),
  };
  const blocked = summarizePacketVerification({ checklist, pageCount: 50, verification: withMissing });
  assert.equal(blocked.readiness.level, "not_ready");
  assert.ok(blocked.readiness.blocking.some((b) => b.id === "face_to_face" && b.reason === "missing"));
  assert.ok(blocked.readiness.score < 100);
});

test("critical issues on a found critical item still block", () => {
  const verification = {
    items: checklist.map((it, i) => ({
      id: it.id,
      status: "found",
      pages: [i + 1],
      issues:
        it.id === "plan_of_care"
          ? [{ severity: "critical", problem: "POC signed after the claim was billed", page: 4 }]
          : [],
    })),
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 50, verification });
  assert.equal(summary.readiness.level, "not_ready");
  assert.ok(summary.readiness.blocking.some((b) => b.id === "plan_of_care" && b.reason === "critical_issue"));
  const fu = summary.follow_ups.find((f) => f.item_id === "plan_of_care");
  assert.match(fu.action, /signed after the claim/);
  assert.match(fu.why, /page 4/);
});

test("follow-ups sort critical first", () => {
  const verification = {
    items: checklist.map((it, i) => ({
      id: it.id,
      status: it.id === "signature_attestation" || it.id === "face_to_face" ? "missing" : "found",
      pages: it.id === "signature_attestation" || it.id === "face_to_face" ? [] : [i + 1],
    })),
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 50, verification });
  const severities = summary.follow_ups.map((f) => f.severity);
  const rank = { critical: 0, high: 1, medium: 2 };
  for (let i = 1; i < severities.length; i++) {
    assert.ok(rank[severities[i - 1]] <= rank[severities[i]], "follow-ups must be severity-sorted");
  }
});

test("toc lists located items in packet order then unlocated, and key pages skip medium severity", () => {
  const verification = {
    items: [
      { id: "face_to_face", status: "found", pages: [12] },
      { id: "plan_of_care", status: "found", pages: [3, 4] },
      { id: "claim_copy", status: "found", pages: [1] }, // medium severity
    ],
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 30, verification });
  assert.equal(summary.toc[0].item_id, "claim_copy");
  assert.equal(summary.toc[0].packet_page, 1);
  assert.equal(summary.toc[1].item_id, "plan_of_care");
  assert.equal(summary.toc[1].packet_page, 3);
  assert.equal(summary.toc[2].item_id, "face_to_face");
  assert.ok(summary.toc.slice(3).every((t) => t.packet_page === null));

  const keyPageNumbers = summary.key_pages.map((k) => k.packet_page);
  assert.deepEqual(keyPageNumbers, [3, 12], "medium-severity claim_copy page must not be a key page");
  assert.match(summary.key_pages[0].labels[0], /Plan of care/i);
  assert.match(summary.key_pages[0].labels[0], /42 CFR/);
});

test("multiple key items on the same page share one frame entry", () => {
  const verification = {
    items: [
      { id: "plan_of_care", status: "found", pages: [3] },
      { id: "physician_orders_interim", status: "found", pages: [3] },
    ],
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 30, verification });
  const page3 = summary.key_pages.find((k) => k.packet_page === 3);
  assert.equal(page3.labels.length, 2);
});

test("not_applicable is honored for conditional baseline items and never blocks readiness", () => {
  // recertification is conditional ("if the billed period is a recertification
  // period") and cms_baseline here — a legitimate N/A on an initial episode.
  const verification = {
    items: checklist.map((it, i) =>
      it.when !== "always" && it.source === "cms_baseline"
        ? { id: it.id, status: "not_applicable", na_reason: "Initial episode; service not billed", pages: [] }
        : { id: it.id, status: "found", pages: [i + 1] }
    ),
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 50, verification });
  const recert = idOf(summary, "recertification");
  assert.equal(recert.status, "not_applicable");
  assert.equal(recert.na_reason, "Initial episode; service not billed");
  assert.ok(summary.na_count > 0);
  assert.equal(summary.missing_count, 0);
  assert.equal(summary.readiness.level, "ready", "waived conditional items must not block readiness");
  assert.equal(summary.readiness.score, 100, "N/A items must not be penalized");
  assert.equal(summary.follow_ups.length, 0);
  // N/A items never become key pages even if pages were reported.
  assert.ok(!summary.key_pages.some((k) => k.labels.some((l) => /Recertification/i.test(l))));
});

test("not_applicable on always-required or letter-requested items fails closed to missing", () => {
  const verification = {
    items: checklist.map((it, i) =>
      it.id === "face_to_face" || it.id === "plan_of_care"
        ? { id: it.id, status: "not_applicable", na_reason: "n/a" }
        : { id: it.id, status: "found", pages: [i + 1] }
    ),
  };
  const summary = summarizePacketVerification({ checklist, pageCount: 50, verification });
  // face_to_face is always-required baseline; plan_of_care was letter-requested.
  for (const id of ["face_to_face", "plan_of_care"]) {
    const item = idOf(summary, id);
    assert.equal(item.status, "missing", `${id} must fail closed`);
    assert.ok(item.issues.some((i) => /marked this not applicable/.test(i.problem)));
  }
  assert.equal(summary.readiness.level, "not_ready");
});

test("overall observations and unreadable pages are sanitized", () => {
  const summary = summarizePacketVerification({
    checklist,
    pageCount: 10,
    verification: {
      items: [],
      overall_observations: ["Pages out of order", "", 42],
      unreadable_pages: [2, 99],
      confidence: 340,
    },
  });
  assert.deepEqual(summary.overall_observations, ["Pages out of order"]);
  assert.deepEqual(summary.unreadable_pages, [2]);
  assert.equal(summary.ai_confidence, 100);
});

test("toPersistedVerification keeps the fields the generator and UI consume", () => {
  const summary = summarizePacketVerification({ checklist, pageCount: 10, verification: { items: [] } });
  const persisted = toPersistedVerification(summary);
  for (const key of ["readiness", "items", "follow_ups", "toc", "key_pages", "missing_count", "page_count"]) {
    assert.ok(key in persisted, `missing ${key}`);
  }
});

// ── missing items never carry page references (regression) ──

test("a 'missing' verdict clears AI-supplied pages — no TOC ref, no key frame", () => {
  // Regression: {status:"missing", pages:[5]} produced a TOC row citing page 5
  // and a red KEY ITEM frame — pointing the Medicare reviewer at "evidence"
  // the verification itself says is absent.
  const summary = summarizePacketVerification({
    checklist,
    pageCount: 20,
    verification: {
      items: [{ id: "plan_of_care", status: "missing", pages: [5] }],
    },
  });
  const poc = idOf(summary, "plan_of_care");
  assert.equal(poc.status, "missing");
  assert.deepEqual(poc.pages, []);
  const tocRow = summary.toc.find((t) => t.item_id === "plan_of_care");
  assert.equal(tocRow.packet_page, null);
  assert.ok(!summary.key_pages.some((k) => k.packet_page === 5 && k.labels.some((l) => /plan of care/i.test(l))));
});

test("a letter-requested document that is missing blocks readiness", () => {
  // A contractor-named item is never severity "critical" by catalog accident —
  // but omitting it invites denial, so it must hard-block, not just warn.
  const letterOnly = buildAdrChecklist({
    letterItems: [{ text: "Signed wound photography disclaimer form" }],
    auditType: "mac_adr",
  });
  const target = letterOnly.find((it) => it.source === "letter");
  assert.ok(target, "expected an unmatched letter-only checklist row");
  const summary = summarizePacketVerification({
    checklist: letterOnly,
    pageCount: 10,
    verification: {
      items: letterOnly.map((it) => ({
        id: it.id,
        status: it.id === target.id ? "missing" : "found",
        pages: it.id === target.id ? [] : [1],
      })),
    },
  });
  assert.ok(summary.readiness.blocking.some((b) => b.id === target.id && b.reason === "missing_letter_item"));
  assert.equal(summary.readiness.level, "not_ready");
});
