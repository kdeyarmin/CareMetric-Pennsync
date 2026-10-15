import test from "node:test";
import assert from "node:assert/strict";
import {
  FAX_ORIGINATION_UNAVAILABLE,
  FAX_ORIGINATION_UNVERIFIED,
} from "./faxOrigination.js";
import {
  LEGACY_FAX_SUBMISSION_DETAIL,
  LEGACY_FAX_SUBMITTED_TOAST,
  announceLegacyFaxSubmit,
  legacyFaxOriginationWarning,
} from "./legacyFaxSubmitFeedback.js";

test("origination warning copy is category-exact and silent on unknown codes", () => {
  assert.match(legacyFaxOriginationWarning(FAX_ORIGINATION_UNVERIFIED), /not verified/i);
  assert.match(legacyFaxOriginationWarning(FAX_ORIGINATION_UNAVAILABLE), /Could not confirm/i);
  assert.equal(legacyFaxOriginationWarning(undefined), null);
  assert.equal(legacyFaxOriginationWarning("something_else"), null);
});

test("announceLegacyFaxSubmit always success-toasts the submitted copy", () => {
  const calls = [];
  const toast = {
    success: (msg) => calls.push(["success", msg]),
    warning: (msg) => calls.push(["warning", msg]),
  };
  announceLegacyFaxSubmit(toast, { success: true });
  assert.deepEqual(calls, [["success", LEGACY_FAX_SUBMITTED_TOAST]]);
  assert.match(LEGACY_FAX_SUBMITTED_TOAST, /submitted/i);
  assert.doesNotMatch(LEGACY_FAX_SUBMITTED_TOAST, /sent successfully|delivery is tracked/i);
});

test("announceLegacyFaxSubmit warns when Telnyx returned an origination category", () => {
  const calls = [];
  const toast = {
    success: (msg) => calls.push(["success", msg]),
    warning: (msg) => calls.push(["warning", msg]),
  };
  announceLegacyFaxSubmit(toast, {
    success: true,
    origination_warning: FAX_ORIGINATION_UNVERIFIED,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "success");
  assert.equal(calls[1][0], "warning");
  assert.match(calls[1][1], /blind line/i);
});

test("durable submission detail copy stays honest about untracked delivery", () => {
  // The durable confirmation (LegacyFaxSubmissionNotice) must never upgrade
  // a legacy submit into a delivery claim: it hands off to Telnyx, delivery
  // is not tracked in-app, and the fax log entry stays "Sending".
  assert.match(LEGACY_FAX_SUBMISSION_DETAIL, /Telnyx/);
  assert.match(LEGACY_FAX_SUBMISSION_DETAIL, /not tracked to delivery inside PennSync/i);
  assert.match(LEGACY_FAX_SUBMISSION_DETAIL, /stays "Sending"/);
  assert.doesNotMatch(LEGACY_FAX_SUBMISSION_DETAIL, /was delivered|has been delivered|delivery is tracked/i);
});

test("announceLegacyFaxSubmit does not throw when toast.warning is missing", () => {
  const toast = { success: () => {} };
  assert.doesNotThrow(() => announceLegacyFaxSubmit(toast, {
    origination_warning: FAX_ORIGINATION_UNVERIFIED,
  }));
});
