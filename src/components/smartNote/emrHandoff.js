// EMR handoff — the step PennSync exists to support.
//
// PennSync is NOT the agency's EMR and is NOT the legal medical record. The
// nurse's real deliverable is the official note they enter and sign in the EMR;
// everything PennSync does before that is preparation. This module makes that
// handoff a first-class, testable workflow instead of a single unlabelled
// "Copy" button:
//
//   - splitNoteSections()  — break the polished note into copyable sections so a
//                            nurse can paste field-by-field into an EMR form
//                            rather than dumping one blob into a free-text box.
//   - handoff status model — SELF-REPORTED workflow states. PennSync has no EMR
//                            integration, so it can never claim it verified an
//                            entry or a signature. The status records only what
//                            the nurse told us they did.
//   - review acknowledgement — an AI-governance record ("I reviewed this before
//                            copying it"), explicitly NOT a clinical signature
//                            or legal attestation.
//
// Pure + offline (no React, no SDK, no network) so it runs under `node --test`.
// It may only import other plain `.js` modules with explicit extensions.

/**
 * The standing message shown wherever a nurse is about to move PennSync content
 * into the official record. Exported (rather than inlined in JSX) so the wording
 * is asserted by tests and can never drift into a compliance claim.
 */
export const EMR_HANDOFF_DISCLAIMER =
  "PennSync assists with documentation preparation. Review this content and "
  + "enter/sign the official documentation in your agency's EMR.";

/**
 * Wording for the review acknowledgement. Deliberately not a signature: it
 * records that a human read the AI-assisted text, nothing more.
 */
export const REVIEW_ACK_LABEL =
  "I reviewed this suggested documentation for accuracy before copying it to the EMR.";

export const REVIEW_ACK_NOT_A_SIGNATURE =
  "This is a PennSync review record for AI governance. It is not a clinical "
  + "signature, a legal attestation, or a substitute for signing the note in your EMR.";

// ── Handoff status model ───────────────────────────────────────────────────
// Ordered, forward-only. Every state is something the NURSE reports, never
// something PennSync observed.

/** @type {ReadonlyArray<{ id: string, label: string, help: string, order: number }>} */
export const EMR_HANDOFF_STATUSES = Object.freeze([
  {
    id: "not_started",
    label: "Not copied yet",
    help: "Nothing has been moved into the EMR from PennSync.",
    order: 0,
  },
  {
    id: "copied_to_emr",
    label: "Copied to EMR",
    help: "You copied this content into your EMR. PennSync did not verify the EMR entry.",
    order: 1,
  },
  {
    id: "reviewed_in_emr",
    label: "Reviewed in EMR",
    help: "You reviewed the entry inside the EMR. PennSync did not verify the EMR entry.",
    order: 2,
  },
  {
    id: "signed_in_emr",
    label: "Signed in EMR",
    help: "You signed the official note in the EMR. PennSync did not verify the signature.",
    order: 3,
  },
]);

const STATUS_BY_ID = new Map(EMR_HANDOFF_STATUSES.map((s) => [s.id, s]));

/** All valid status ids, in order. */
export const EMR_HANDOFF_STATUS_IDS = EMR_HANDOFF_STATUSES.map((s) => s.id);

/**
 * Every self-reported status carries this caveat, so no screen (and no exported
 * report) can imply PennSync confirmed anything in the EMR.
 */
export const SELF_REPORTED_CAVEAT =
  "Self-reported by the nurse. PennSync has no EMR integration and did not verify this.";

/** @param {string} id */
export function getHandoffStatus(id) {
  return STATUS_BY_ID.get(id) || STATUS_BY_ID.get("not_started");
}

/**
 * Advance the self-reported handoff status.
 *
 * Forward-only: a later state cannot be undone by re-reporting an earlier one
 * (that would silently rewrite an operational record), and an unknown id is
 * rejected rather than stored. Returns the resulting record plus whether it
 * actually changed, so a caller can avoid writing a no-op update.
 *
 * @param {{ status?: string, history?: Array<object> }} current
 * @param {string} nextStatusId
 * @param {{ actorEmail?: string|null, at?: string, note?: string }} [meta]
 * @returns {{ ok: boolean, changed: boolean, reason?: string, status: string, history: Array<object> }}
 */
export function advanceHandoffStatus(current, nextStatusId, meta = {}) {
  const history = Array.isArray(current?.history) ? [...current.history] : [];
  const currentId = STATUS_BY_ID.has(current?.status) ? current.status : "not_started";
  const next = STATUS_BY_ID.get(nextStatusId);
  if (!next) {
    return { ok: false, changed: false, reason: `Unknown handoff status: ${nextStatusId}`, status: currentId, history };
  }
  const currentOrder = STATUS_BY_ID.get(currentId).order;
  if (next.order <= currentOrder) {
    return {
      ok: false,
      changed: false,
      reason: next.order === currentOrder
        ? `Already reported as "${next.label}".`
        : `Cannot move back from "${STATUS_BY_ID.get(currentId).label}" to "${next.label}".`,
      status: currentId,
      history,
    };
  }
  history.push({
    status: next.id,
    reported_by: meta.actorEmail || null,
    reported_at: meta.at || new Date().toISOString(),
    self_reported: true,
    note: meta.note || "",
  });
  return { ok: true, changed: true, status: next.id, history };
}

