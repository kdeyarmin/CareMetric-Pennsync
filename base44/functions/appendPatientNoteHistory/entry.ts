import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * appendPatientNoteHistory — the ONE write path for a patient's
 * enhanced_notes_history (+ the clinical_notes mirror).
 *
 * persistVisitNote used to read-modify-write the history array from the
 * BROWSER: two concurrent saves for the same patient (two clinicians, or Smart
 * Note + Visit Scribe on two devices) both read the same array, both pushed
 * their entry, and the last write silently dropped the other's note-history
 * entry. Moving the append server-side shrinks the read→write window from a
 * whole client round-trip to milliseconds, and the verify-and-retry loop below
 * (unique entry_id, re-read after write, bounded retries) re-applies an append
 * that a concurrent writer clobbered. Base44 has no compare-and-swap, so this
 * is convergence-by-verification rather than a hard transaction — the residual
 * window is two writers clobbering AND verifying in perfect lockstep, versus
 * losing an entry on ANY concurrent save before.
 *
 * Re-saves (mode 'update') target their entry by visit_id instead of blindly
 * mutating the LAST array element, so an edit can no longer overwrite a
 * colleague's newer entry that landed in between.
 *
 * Patient access is USER-scoped (not service role): the patient's RLS decides
 * whether this caller may read/write this chart, exactly like the direct
 * client write this replaces.
 *
 * Input: {
 *   patient_id,
 *   mode: 'append' | 'update',
 *   clinical_notes?,   // mirror of the latest note kept on the patient
 *   entry: { entry_id?, visit_id?, date?, visit_type?, note, compliance_score? }
 * }
 * `entry` is one flat object in both modes; `note` is always required, and
 * mode 'update' additionally requires `visit_id` (it selects which existing
 * history entry to update).
 */

const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Small randomized settle delay before the verification re-read so two
// colliding writers are unlikely to verify at the same instant repeatedly.
const settleMs = () => 120 + Math.floor(Math.random() * 240);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }

    const { patient_id, mode, entry, clinical_notes } = await req.json();
    if (!patient_id || (mode !== 'append' && mode !== 'update') || !entry || typeof entry !== 'object') {
      return Response.json({ error: "patient_id, mode ('append' | 'update') and entry are required" }, { status: 400 });
    }
    const note = String(entry.note ?? '');
    if (!note) {
      return Response.json({ error: 'entry.note is required' }, { status: 400 });
    }
    if (mode === 'update' && !entry.visit_id) {
      return Response.json({ error: 'entry.visit_id is required to update an existing entry' }, { status: 400 });
    }

    const entryId = String(entry.entry_id || crypto.randomUUID());
    const score = Number(entry.compliance_score);
    const newEntry = {
      entry_id: entryId,
      ...(entry.visit_id ? { visit_id: String(entry.visit_id) } : {}),
      ...(entry.date ? { date: entry.date } : {}),
      ...(entry.visit_type ? { visit_type: String(entry.visit_type) } : {}),
      note,
      ...(Number.isFinite(score) ? { compliance_score: score } : {}),
      // Authorship is stamped server-side — the caller can't write history
      // entries in a teammate's name.
      created_by: user.email,
      created_at: new Date().toISOString(),
    };
    const notesPatch = clinical_notes !== undefined ? { clinical_notes: String(clinical_notes) } : {};

    const Patients = base44.entities.Patient;
    let lastError = 'Concurrent writers kept overwriting the note-history append';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let patient;
      try {
        patient = await Patients.get(patient_id);
      } catch {
        patient = null;
      }
      if (!patient) {
        return Response.json({ error: 'Patient not found or not accessible' }, { status: 404 });
      }

      const history = Array.isArray(patient.enhanced_notes_history) ? patient.enhanced_notes_history : [];
      let next;
      let verify;

      if (mode === 'append') {
        if (history.some((e) => e && e.entry_id === entryId)) {
          // Already present (a prior attempt landed) — idempotent success.
          return Response.json({ success: true, entry_id: entryId, attempts: attempt - 1 });
        }
        next = [...history, newEntry];
        verify = (h) => h.some((e) => e && e.entry_id === entryId);
      } else {
        // Prefer the entry documented for THIS visit. The last-entry fallback
        // is ONLY for true legacy rows (no visit_id/entry_id metadata at all)
        // — falling back whenever the visit_id merely didn't match let a
        // typo'd/foreign visit_id silently rewrite a DIFFERENT visit's note.
        let idx = history.findIndex((e) => e && e.visit_id === String(entry.visit_id));
        if (idx === -1) {
          const lastIsLegacy = history.length > 0 &&
            !history[history.length - 1]?.visit_id && !history[history.length - 1]?.entry_id;
          if (lastIsLegacy) {
            idx = history.length - 1;
          } else if (history.length > 0) {
            return Response.json(
              { error: 'No note-history entry exists for this visit — refusing to overwrite another visit\'s note.' },
              { status: 404 },
            );
          }
        }
        if (idx < 0) {
          // Nothing to update (no history yet) — just keep the mirror in step.
          if (clinical_notes !== undefined) await Patients.update(patient_id, notesPatch);
          return Response.json({ success: true, entry_id: null, attempts: attempt - 1, updated: false });
        }
        next = history.slice();
        next[idx] = { ...next[idx], note, ...(Number.isFinite(score) ? { compliance_score: score } : {}) };
        const targetId = next[idx].entry_id;
        const targetVisit = next[idx].visit_id;
        verify = (h) => h.some((e) => e && e.note === note
          && (targetId ? e.entry_id === targetId : true)
          && (!targetId && targetVisit ? e.visit_id === targetVisit : true));
      }

      try {
        await Patients.update(patient_id, { enhanced_notes_history: next, ...notesPatch });
      } catch (err) {
        // Generic client-visible reason; keep the raw detail server-side only.
        console.error('appendPatientNoteHistory Patient.update failed:', err);
        lastError = 'Patient update failed';
        continue;
      }

      // Verification re-read: if a concurrent writer's read-modify-write raced
      // ours and dropped this entry, retry the whole append against the fresh
      // array instead of silently losing a clinical note reference.
      await sleep(settleMs());
      let check;
      try {
        check = await Patients.get(patient_id);
      } catch {
        check = null;
      }
      const settled = Array.isArray(check?.enhanced_notes_history) ? check.enhanced_notes_history : [];
      if (check && verify(settled)) {
        return Response.json({ success: true, entry_id: mode === 'append' ? entryId : undefined, attempts: attempt });
      }
    }

    console.error(`appendPatientNoteHistory gave up after ${MAX_ATTEMPTS} attempts`);
    return Response.json({ error: lastError }, { status: 503 });
  } catch (error) {
    console.error('appendPatientNoteHistory error:', error);
    return Response.json({ error: 'Failed to write note history' }, { status: 500 });
  }
});
