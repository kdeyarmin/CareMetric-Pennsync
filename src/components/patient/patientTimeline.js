const EVENT_CONFIG = Object.freeze({
  // PatientDetails reads ?id= as a PATIENT id — routing a visit there with the
  // visit's own id landed on "Patient not found". idField names the record
  // field holding the id the target page expects (default: the record's id).
  visit: { label: 'Visit', route: '/PatientDetails', dateFields: ['visit_date', 'date', 'created_date'], idField: 'patient_id' },
  document: { label: 'Document', route: '/DocumentHub', dateFields: ['signed_at', 'uploaded_at', 'created_date'] },
  incident: { label: 'Incident', route: '/IncidentReview', dateFields: ['incident_date', 'created_date'] },
  task: { label: 'Task', route: '/Dashboard', dateFields: ['due_date', 'created_date'] },
  message: { label: 'Message', route: '/Messages', dateFields: ['sent_at', 'created_date'] },
  referral: { label: 'Referral', route: '/ReferralIntake', dateFields: ['referral_date', 'created_date'] },
});

const CLOSED_ACCESS = Object.freeze({
  canOpenVisitNotes: false,
  canOpenDocuments: false,
  canReviewIncidents: false,
  canOpenReferrals: false,
});

function withId(route, queryKey, id) {
  if (!route) return null;
  if (!id) return route;
  return `${route}?${queryKey}=${encodeURIComponent(id)}`;
}

function eventRoute(type, record, access) {
  const config = EVENT_CONFIG[type];
  if (type === 'visit' && access.canOpenVisitNotes && record?.id) {
    return withId('/ClinicalDocumentation', 'visitId', record.id);
  }
  if (type === 'document' && !access.canOpenDocuments) return null;
  if (type === 'referral' && !access.canOpenReferrals) return null;
  if (type === 'incident' && !access.canReviewIncidents) return '/Incidents';
  const routeId = config.idField ? record[config.idField] : record.id;
  return withId(config.route, 'id', routeId);
}

function firstDate(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function eventTitle(type, record) {
  if (record?.title) return record.title;
  if (record?.document_name) return record.document_name;
  if (record?.incident_name) return record.incident_name;
  if (record?.visit_type) return record.visit_type;
  if (record?.subject) return record.subject;
  if (record?.diagnosis) return record.diagnosis;
  return EVENT_CONFIG[type].label;
}

export function buildPatientTimeline({
  patientId,
  visits = [],
  documents = [],
  incidents = [],
  tasks = [],
  messages = [],
  referrals = [],
  access = CLOSED_ACCESS,
} = {}) {
  const sources = { visit: visits, document: documents, incident: incidents, task: tasks, message: messages, referral: referrals };
  const viewer = { ...CLOSED_ACCESS, ...(access || {}) };
  const events = [];

  for (const [type, rows] of Object.entries(sources)) {
    const config = EVENT_CONFIG[type];
    for (const record of Array.isArray(rows) ? rows : []) {
      // When filtering for a specific patient, a record with NO patient_id is
      // unattributed — it must not appear on every patient's timeline.
      if (patientId && record?.patient_id !== patientId) continue;
      const occurredAt = firstDate(record, config.dateFields);
      if (!occurredAt) continue;
      events.push({
        // Include the index so id-less same-day records don't collide on an
        // identical event id (React key collisions).
        id: `${type}:${record.id || record.client_request_id || `${occurredAt}:${events.length}`}`,
        type,
        label: config.label,
        title: eventTitle(type, record),
        occurred_at: occurredAt,
        status: record.status || null,
        source_id: record.id || null,
        route: eventRoute(type, record, viewer),
      });
    }
  }

  return events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || a.type.localeCompare(b.type));
}