// ── Section splitting ──────────────────────────────────────────────────────

// Explicit headings a generated or nurse-edited note may carry.
//
// Matched against a BOUNDED VOCABULARY rather than "any capitalised words
// before a colon". Clinical prose is full of mid-sentence colons ("Assessed the
// sacral wound: 2x3 cm, granulating") and a permissive rule swallowed the
// lead-in clause as a heading — the nurse would then paste a section whose
// clinical context had been silently dropped. A section split must never lose
// text, so anything outside this vocabulary stays body.
const KNOWN_HEADINGS = new Set([
  "assessment", "assessments", "objective", "subjective", "subjective/objective",
  "vitals", "vital signs", "observations", "findings", "physical assessment",
  "interventions", "intervention", "skilled intervention", "skilled interventions",
  "skilled need", "skilled nursing", "care provided", "treatment", "procedures",
  "patient response", "response", "response to care", "tolerance",
  "education", "teaching", "patient education", "education/teaching", "instruction",
  "homebound", "homebound status", "homebound justification",
  "plan", "plan of care", "follow-up", "follow up", "next visit", "goals",
  "medications", "medication review", "allergies", "safety", "safety assessment",
  "coordination of care", "coordination", "communication", "narrative", "summary",
  "history", "wound", "wound care", "functional status", "psychosocial",
  "discharge", "discharge plan", "discharge planning", "notes",
]);

