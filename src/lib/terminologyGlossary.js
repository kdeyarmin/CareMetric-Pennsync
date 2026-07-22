export const TERMINOLOGY_GLOSSARY = Object.freeze({
  awaiting_info: { label: "Awaiting information", domain: "referral", definition: "Referral cannot proceed until missing identity or clinical details are supplied." },
  in_review: { label: "In review", domain: "clinical", definition: "Record is being reviewed and should not be treated as final." },
  finalized: { label: "Finalized", domain: "clinical", definition: "Record is locked for normal editing and requires a correction workflow." },
  corrected: { label: "Corrected", domain: "clinical", definition: "A final record has a traceable correction event." },
  retry_exhausted: { label: "Retry exhausted", domain: "communications", definition: "Outbound delivery failed after the retry budget and needs manual redrive or closure." },
  offboarded: { label: "Offboarded", domain: "admin", definition: "User access has been disabled while retaining audit history." },
});

export function glossaryLabel(term) {
  return TERMINOLOGY_GLOSSARY[term]?.label || String(term || "Unknown");
}

export function validateTerminologyGlossary(glossary = TERMINOLOGY_GLOSSARY) {
  const entries = Object.entries(glossary);
  const labels = new Set();
  const errors = [];
  for (const [key, value] of entries) {
    if (!value.label || !value.domain || !value.definition) errors.push(`${key}:missing_field`);
    const normalized = String(value.label || "").toLowerCase();
    if (labels.has(normalized)) errors.push(`${key}:duplicate_label`);
    labels.add(normalized);
  }
  return { valid: errors.length === 0, errors, count: entries.length };
}
