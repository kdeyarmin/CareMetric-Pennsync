// ADR letter + response-packet AI analysis — prompts, JSON schemas, and
// injected-LLM runners for the ADR Center's two document reads:
//
//   1. Letter analysis: read the uploaded ADR/audit letter and extract the
//      audit metadata (contractor, program, claim, beneficiary, deadline) plus
//      every requested item VERBATIM. The deterministic catalog
//      (adrRequirements.js) then merges these into the working checklist.
//   2. Packet verification: read the assembled response packet page by page
//      against the checklist and report, for each required item, whether it is
//      present, where (page numbers), and any accuracy problems a Medicare
//      reviewer would flag — with an explicit honesty contract: the model must
//      report what is actually visible, never assume compliance.
//
// Both are plain data (prompt builders + schemas). The LLM call is injected:
// callers pass the app's standardized `invokeLLM` helper (src/lib/invokeLLM.js)
// so the shared timeout/retry policy applies. Injection also keeps this module
// free of React and `@/` imports so the colocated Node test resolves without
// Vite. Pure + offline (unit-tested with `node --test`).

// ---------------------------------------------------------------------------
// 1. ADR / audit letter analysis
// ---------------------------------------------------------------------------

export function buildAdrLetterPrompt() {
  return `You are an expert home health compliance officer reading an Additional Documentation Request (ADR) or audit letter from a Medicare review contractor (MAC, UPIC, SMRC, CERT, RAC, TPE/RCD program) or another payer.

DOCUMENT READING INSTRUCTIONS:
- The letter may be scanned or faxed; read typed text, stamps, and handwriting carefully.
- Letters often carry a barcode cover page, claim identifiers (DCN/ICN), and a due date — capture them exactly.
- The "documents requested" section may be a numbered list, bullet list, or a dense paragraph. Extract EVERY requested item as its own entry, keeping the contractor's wording VERBATIM in "text".
- If the letter says something general like "all medical records supporting the claim", record that as its own requested item too.

HONESTY CONTRACT (critical):
- Extract only what the letter actually says. NEVER invent a claim number, date, or requested item.
- Anything not stated in the letter must be null (or an empty list) — not a guess.
- If a value is only partially legible, extract your best reading and add it to "unclear_fields".

Return the audit metadata and the verbatim list of requested items.`;
}

export const ADR_LETTER_SCHEMA = {
  type: "object",
  properties: {
    audit_type: {
      type: "string",
      enum: ["mac_adr", "tpe", "rcd", "upic", "smrc", "cert", "ra", "managed_care", "state_survey", "other"],
      description: "Best classification of the review program based on the letterhead and program language",
    },
    contractor_name: { type: ["string", "null"], description: "Reviewing contractor/payer exactly as named in the letter" },
    letter_date: { type: ["string", "null"], description: "Date on the letter, YYYY-MM-DD" },
    response_due_date: { type: ["string", "null"], description: "Deadline to respond, YYYY-MM-DD. ADRs commonly allow 45 days — but only report what the letter states." },
    response_due_days: { type: ["number", "null"], description: "Days allowed to respond when stated as a day count" },
    patient_name: { type: ["string", "null"], description: "Beneficiary name as printed" },
    medicare_number: { type: ["string", "null"], description: "MBI / Medicare number as printed" },
    claim_number: { type: ["string", "null"], description: "Claim number / DCN / ICN under review" },
    dates_of_service: { type: ["string", "null"], description: "Billed period under review, e.g. 2026-01-04 to 2026-03-03" },
    provider_identifier: { type: ["string", "null"], description: "PTAN/NPI/provider number the letter references" },
    submission_methods: {
      type: "array",
      items: { type: "string" },
      description: "How the contractor accepts the response (esMD, fax, portal, mail address) as stated",
    },
    special_instructions: {
      type: "array",
      items: { type: "string" },
      description: "Contractor-specific packet instructions (include the letter/barcode page, order of documents, page limits, etc.)",
    },
    requested_items: {
      type: "array",
      description: "Every requested document/item, one entry each, contractor wording preserved",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The requested item VERBATIM from the letter" },
          details: { type: ["string", "null"], description: "Qualifiers the letter attaches (date ranges, disciplines, 'signed and dated', etc.)" },
        },
        required: ["text"],
      },
    },
    letter_summary: { type: "string", description: "2-3 sentence plain-English summary of what this letter is and what happens if the agency misses the deadline, based only on the letter" },
    unclear_fields: {
      type: "array",
      items: { type: "string" },
      description: "Fields whose value was hard to read (poor scan/handwriting) and should be human-verified",
    },
    confidence: { type: "number", description: "0-100 overall extraction confidence" },
  },
  required: ["audit_type", "requested_items", "letter_summary"],
};

/**
 * Run the letter analysis.
 * @param {Function} invoke the app's invokeLLM (injected)
 * @param {{ fileUrl: string }} opts
 */
export function runAdrLetterAnalysis(invoke, { fileUrl }) {
  return invoke(
    {
      model: "automatic",
      prompt: buildAdrLetterPrompt(),
      file_urls: [fileUrl],
      response_json_schema: ADR_LETTER_SCHEMA,
    },
    // Letters are short; still a file read, so allow retries with backoff.
    { retries: 2, timeoutMs: 120000, backoffMs: 800 }
  );
}

// ---------------------------------------------------------------------------
// 2. Response-packet verification
// ---------------------------------------------------------------------------

