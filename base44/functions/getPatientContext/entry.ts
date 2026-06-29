import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getPatientContext — returns the core datasets the PatientDetails page needs for
 * a single patient (the patient record, visits, care plans, incidents, tasks, and
 * active alerts) in ONE round-trip instead of the page firing six independent
 * entity queries from the browser.
 *
 * IMPORTANT — access control: every read runs AS THE CALLER (`base44.entities`,
 * NOT `asServiceRole`), so Base44 row-level security applies exactly as it did
 * when PatientDetails issued these queries directly. This deliberately preserves
 * the prior visibility model — Visit/CarePlan/Incident are `created_by`-scoped,
 * Task is `assigned_to`-scoped, Patient is assigned_nurses OR created_by OR admin
 * — so batching them here neither widens PHI/task visibility for a shared patient
 * nor locks out a creator who isn't yet in `assigned_nurses`. RLS is the gate: if
 * the caller can't read the patient, the filter returns empty and we return an
 * empty payload (the page renders its not-found state, same as before).
 *
 * The client seeds the per-entity React Query caches (['patient',id],
 * ['patientVisits',id], …) from this payload so the page's child components get
 * cache hits. OASIS uploads are intentionally NOT included — that cache key is
 * shape-inconsistent across components (financial-stripped function result vs.
 * raw entity), so it's left to each component's own query.
 *
 * Shapes mirror the client queryFns exactly so seeding is a drop-in:
 *   visits   — Visit.filter({patient_id}, '-visit_date')
 *   incidents— Incident.filter({patient_id}, '-incident_date')
 *   alerts   — PatientAlert.filter({patient_id, status:'active'})
 *   carePlans/tasks — unsorted filter by patient_id
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const patientId = body?.patientId;
    if (!patientId) return Response.json({ error: 'patientId is required' }, { status: 400 });

    // Caller-scoped: RLS decides what this user may read.
    const e = base44.entities;

    const patientArr = await e.Patient.filter({ id: patientId });
    const patient = patientArr?.[0] || null;
    // Not readable by this caller (or absent) → empty payload, mirroring the old
    // caller-scoped Patient.filter returning [] (page shows its not-found state).
    if (!patient) {
      return Response.json({ patient: null, visits: [], carePlans: [], incidents: [], tasks: [], activeAlerts: [] });
    }

    const [visits, carePlans, incidents, tasks, activeAlerts] = await Promise.all([
      e.Visit.filter({ patient_id: patientId }, '-visit_date'),
      e.CarePlan.filter({ patient_id: patientId }),
      e.Incident.filter({ patient_id: patientId }, '-incident_date'),
      e.Task.filter({ patient_id: patientId }),
      e.PatientAlert.filter({ patient_id: patientId, status: 'active' }),
    ]);

    return Response.json({ patient, visits, carePlans, incidents, tasks, activeAlerts });
  } catch (error) {
    console.error('getPatientContext error:', error?.message);
    return Response.json({ error: 'Failed to load patient context' }, { status: 500 });
  }
});
