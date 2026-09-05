// Small pure helpers shared by the visit-documentation flows (Smart Note +
// Visit Scribe) so the two can't drift on prior-note carry-forward or the
// section breakdown shown by FinalNoteDisplay.

/** The patient's last documented note, preferred from history for carry-forward. */
export function getPriorNote(p) {
  if (!p) return "";
  const hist = p.enhanced_notes_history;
  if (Array.isArray(hist) && hist.length) return hist[hist.length - 1]?.note || "";
  return p.clinical_notes || "";
}

/**
 * Overlay the new append-only projection on a Patient's legacy embedded
 * history. A new immutable event wins for the same Visit, while un-migrated
 * legacy rows remain visible. This keeps Smart Note behavior stable during the
 * audited migration without ever writing the Patient array again.
 */
export function mergePatientNoteHistory(patient, appendOnlyEntries = []) {
  if (!patient) return patient;
  const legacy = Array.isArray(patient.enhanced_notes_history)
    ? patient.enhanced_notes_history
    : [];
  const projected = Array.isArray(appendOnlyEntries) ? appendOnlyEntries : [];
  const byVisit = new Map();
  const withoutVisit = [];

  for (const entry of legacy) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.visit_id) byVisit.set(entry.visit_id, entry);
    else withoutVisit.push(entry);
  }
  for (const entry of projected) {
    if (!entry || typeof entry !== 'object' || !entry.note) continue;
    if (entry.visit_id) byVisit.set(entry.visit_id, entry);
    else withoutVisit.push(entry);
  }
  const timeOf = (entry) => {
    const value = entry?.revision_at || entry?.created_at || entry?.date || entry?.timestamp || '';
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const enhancedNotesHistory = [...withoutVisit, ...byVisit.values()]
    .sort((left, right) => timeOf(left) - timeOf(right));
  const latest = enhancedNotesHistory.at(-1)?.note;
  return {
    ...patient,
    enhanced_notes_history: enhancedNotesHistory,
    clinical_notes: latest || patient.clinical_notes || '',
  };
}

/** Heuristically split a final note into labeled sections for display, or null. */
export function parseNoteSections(text) {
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const vitals = sentences.filter(s => /bp|blood pressure|hr|heart rate|o2|oxygen|temp|weight|respir|pain/i.test(s));
  const assessment = sentences.filter(s => /assess|exam|appear|ambul|mobil|wound|skin|edema|breath|lung|bowel/i.test(s));
  const education = sentences.filter(s => /teach|educat|instruct|verbali|understand|demonstrat/i.test(s));
  const safety = sentences.filter(s => /fall|safe|hazard|medic|adher|complian/i.test(s));
  const plan = sentences.filter(s => /plan|next|follow|return|notif|physician|refer|schedul/i.test(s));
  const rest = sentences.filter(s => ![...vitals, ...assessment, ...education, ...safety, ...plan].includes(s));
  const secs = [
    { key: "vitals", label: "Vital Signs", text: vitals.join(" ").trim() },
    { key: "assessment", label: "Assessment", text: assessment.join(" ").trim() },
    { key: "education", label: "Education / Teaching", text: education.join(" ").trim() },
    { key: "safety", label: "Safety", text: safety.join(" ").trim() },
    { key: "plan", label: "Plan", text: plan.join(" ").trim() },
    { key: "other", label: "Clinical Narrative", text: rest.join(" ").trim() },
  ].filter(s => s.text.length > 10);
  return secs.length > 1 ? secs : null;
}
