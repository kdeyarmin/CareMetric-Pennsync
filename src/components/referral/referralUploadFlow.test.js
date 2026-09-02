import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runReferralUpload,
  quickScanFailureMessage,
  REFERRAL_UPLOAD_STAGES,
} from "./referralUploadFlow.js";

// Minimal File stand-in: the flow only reads name/type/size.
const fakeFile = ({ name = "referral.tiff", type = "image/tiff", size = 1024 } = {}) => ({
  name,
  type,
  size,
});

const okUpload = (fileUrl = "https://files/referral.tiff") => async () => ({ file_url: fileUrl });
const failUpload = (error) => async () => { throw error; };
const okScan = (value = { patient_name: "Jane Doe" }) => async () => value;
const failScan = (error) => async () => { throw error; };

test("rejects an invalid file before anything is sent to the server", async () => {
  let uploadCalls = 0;
  const result = await runReferralUpload({
    file: fakeFile({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    uploadFile: async () => { uploadCalls += 1; return { file_url: "x" }; },
    quickScan: okScan(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedAt, REFERRAL_UPLOAD_STAGES.VALIDATE);
  assert.match(result.message, /Unsupported file type/);
  assert.equal(uploadCalls, 0);
});

test("an upload failure is fatal and carries an actionable, non-generic message", async () => {
  const error = Object.assign(new Error("nope"), { status: 401 });
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: failUpload(error),
    quickScan: okScan(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedAt, REFERRAL_UPLOAD_STAGES.UPLOAD);
  assert.match(result.message, /session has expired/i);
  assert.equal(result.error, error);
});

test("a 2xx response with no file_url is treated as an upload failure, not a success", async () => {
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: async () => ({}),
    quickScan: okScan(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedAt, REFERRAL_UPLOAD_STAGES.UPLOAD);
  assert.match(result.message, /no file link/i);
});

test("an image upload runs the quick scan and returns its data", async () => {
  const scanned = [];
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: okUpload("https://files/fax.tiff"),
    quickScan: async (url) => { scanned.push(url); return { patient_name: "Jane Doe" }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileUrl, "https://files/fax.tiff");
  assert.equal(result.documentType, "image");
  assert.equal(result.needsMultiReferralSplit, false);
  assert.deepEqual(result.scan, { patient_name: "Jane Doe" });
  assert.equal(result.scanMessage, null);
  assert.deepEqual(scanned, ["https://files/fax.tiff"]);
});

// The bug this module exists for: the file uploads fine, the AI pre-fill fails,
// and the user is told the *upload* failed and to try again — forever.
test("a quick-scan failure is NOT an upload failure: the file URL survives", async () => {
  const scanError = new Error("model unavailable");
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: okUpload("https://files/fax.tiff"),
    quickScan: failScan(scanError),
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileUrl, "https://files/fax.tiff");
  assert.equal(result.scan, null);
  assert.equal(result.scanError, scanError);
  assert.match(result.scanMessage, /Document uploaded/);
  assert.doesNotMatch(result.scanMessage, /Failed to upload/i);
});

// A quick-scan failure is deliberately not a stage: it can never be reported as
// a failed upload, and `failedAt` must stay limited to the two fatal steps.
test("only the fatal steps are stages, and a scan failure carries no failedAt", async () => {
  assert.deepEqual(Object.values(REFERRAL_UPLOAD_STAGES).sort(), ["upload", "validate"]);

  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: okUpload(),
    quickScan: failScan(new Error("model unavailable")),
  });

  assert.equal(result.ok, true);
  assert.equal("failedAt" in result, false);
});

test("a timed-out quick scan says it timed out rather than blaming the upload", async () => {
  const timeout = Object.assign(new Error("AI request timed out"), { code: "AI_TIMEOUT" });
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: okUpload(),
    quickScan: failScan(timeout),
  });

  assert.equal(result.ok, true);
  assert.match(result.scanMessage, /timed out/i);
  assert.match(quickScanFailureMessage(timeout), /timed out/i);
  assert.doesNotMatch(quickScanFailureMessage(new Error("other")), /timed out/i);
});

test("both quick-scan messages tell the user the document is stored and what happens next", () => {
  for (const err of [new Error("boom"), Object.assign(new Error("t"), { code: "AI_TIMEOUT" })]) {
    const message = quickScanFailureMessage(err);
    assert.match(message, /Document uploaded/);
    assert.match(message, /full extraction runs when you process the referral/);
  }
});

test("a PDF skips the quick scan and is routed to the multi-referral split", async () => {
  let scanCalls = 0;
  const result = await runReferralUpload({
    file: fakeFile({ name: "batch.pdf", type: "application/pdf" }),
    uploadFile: okUpload("https://files/batch.pdf"),
    quickScan: async () => { scanCalls += 1; return {}; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.documentType, "pdf");
  assert.equal(result.needsMultiReferralSplit, true);
  assert.equal(result.scanMessage, null);
  assert.equal(scanCalls, 0);
});

test("a type-less scanner PDF is classified from its extension, not the empty MIME", async () => {
  const result = await runReferralUpload({
    file: fakeFile({ name: "scan.pdf", type: "" }),
    uploadFile: okUpload(),
    quickScan: okScan(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.documentType, "pdf");
  assert.equal(result.needsMultiReferralSplit, true);
});

test("a scan that resolves with nothing is normalized to null rather than undefined", async () => {
  const result = await runReferralUpload({
    file: fakeFile(),
    uploadFile: okUpload(),
    quickScan: async () => undefined,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scan, null);
  assert.equal(result.scanMessage, null);
});