/** Compact checklist rendering for the verification prompt. */
export function checklistForPrompt(checklist = []) {
  return checklist
    .map((it) => {
      const points = (it.verification_points || []).map((p) => `      - ${p}`).join("\n");
      const asked = it.letter_text ? `\n    Letter wording: "${it.letter_text}"` : "";
      // The NOT-APPLICABLE RULES tell the model to use each item's "Applies:"
      // condition — without rendering it the model can't tell which items are
      // conditional and makes wrong N/A calls.
      const applies = it.when ? `\n    Applies: ${it.when}` : "";
      return `  [${it.id}] ${it.title} (severity: ${it.severity}; ${it.citation})${asked}${applies}\n    Reviewer checks:\n${points}`;
    })
    .join("\n");
}

export function buildPacketVerificationPrompt(checklist = []) {
  return `You are a Medicare medical-review nurse auditing a home health agency's ADR response packet BEFORE it is sent to the contractor. Your job is to catch anything the real reviewer would deny, so be strict and honest.

Review EVERY page of the attached packet against this required-item checklist:

${checklistForPrompt(checklist)}

FOR EACH checklist item, report:
1. status — "found" (clearly present and complete), "partial" (present but incomplete/questionable), "missing" (not in the packet), or "not_applicable" (ONLY for conditional items — see rules below).
   NOT-APPLICABLE RULES: an item whose "Applies:" condition clearly does not apply to this claim (e.g. recertification when the packet documents an initial episode only, therapy reassessments when no therapy was billed, aide supervision when no aide services appear) may be reported "not_applicable" with a short na_reason grounded in what the packet shows. NEVER mark an always-required condition of payment or an item the letter explicitly requested as not_applicable — if you cannot find it, it is "missing".
2. pages — the 1-based page numbers in THIS packet where the item's documentation appears (start page first). Empty when missing.
3. evidence — one or two sentences describing exactly what you see on those pages (document title, dates, who signed).
4. issues — every accuracy or compliance problem a Medicare reviewer would flag, each with a severity. Examples of what to check:
   - signatures/dates missing, illegible, or dated AFTER the claim period
   - face-to-face encounter outside the 90-day-before/30-day-after window, or unrelated to the primary diagnosis
   - plan of care not signed by the certifying practitioner, or visit frequencies that do not match the visits documented
   - visit notes missing for part of the billed period, or notes that do not document a skilled service
   - homebound wording that is conclusory ("patient is homebound") with no supporting limitations
   - internal contradictions between documents (dates, diagnoses, functional status)
5. reviewer_note — where relevant, what the reviewing auditor should look at on the cited pages.

HONESTY CONTRACT (critical — this protects the agency):
- Report ONLY what is actually visible in the packet. If you cannot verify a point, say so — never assume a document is compliant.
- Do NOT soften findings. A missing or non-compliant condition-of-payment document means the claim will be denied; the agency needs to know now.
- NEVER fabricate page numbers, dates, or signatures. If pages are illegible, report them in unreadable_pages.
- If the packet contains documents for the WRONG patient or wrong dates of service, flag that as a critical issue on the affected item.

Also provide overall_observations: packet-level problems that do not belong to a single checklist item (out-of-order documents, duplicate pages, another patient's records mixed in, missing letter copy, etc.).`;
}

export const PACKET_VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    page_count_seen: { type: "number", description: "Total pages you can see in the packet" },
    items: {
      type: "array",
      description: "One entry per checklist item id, in checklist order",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The checklist item id being reported" },
          status: { type: "string", enum: ["found", "partial", "missing", "not_applicable"] },
          pages: { type: "array", items: { type: "number" }, description: "1-based packet page numbers where this item appears" },
          evidence: { type: "string", description: "What is actually visible (titles, dates, signatures)" },
          na_reason: { type: ["string", "null"], description: "For not_applicable only: why the condition does not apply, grounded in the packet" },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["critical", "high", "medium"] },
                problem: { type: "string", description: "The specific accuracy/compliance defect observed" },
                page: { type: ["number", "null"], description: "Page where the defect is visible, if applicable" },
              },
              required: ["severity", "problem"],
            },
          },
          reviewer_note: { type: ["string", "null"], description: "What the auditor should look at on the cited pages" },
        },
        required: ["id", "status"],
      },
    },
    overall_observations: {
      type: "array",
      items: { type: "string" },
      description: "Packet-level problems not tied to one checklist item",
    },
    unreadable_pages: {
      type: "array",
      items: { type: "number" },
      description: "Pages too poor quality to review",
    },
    confidence: { type: "number", description: "0-100 confidence in this review" },
  },
  required: ["items"],
};

/**
 * Run the page-by-page packet verification.
 * @param {Function} invoke the app's invokeLLM (injected — use invokeLLMWithFile)
 * @param {{ fileUrl: string, checklist: Array<object> }} opts
 */
export function runAdrPacketVerification(invoke, { fileUrl, checklist }) {
  return invoke(
    {
      model: "automatic",
      prompt: buildPacketVerificationPrompt(checklist),
      file_urls: [fileUrl],
      response_json_schema: PACKET_VERIFICATION_SCHEMA,
    },
    // Packets run long (often 100+ pages) — single attempt with a wide window,
    // mirroring invokeLLMWithFile's long-call posture; a retry of a 5-minute
    // read on transient failure is still worth one shot.
    { retries: 1, timeoutMs: 300000, backoffMs: 1500 }
  );
}