// Structural markers only; the label itself must clear isHeadingLabel().
const HEADING_LINE = /^\s{0,3}(?:#{1,4}\s*)?\*{0,2}([A-Za-z][A-Za-z/ &'-]{2,48}?)\*{0,2}\s*:\s*$/;
const HEADING_INLINE = /^\s{0,3}(?:#{1,4}\s*)?\*{0,2}([A-Za-z][A-Za-z/ &'-]{2,48}?)\*{0,2}\s*:\s+(\S.*)$/;

/**
 * A label is a heading when it is a known documentation section name, or is
 * written in ALL CAPS (the other unambiguous heading convention). Both are
 * checked on the trimmed label so `**Assessment**:` and `ASSESSMENT:` both work.
 */
function isHeadingLabel(label) {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (KNOWN_HEADINGS.has(trimmed.toLowerCase())) return true;
  // ALL CAPS with at most four words — "SUBJECTIVE", "PATIENT RESPONSE".
  return /^[A-Z][A-Z /&'-]*$/.test(trimmed) && trimmed.split(/\s+/).length <= 4;
}

/**
 * @param {string} line
 * @returns {{ heading: string, inlineBody: string }|null}
 */
function matchHeading(line) {
  const standalone = line.match(HEADING_LINE);
  if (standalone && isHeadingLabel(standalone[1])) {
    return { heading: standalone[1].trim(), inlineBody: "" };
  }
  const inline = line.match(HEADING_INLINE);
  if (inline && isHeadingLabel(inline[1])) {
    return { heading: inline[1].trim(), inlineBody: inline[2].trim() };
  }
  return null;
}

// Deterministic topic classification, used to label paragraphs when a note has
// no headings of its own. Order matters: the first category whose pattern hits
// the paragraph wins, so the more specific categories come first.
const TOPIC_RULES = [
  { id: "vitals", label: "Vital signs", pattern: /\b(?:bp|blood pressure|hr\b|heart rate|o2\b|oxygen sat|spo2|temp(?:erature)?\b|respirat|pulse|weight)\b/i },
  { id: "homebound", label: "Homebound status", pattern: /homebound|confined to (?:home|residence)|taxing effort|unable to leave/i },
  { id: "skilled_need", label: "Skilled need", pattern: /skilled (?:need|nursing|assessment|service|intervention|observation)|required the skill/i },
  { id: "education", label: "Education / teaching", pattern: /educat|taught|teach[- ]?back|instruct|return demonstration|verbali[sz]ed understanding/i },
  { id: "response", label: "Patient response", pattern: /tolerated|patient response|responded (?:well|poorly)|no adverse|verbali[sz]ed/i },
  { id: "interventions", label: "Interventions", pattern: /\b(?:administered|performed|applied|changed the dressing|dressing change|irrigat|flushed|repositioned|assessed and|provided care|catheter|injection)\b/i },
  { id: "plan", label: "Plan / follow-up", pattern: /\bplan\b|next visit|follow[- ]?up|will return|notified|coordinat|scheduled/i },
  { id: "assessment", label: "Assessment", pattern: /\b(?:assessment|assessed|examination|lungs|abdomen|edema|wound|skin|gait|alert and oriented)\b/i },
];

function classifyParagraph(text) {
  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(text)) return rule;
  }
  return { id: "narrative", label: "Narrative" };
}

/** Stable, unique section id even when two sections classify the same. */
function sectionId(base, index) {
  return `${base}-${index + 1}`;
}

/**
 * Break a note into copyable sections.
 *
 * Explicit headings win: if the note carries `Assessment:` / `Interventions:`
 * style headings, those become the sections verbatim (so what the nurse pastes
 * matches what they see). Otherwise paragraphs are grouped and given a
 * deterministic topic label, which is presentational only — the section BODY is
 * always the untouched source text, never a rewrite.
 *
 * @param {string} noteText
 * @returns {Array<{ id: string, heading: string, body: string, text: string, labeled: boolean, topic: string }>}
 */
export function splitNoteSections(noteText) {
  const text = typeof noteText === "string" ? noteText.replace(/\r\n?/g, "\n") : "";
  if (!text.trim()) return [];

  const lines = text.split("\n");
  /** @type {Array<{ heading: string, lines: string[] }>} */
  const blocks = [];
  let current = null;
  let sawHeading = false;

  for (const line of lines) {
    const m = matchHeading(line);
    if (m) {
      sawHeading = true;
      current = { heading: m.heading, lines: m.inlineBody ? [m.inlineBody] : [] };
      blocks.push(current);
      continue;
    }
    if (!current) {
      current = { heading: "", lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }

  if (sawHeading) {
    return blocks
      .map((b) => ({ heading: b.heading, body: b.lines.join("\n").trim() }))
      .filter((b) => b.heading || b.body)
      .map((b, i) => ({
        id: sectionId(b.heading ? slug(b.heading) : "section", i),
        heading: b.heading || "Note",
        body: b.body,
        // What actually reaches the clipboard for this section.
        text: b.heading ? `${b.heading}:\n${b.body}`.trim() : b.body,
        labeled: true,
        topic: classifyParagraph(`${b.heading} ${b.body}`).id,
      }))
      .filter((s) => s.body);
  }

  // No headings: fall back to paragraphs with a deterministic topic label.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // A single unbroken paragraph is one section — splitting prose mid-thought
  // would hand the nurse fragments that read as incomplete documentation.
  return paragraphs.map((body, i) => {
    const topic = classifyParagraph(body);
    return {
      id: sectionId(topic.id, i),
      heading: topic.label,
      body,
      text: body,
      labeled: false,
      topic: topic.id,
    };
  });
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

// ── Review acknowledgement ─────────────────────────────────────────────────

/**
 * Stable, non-cryptographic content hash (FNV-1a, 32-bit, hex).
 *
 * Used only to tell one note VERSION from another in the acknowledgement trail —
 * so a "reviewed" record cannot silently be claimed for text edited afterwards.
 * It is deliberately not a security primitive and stores no PHI itself.
 *
 * @param {string} text
 * @returns {string} 8-character hex
 */
export function hashNoteText(text) {
  const source = typeof text === "string" ? text : "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    // 32-bit FNV prime multiply without overflowing into float precision.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build the review-acknowledgement record.
 *
 * Stores who, when, which note version, and whether the text was AI-assisted —
 * the four things needed to answer "what did AI suggest and what did the
 * clinician choose?". Deliberately stores the note HASH, not a second copy of
 * the note text (PHI minimisation: the note itself already lives on the Visit).
 *
 * @param {{ noteText?: string, actorEmail?: string|null, aiAssisted?: boolean, at?: string, edited?: boolean }} args
 */
export function buildReviewAcknowledgement({
  noteText = "",
  actorEmail = null,
  aiAssisted = true,
  at = null,
  edited = false,
} = {}) {
  return {
    acknowledged: true,
    acknowledged_by: actorEmail || null,
    acknowledged_at: at || new Date().toISOString(),
    note_hash: hashNoteText(noteText),
    note_length: typeof noteText === "string" ? noteText.length : 0,
    ai_assisted: !!aiAssisted,
    nurse_edited: !!edited,
    statement: REVIEW_ACK_LABEL,
    // Explicit so a downstream reader (export, audit packet) cannot mistake this
    // for a clinical signature.
    is_clinical_signature: false,
  };
}

/**
 * True when the acknowledgement was made against a DIFFERENT version of the
 * note than the one on screen now — i.e. the nurse edited after reviewing, so
 * the acknowledgement no longer covers what they are about to copy.
 *
 * @param {{ note_hash?: string }|null} ack
 * @param {string} currentText
 */
export function isAcknowledgementStale(ack, currentText) {
  if (!ack?.note_hash) return false;
  return ack.note_hash !== hashNoteText(currentText);
}
