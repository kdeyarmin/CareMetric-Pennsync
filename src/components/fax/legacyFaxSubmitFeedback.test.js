import test from "node:test";
import assert from "node:assert/strict";
import {
  FAX_ORIGINATION_UNAVAILABLE,
  FAX_ORIGINATION_UNVERIFIED,
} from "./faxOrigination.js";
import {
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

test("announceLegacyFaxSubmit does not throw when toast.warning is missing", () => {
  const toast = { success: () => {} };
  assert.doesNotThrow(() => announceLegacyFaxSubmit(toast, {
    origination_warning: FAX_ORIGINATION_UNVERIFIED,
  }));
});
