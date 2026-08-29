// Scanned provider-response ingestion — prompt/schema for extracting the
// provider's per-item answers from a SCANNED copy of the completed
// "Additional Information Request" form.
//
// The inbound-fax path (processInboundFaxes) does the same extraction
// autonomously from OCR text; this module powers the MANUAL path where intake
// scans a paper response (mailed back, handed back, or received on the office
// fax machine) and uploads it on the Referral Follow-Up page. The referral is
// already known (the user is looking at it), so there is no matching step —
// and because a human is present, extracted answers are PREVIEWED and
// confirmed before anything is applied (the merge itself is the same
// conservative applyFaxAnswersToItems used by the fax path).
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK.

/** The request's items a response extraction may answer: OPEN items only
 *  (a scan must never target items already answered via portal/fax or
 *  resolved by staff), as the minimal {id, title, question} the prompt needs. */
export function openItemsForExtraction(items) {
  return (items || [])
    .filter((it) => it && it.id && (!it.item_status || it.item_status === "open"))
    .map((it) => ({
      id: it.id,
      title: it.title || "",
      question: it.provider_request?.question || it.needed || "",
    }));
}

/**
 * Build the extraction prompt for a scanned response document. The document
 * itself is attached via file_urls; this prompt tells the model exactly which
 * items to look for and forbids invented answers.
 */
export function buildResponseExtractionPrompt(openItems) {
  return `This scanned document is a referring provider's completed "Additional Information Request" form (or their response documents) returned to a home health agency. Read it completely — typed text, handwriting, checkboxes, margin notes, and any attached pages.

For each requested item below, determine whether the provider ANSWERED it in this document, and transcribe their response verbatim. A checked "Document attached" box counts as the response "Document attached" (plus any note beside it). Do NOT invent or infer answers: if an item's response area is blank, illegible, or the document does not address it, mark it unanswered.

REQUESTED ITEMS:
${(openItems || [])
  .map((it, i) => `${i + 1}. id: ${it.id}\n   ${it.title || String(it.id)}${it.question ? `\n   Question: ${it.question}` : ""}`)
  .join("\n")}`;
}

/** Response schema for the scanned-response extraction. */
export const RESPONSE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          answered: { type: "boolean" },
          response_text: { type: "string" },
        },
      },
    },
    document_summary: {
      type: "string",
      description: "One or two sentences describing what the scanned document contains.",
    },
  },
};

/** Keep only extracted answers that target one of the open items (the model
 *  must not answer items it wasn't asked about) and carry real text. */
export function usableAnswers(extraction, openItems) {
  const openIds = new Set((openItems || []).map((it) => it.id));
  return (extraction?.answers || []).filter(
    (a) => a && a.answered === true && openIds.has(a.id) && String(a.response_text ?? "").trim() !== ""
  );
}
