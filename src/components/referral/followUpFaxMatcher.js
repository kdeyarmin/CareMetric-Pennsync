// Fax-back → follow-up-request matcher.
//
// When a referring provider faxes back a completed "Additional Information
// Request" form, this module decides WHICH referral's open follow-up request
// the inbound fax answers — from the OCR text and sender number only.
//
// Matching is deliberately conservative: an auto-attach requires the patient
// name to match PLUS at least one corroborating signal (our form's title
// marker in the text, the sender number being the fax we sent the request to,
// the patient's DOB, or the provider's name). Anything weaker is only a
// suggestion for manual review — attaching provider responses to the wrong
// patient's referral is worse than asking a human.
//
// Pure + offline (unit-tested with `node --test`); no React, no SDK. The
// processInboundFaxes backend function mirrors this logic (repo convention:
// backend functions copy their helpers; keep the two in sync).

// Text our provider form always carries (referralFollowUpEngine.buildProviderForm).
export const FORM_MARKER = "additional information request";

/** Last 10 digits — tolerant of +1, punctuation, and OCR spacing. */
export function normalizeFaxNumber(num) {
  const digits = String(num || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const normText = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ");
const normName = (s) =>
  String(s || "").toLowerCase().replace(/\bdr\.?\b/g, "").replace(/[^a-z ]/g, "").trim();

/** Does the OCR text contain every word of the (2+ word) name? Single-word
 *  names are too ambiguous to count as a match. */
function nameInText(name, text) {
  const words = normName(name).split(" ").filter((w) => w.length > 1);
  if (words.length < 2) return false;
  const t = normName(text);
  return words.every((w) => t.includes(w));
}

/** DOB appears in the text in any of the common renderings. */
function dobInText(dob, text) {
  const raw = String(dob || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw.length >= 8 && text.includes(raw);
  const [, y, mo, d] = m;
  const variants = [
    `${y}-${mo}-${d}`,
    `${mo}/${d}/${y}`,
    `${Number(mo)}/${Number(d)}/${y}`,
    `${mo}-${d}-${y}`,
  ];
  return variants.some((v) => text.includes(v));
}

/**
 * Signals tying one inbound fax to one candidate request.
 * @param {{ocrText:string, senderNumber:string}} fax
 * @param {{patientName?:string, patientDob?:string, providerName?:string, sentToNumber?:string}} candidate
 */
export function extractSignals(fax, candidate) {
  const text = normText(fax?.ocrText);
  const sender = normalizeFaxNumber(fax?.senderNumber);
  const sentTo = normalizeFaxNumber(candidate?.sentToNumber);
  return {
    form_marker: text.includes(FORM_MARKER),
    patient_name: nameInText(candidate?.patientName, text),
    patient_dob: dobInText(candidate?.patientDob, text),
    sender_number: !!sender && sender.length === 10 && sender === sentTo,
    provider_name: nameInText(candidate?.providerName, text),
  };
}

export function scoreSignals(signals) {
  return Object.values(signals || {}).filter(Boolean).length;
}

/**
 * Pick the best candidate for an inbound fax.
 *
 * @param {{ocrText:string, senderNumber:string}} fax
 * @param {Array<{id:string} & object>} candidates one per referral with a SENT follow-up request
 * @returns {{candidate:object, signals:object, score:number, confident:boolean}|null}
 *   confident = safe to auto-attach; otherwise surface as a suggestion only.
 *   null when nothing matches at all.
 */
export function bestFaxBackMatch(fax, candidates = []) {
  let best = null;
  for (const candidate of candidates) {
    const signals = extractSignals(fax, candidate);
    const score = scoreSignals(signals);
    if (score === 0) continue;
    // The form marker alone matches EVERY open request equally — it proves the
    // fax is one of ours, not whose it is. Require an identifying signal.
    const identifying = signals.patient_name || signals.patient_dob || signals.sender_number;
    if (!identifying) continue;
    if (!best || score > best.score) {
      best = {
        candidate,
        signals,
        score,
        confident: signals.patient_name && score >= 2,
      };
    } else if (score === best.score) {
      // A tie between two different referrals is inherently ambiguous — a
      // human must pick. Demote to non-confident but keep the first as the
      // suggestion.
      best = { ...best, confident: false, tied: true };
    }
  }
  return best;
}
