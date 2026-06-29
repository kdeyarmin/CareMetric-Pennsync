/**
 * Pure helpers for validating and classifying referral document uploads.
 *
 * Kept free of React and the Base44 SDK so they can be unit-tested in isolation
 * (see referralUploadUtils.test.js) and shared between the ReferralPDFSummarizer
 * component and the ReferralIntake page, which previously validated uploads with
 * slightly different, duplicated logic.
 */

// Maximum referral file size. Fax/scan PDFs are occasionally large, but anything
// past this is almost always a multi-patient batch or a corrupt file, and the
// extraction LLM call would time out before completing.
export const MAX_REFERRAL_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// MIME types we accept for referral documents (PDFs + common fax/scan formats).
export const ACCEPTED_REFERRAL_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
];

// File extensions accepted, used for the <input accept> attribute and as a
// fallback when the browser reports an empty `file.type` (common for TIFF).
export const ACCEPTED_REFERRAL_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".tif",
];

// Convenience string for an <input type="file" accept="..."> attribute.
export const REFERRAL_ACCEPT_ATTR = ACCEPTED_REFERRAL_EXTENSIONS.join(",");

const EXTENSION_MIME_FALLBACK = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  tif: "image/tiff",
};

/** Lower-cased file extension without the dot, or "" when there is none. */
export function getFileExtension(name = "") {
  const match = /\.([a-z0-9]+)$/i.exec(String(name).trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Resolve a usable MIME type for a File. Browsers sometimes leave `file.type`
 * empty (common with TIFFs produced by scanners and fax servers), so fall back
 * to mapping the file extension.
 */
export function resolveMimeType(file) {
  if (!file) return "";
  if (file.type) return file.type.toLowerCase();
  return EXTENSION_MIME_FALLBACK[getFileExtension(file.name)] || "";
}

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * Map a File to the Referral entity `document_type` enum value ("pdf" | "image").
 */
export function getDocumentType(file) {
  const mime = resolveMimeType(file);
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "pdf";
}

/**
 * Whether a File looks like a scanned/faxed image (vs. a native PDF). Used to
 * give the extraction model OCR-aware context.
 */
export function isImageReferral(file) {
  return resolveMimeType(file).startsWith("image/");
}

/**
 * Validate a referral upload candidate against accepted types and size limits.
 * Returns `{ valid: boolean, error: string|null }` so callers can surface a
 * single, user-friendly message.
 */
export function validateReferralFile(file, { maxBytes = MAX_REFERRAL_FILE_BYTES } = {}) {
  if (!file) return { valid: false, error: "No file selected." };

  // resolveMimeType already falls back to the extension *only* when the browser
  // reports an empty file.type, so checking the resolved type both supports
  // type-less scanner/fax uploads and still rejects files whose browser-reported
  // MIME is a concrete unsupported type (e.g. a .docx renamed to .pdf).
  const mime = resolveMimeType(file);
  if (!ACCEPTED_REFERRAL_MIME_TYPES.includes(mime)) {
    return {
      valid: false,
      error:
        "Unsupported file type. Upload a PDF, PNG, JPG, or TIFF (common fax/scan formats).",
    };
  }

  if (typeof file.size === "number") {
    if (file.size === 0) {
      return { valid: false, error: "This file appears to be empty." };
    }
    if (file.size > maxBytes) {
      return {
        valid: false,
        error: `File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(maxBytes)}.`,
      };
    }
  }

  return { valid: true, error: null };
}
