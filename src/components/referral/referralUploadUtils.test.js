import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REFERRAL_FILE_BYTES,
  ACCEPTED_REFERRAL_EXTENSIONS,
  REFERRAL_ACCEPT_ATTR,
  getFileExtension,
  resolveMimeType,
  formatBytes,
  getDocumentType,
  isImageReferral,
  validateReferralFile,
} from "./referralUploadUtils.js";

// Minimal File-like stub (the helpers only read name/type/size).
const fakeFile = (name, type, size = 1024) => ({ name, type, size });

test("getFileExtension extracts lower-cased extension", () => {
  assert.equal(getFileExtension("Referral.PDF"), "pdf");
  assert.equal(getFileExtension("scan.final.TIFF"), "tiff");
  assert.equal(getFileExtension("no-extension"), "");
  assert.equal(getFileExtension(""), "");
});

test("resolveMimeType prefers file.type then falls back to extension", () => {
  assert.equal(resolveMimeType(fakeFile("a.pdf", "application/pdf")), "application/pdf");
  // Scanners/fax servers often leave type empty for TIFF.
  assert.equal(resolveMimeType(fakeFile("fax.tiff", "")), "image/tiff");
  assert.equal(resolveMimeType(fakeFile("photo.JPG", "")), "image/jpeg");
  assert.equal(resolveMimeType(fakeFile("mystery.xyz", "")), "");
  assert.equal(resolveMimeType(null), "");
});

test("formatBytes renders human-readable sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(25 * 1024 * 1024), "25 MB");
});

test("getDocumentType / isImageReferral classify documents", () => {
  assert.equal(getDocumentType(fakeFile("a.pdf", "application/pdf")), "pdf");
  assert.equal(getDocumentType(fakeFile("fax.tiff", "")), "image");
  assert.equal(getDocumentType(fakeFile("x.png", "image/png")), "image");
  assert.equal(isImageReferral(fakeFile("a.pdf", "application/pdf")), false);
  assert.equal(isImageReferral(fakeFile("fax.tiff", "")), true);
});

test("validateReferralFile accepts supported types", () => {
  assert.deepEqual(validateReferralFile(fakeFile("a.pdf", "application/pdf")), {
    valid: true,
    error: null,
  });
  // Empty type but valid extension still passes (TIFF fax case).
  assert.equal(validateReferralFile(fakeFile("fax.tiff", "")).valid, true);
});

test("validateReferralFile rejects unsupported types", () => {
  const res = validateReferralFile(fakeFile("notes.docx", "application/msword"));
  assert.equal(res.valid, false);
  assert.match(res.error, /Unsupported file type/);
});

test("validateReferralFile rejects a concrete bad MIME even with an accepted extension", () => {
  // A Word doc renamed to .pdf reports a real, unsupported MIME — the extension
  // fallback must only apply when file.type is empty, not override a known type.
  const res = validateReferralFile(fakeFile("evil.pdf", "application/msword"));
  assert.equal(res.valid, false);
  assert.match(res.error, /Unsupported file type/);
});

test("validateReferralFile rejects empty and oversized files", () => {
  assert.match(validateReferralFile(fakeFile("a.pdf", "application/pdf", 0)).error, /empty/);

  const tooBig = validateReferralFile(
    fakeFile("a.pdf", "application/pdf", MAX_REFERRAL_FILE_BYTES + 1),
  );
  assert.equal(tooBig.valid, false);
  assert.match(tooBig.error, /too large/);
});

test("validateReferralFile handles a missing file", () => {
  assert.deepEqual(validateReferralFile(null), { valid: false, error: "No file selected." });
});

test("validateReferralFile honors a custom maxBytes", () => {
  const res = validateReferralFile(fakeFile("a.pdf", "application/pdf", 2048), { maxBytes: 1024 });
  assert.equal(res.valid, false);
  assert.match(res.error, /too large/);
});

test("exports expose accept attribute and extension list", () => {
  assert.ok(ACCEPTED_REFERRAL_EXTENSIONS.includes(".pdf"));
  assert.ok(REFERRAL_ACCEPT_ATTR.includes(".tiff"));
});
