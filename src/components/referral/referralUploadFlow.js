/**
 * Orchestrates one referral document upload, as plain data in / result out.
 *
 * The Referral Intake upload handler used to run validation, the upload, and the
 * AI quick scan inside a single `try` with a single `catch` that reported every
 * failure as "Failed to upload file. Please try again." That message was wrong
 * for the most common failure by far: the file uploads fine and the *AI
 * pre-fill* fails (LLM timeout on a long scanned fax, rate limit, credit limit).
 * The user then re-uploaded the same file, it uploaded fine again, the scan
 * failed again, and the message never changed.
 *
 * The work runs in three steps that fail for different reasons, and the result
 * shape says which:
 *   - validation — the file itself is unusable; nothing was sent. Returns
 *     `{ ok: false, failedAt: "validate" }`.
 *   - upload — fatal; there is no document to attach to a referral. Returns
 *     `{ ok: false, failedAt: "upload" }`.
 *   - quick scan — NOT fatal, so it is deliberately absent from
 *     REFERRAL_UPLOAD_STAGES and never appears in `failedAt`. The document is
 *     stored and the user can type the handful of intake fields themselves, so
 *     it returns `{ ok: true, scan: null, scanMessage, scanError }` and the
 *     caller shows `scanMessage` as a warning rather than an upload failure.
 *     The full clinical extraction runs later, at processing time.
 *
 * Kept free of React and the Base44 SDK (the upload and scan calls are injected)
 * so it is unit-testable in isolation, matching referralUploadUtils.js and
 * referralExtraction.js.
 */

import { validateReferralFile, getDocumentType } from "./referralUploadUtils.js";
import { uploadFailureMessage, MISSING_FILE_URL_MESSAGE } from "../../lib/uploadError.js";

/**
 * The stages that can produce a failed result, i.e. the only values `failedAt`
 * ever takes. A quick-scan failure is not one of them — see the header.
 */
export const REFERRAL_UPLOAD_STAGES = Object.freeze({
  VALIDATE: "validate",
  UPLOAD: "upload",
});

/**
 * Why the AI pre-fill didn't run. The upload succeeded in every one of these
 * cases, so the copy must say so — otherwise the user re-uploads a file that is
 * already stored.
 */
export function quickScanFailureMessage(error) {
  const timedOut = error?.code === "AI_TIMEOUT";
  return timedOut
    ? "Document uploaded. AI pre-fill timed out on this document — enter the referral details below and continue; the full extraction runs when you process the referral."
    : "Document uploaded. AI pre-fill couldn't read this document — enter the referral details below and continue; the full extraction runs when you process the referral.";
}

/**
 * Upload a referral document and (for non-PDFs) quick-scan it for form pre-fill.
 *
 * @param {object} args
 * @param {File} args.file - The picked file.
 * @param {(file: File) => Promise<{file_url?: string}>} args.uploadFile - Injected uploader.
 * @param {(fileUrl: string) => Promise<object>} args.quickScan - Injected AI quick scan.
 * @returns {Promise<
 *   | { ok: false, failedAt: string, message: string, error?: unknown }
 *   | { ok: true, fileUrl: string, documentType: string, needsMultiReferralSplit: boolean,
 *       scan: object|null, scanMessage: string|null, scanError?: unknown }
 * >}
 */
export async function runReferralUpload({ file, uploadFile, quickScan }) {
  const { valid, error: validationError } = validateReferralFile(file);
  if (!valid) {
    return { ok: false, failedAt: REFERRAL_UPLOAD_STAGES.VALIDATE, message: validationError };
  }

  let fileUrl;
  try {
    const result = await uploadFile(file);
    fileUrl = result?.file_url;
  } catch (error) {
    return {
      ok: false,
      failedAt: REFERRAL_UPLOAD_STAGES.UPLOAD,
      message: uploadFailureMessage(error, { noun: "referral document" }),
      error,
    };
  }

  if (!fileUrl) {
    return {
      ok: false,
      failedAt: REFERRAL_UPLOAD_STAGES.UPLOAD,
      message: MISSING_FILE_URL_MESSAGE,
    };
  }

  // Classify from the file rather than the browser-reported MIME alone, so PDFs
  // from scanners/fax servers that leave `file.type` empty still take the
  // multi-referral path.
  const documentType = getDocumentType(file);

  // A PDF may bundle several patients' referrals, so it goes to the split
  // detector instead of the single-document quick scan — the detector reads the
  // document and the user confirms the split.
  if (documentType === "pdf") {
    return {
      ok: true,
      fileUrl,
      documentType,
      needsMultiReferralSplit: true,
      scan: null,
      scanMessage: null,
    };
  }

  try {
    const scan = await quickScan(fileUrl);
    return {
      ok: true,
      fileUrl,
      documentType,
      needsMultiReferralSplit: false,
      scan: scan || null,
      scanMessage: null,
    };
  } catch (scanError) {
    // Deliberately a success result: the document is stored and attachable.
    return {
      ok: true,
      fileUrl,
      documentType,
      needsMultiReferralSplit: false,
      scan: null,
      scanMessage: quickScanFailureMessage(scanError),
      scanError,
    };
  }
}
