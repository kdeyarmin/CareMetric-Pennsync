// Ported from base44/functions/submitStateReportableIncident.
//
// The FIFTH partial port. Two of its four steps ship and two are refused by
// name, and `contract_state_incident_submit`'s header says why: the PDF
// retention reaches the file layer, and the email is `Core.SendEmail`, which
// is D56's open owner decision. Both are reported as paused rather than
// silently skipped, so a caller is never told a document was retained or a
// message sent when neither happened.
//
// The report TEXT is built here, because it is text arithmetic over what the
// caller sent — D67's split, the same call D59 made for the CSV parser and D71
// for BM25. Every decision about what may be STORED is the contract's: it sets
// `state_reportable` and `severity` itself, maps the state code onto a real
// incident type, and records the verified address rather than the name the
// form claimed.
import { fail } from './contracts.mjs';

/** The original's `buildReportText`, interpolation for interpolation. */
export function buildReportText(payload, submittedOn) {
  const value = (candidate, fallback = '') => candidate || fallback;
  const title = payload.submitted_by_title ? ` (${payload.submitted_by_title})` : '';
  return `
STATE REPORTABLE EVENT REPORT
==============================
Patient: ${value(payload.patient_name, payload.patient_id)}
Date of Event: ${value(payload.event_date)}
Time of Event: ${value(payload.event_time)}
Event Type: ${value(payload.event_type)}
Location of Event: ${value(payload.location_of_event)}

Medications (Name & Frequency):
${value(payload.medications, 'Not provided')}

Diagnosis of Patient:
${value(payload.diagnosis, 'Not provided')}

Factual Description:
${value(payload.factual_description)}

Description of Follow-up Action:
${value(payload.followup_action)}

Submitted By: ${value(payload.submitted_by_name, 'Unknown')}${title}
Submitted On: ${submittedOn}
  `.trim();
}

/** The fields the report text and the stored detail are built from. */
export const STATE_INCIDENT_FIELDS = Object.freeze([
  'patient_id', 'event_type', 'event_type_id', 'event_date', 'event_time',
  'location_of_event', 'medications', 'diagnosis', 'factual_description',
  'followup_action', 'submitted_by_name', 'submitted_by_title', 'source',
  'photo_urls', 'report_text', 'client_request_id',
]);

/**
 * Submit one state-reportable event.
 *
 * The authorization is the contract's: the original's gate is
 * `patient.created_by`, `patient.assigned_nurses` and the `SUPER_ADMIN_EMAIL`
 * owner, and the chart policies answer all three.
 */
export async function submitStateIncident({ params, contract }) {
  const patientId = typeof params?.patient_id === 'string' ? params.patient_id.trim() : '';
  if (!patientId) fail(400, 'STATE_INCIDENT_PATIENT_REQUIRED');
  const eventType = typeof params.event_type === 'string' ? params.event_type.trim() : '';
  if (!eventType) fail(400, 'STATE_INCIDENT_EVENT_TYPE_REQUIRED');
  if (typeof params.event_date !== 'string' || !params.event_date.trim()) {
    fail(400, 'STATE_INCIDENT_EVENT_DATE_REQUIRED');
  }
  if (params.photo_urls !== undefined && !Array.isArray(params.photo_urls)) {
    fail(400, 'STATE_INCIDENT_PHOTOS_INVALID');
  }
  // The original refuses unless one of these is present:
  //     !(payload.factual_description || payload.report_text)
  // Without it a request carrying only patient, type and date produces a
  // template whose factual-description section is BLANK and stores it as a
  // state-reportable incident — a widening of a compliance submission
  // contract, and the most serious incident class the product has.
  const narrative = [params.factual_description, params.report_text]
    .some(value => typeof value === 'string' && value.trim());
  if (!narrative) fail(400, 'STATE_INCIDENT_NARRATIVE_REQUIRED');

  // The original accepts a caller-supplied `report_text` and builds one when
  // it is absent. Kept: a clinician who edited the narrative in the form is
  // submitting what they wrote, not what a template would have said.
  const reportText = typeof params.report_text === 'string' && params.report_text.trim()
    ? params.report_text
    : buildReportText({ ...params, patient_id: patientId, event_type: eventType },
      new Date().toLocaleString());

  const answer = await contract('submitStateIncident', {
    incident: {
      patient_id: patientId,
      event_type: eventType,
      event_type_id: params.event_type_id ?? null,
      event_date: params.event_date.trim(),
      event_time: params.event_time ?? '',
      location_of_event: params.location_of_event ?? null,
      medications: params.medications ?? null,
      diagnosis: params.diagnosis ?? null,
      factual_description: params.factual_description ?? null,
      followup_action: params.followup_action ?? null,
      submitted_by_title: params.submitted_by_title ?? null,
      source: params.source ?? null,
      photo_urls: params.photo_urls ?? [],
      report_text: reportText,
      ...(params.client_request_id === undefined
        ? {} : { client_request_id: params.client_request_id }),
    },
  });
  const notified = answer.notified ?? 0;
  return {
    success: true,
    incident: answer.incident,
    notified,
    deduplicated: answer.deduplicated === true,
    // Reported rather than skipped, so nothing reads as though it happened.
    document_retention_paused: true,
    email_paused: true,
    /*
     * The ORIGINAL's key names, which the live callers actually read.
     * `EventReport.jsx` branches on `admin_count`, then `emails_sent`, then
     * `pdf_retained`; returning none of them made every submission take the
     * "NO administrators were found" branch even when notifications were
     * minted. D72's rule: the consumer has already written the field set down.
     *
     * They carry TRUTHFUL values rather than flattering ones. `admin_count` is
     * the number actually notified in-app; `emails_sent` is 0 and
     * `pdf_retained` is false because both halves are paused, which is what
     * makes `EventReport.jsx` tell the reporter to keep their own copy — the
     * correct thing to say while retention is paused. `delivery_paused` is
     * added so a caller can distinguish "paused" from "failed".
     */
    admin_count: notified,
    emails_sent: 0,
    pdf_retained: false,
    delivery_paused: true,
  };
}
