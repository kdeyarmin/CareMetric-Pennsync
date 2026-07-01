import { generateTrainingCertificate } from "@/functions/generateTrainingCertificate";

/**
 * Generate a training certificate PDF and return an object URL for it (open in a
 * new tab, print, or download). Canonical replacement for the identical helper
 * the transcript/education dashboards each defined locally under different names.
 *
 * Callers own the returned URL's lifecycle and should `URL.revokeObjectURL(url)`
 * when done.
 *
 * @param {{ course_title?: string, completion_date?: string, issued_at?: string, score?: number }} certificate
 * @returns {Promise<string>} object URL for the generated PDF blob
 */
export async function createCertificateBlobUrl(certificate) {
  const response = await generateTrainingCertificate({
    moduleName: certificate.course_title,
    completionDate: certificate.completion_date || certificate.issued_at,
    score: certificate.score,
  });
  const blob = new Blob([response.data], { type: "application/pdf" });
  return window.URL.createObjectURL(blob);
}
