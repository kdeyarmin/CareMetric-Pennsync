// Ported handler registry.
//
// A handler appears here only after its Base44 original has been read and its
// behavior reproduced. Presence is not release: `runtime.mjs` requires each
// name to be listed in PENNSYNC_API_FUNCTIONS before it can be reached, and the
// list is empty unless an operator sets it.
//
// Every handler receives the caller's already-resolved current authority. A
// handler never resolves its own authority and never widens it.
import { exactObject, fail, isObject } from './contracts.mjs';
import { buildSmartNoteData } from './transforms.mjs';
import { syncCmsRegulations } from './cms-regulations.mjs';
import { triageReferral } from './referral-triage.mjs';
import { analyzeVisitSupplyUsage } from './visit-supply-usage.mjs';
import { MAX_CSV_BYTES, importProviders } from './provider-import.mjs';
import { expandClinicalPhrase as runClinicalPhrase } from './clinical-phrase.mjs';
import { exportPatientChart } from './chart-export.mjs';
import { AI_REPORT_PARAMS, generateAiReport } from './ai-report.mjs';
import { searchIndexedPdfs } from './pdf-search.mjs';
import { sendAccountReadyEmail, sendWelcomeEmail } from './account-email.mjs';
import {
  STATE_INCIDENT_FIELDS, submitStateIncident,
} from './state-incident.mjs';
import { generateFollowUpTasks as runFollowUpTasks } from './follow-up-tasks.mjs';
import {
  analyzeClinicalEvents as runClinicalEvents,
  analyzeClinicalTrends as runClinicalTrends,
} from './clinical-analysis.mjs';
import {
  analyzeAndGenerateClinicalTasks as runTaskSuggestions,
} from './clinical-task-suggestions.mjs';
import {
  extractClinicalEvents as runClinicalExtraction,
} from './clinical-extraction.mjs';
import {
  BAG_TECHNIQUE_FILENAME, SMART_NOTE_GUIDE_FILENAME, USER_MANUAL_FILENAME,
  buildBagTechniqueChecklist, buildSmartNoteGuide, buildUserManual, documentDate,
} from './documents.mjs';
import {
  ROSTER_FORMAT, buildUserRoster, rosterFilename,
} from './document-user-roster.mjs';
import { analyzeReferralPriority as runReferralPriority } from './referral-priority.mjs';
import { analyzeReferralIntake as runReferralIntake } from './referral-intake.mjs';
import { generateReferralTasks as runReferralTasks } from './referral-tasks.mjs';
import { matchPatientWithAI as runPatientMatch } from './patient-match.mjs';
import { analyzeReferral as runReferralAnalysis } from './referral-analysis.mjs';
import { GUIDE_FORMAT, buildUserGuide } from './document-user-guide.mjs';
import { generatePatientHandout } from './patient-handout.mjs';
import { USER_GUIDE_PROMPTS, USER_GUIDE_SCHEMA, resolveGuideType } from './user-guide-prompts.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validateEmail = (email) => {
  if (!email) return null;
  return EMAIL.test(email) ? null : 'Invalid email format. Must be in format: user@domain.com';
};

const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length !== 10 && cleaned.length !== 11) return 'Phone number must be 10 digits (or 11 with country code)';
  if (cleaned.length === 11 && cleaned[0] !== '1') return '11-digit phone numbers must start with 1';
  return null;
};

const validateDate = (value, fieldName = 'date') => {
  if (!value) return null;
  if (!DATE.test(value)) return `${fieldName} must be in YYYY-MM-DD format (e.g., 2024-12-18)`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Invalid ${fieldName}`;
  if (fieldName === 'date_of_birth' && parsed > new Date()) return 'Date of birth cannot be in the future';
  return null;
};

/**
 * Field-level validation ported from base44/functions/validatePatientData.
 *
 * The rules, messages and field names are preserved exactly so a migrated
 * caller sees the same result. The function reads no record and writes
 * nothing, which is why it is the first port: it exercises the transport,
 * release gate and authority path without moving clinical data.
 */
export function validatePatientData(patient) {
  const errors = [];
  const required = (field, message) => {
    const value = patient[field];
    if (!value || String(value).trim() === '') errors.push({ field, message });
  };
  required('first_name', 'First name is required');
  required('last_name', 'Last name is required');

  if (!patient.date_of_birth) {
    errors.push({ field: 'date_of_birth', message: 'Date of birth is required' });
  } else {
    const message = validateDate(patient.date_of_birth, 'date_of_birth');
    if (message) errors.push({ field: 'date_of_birth', message });
  }

  for (const [field, check, prefix] of [
    ['email', validateEmail, ''],
    ['phone', validatePhone, ''],
    ['emergency_contact_phone', validatePhone, 'Emergency contact phone: '],
    ['physician_email', validateEmail, 'Physician email: '],
    ['physician_phone', validatePhone, 'Physician phone: '],
    ['caregiver_email', validateEmail, 'Caregiver email: '],
    ['caregiver_phone', validatePhone, 'Caregiver phone: '],
  ]) {
    if (!patient[field]) continue;
    const message = check(patient[field]);
    if (message) errors.push({ field, message: prefix + message });
  }

  if (patient.admission_date) {
    const message = validateDate(patient.admission_date, 'admission_date');
    if (message) errors.push({ field: 'admission_date', message });
  }
  return errors;
}

/**
 * Each entry declares the shape it accepts. Unknown parameters are refused
 * rather than ignored, so a caller cannot smuggle an unreviewed field past a
 * handler that happens not to read it.
 */
/**
 * Renders a ported document. The builder is pure and parity-tested against its
 * Base44 original; this is the only place that needs a PDF library, and it is
 * loaded on first use so a deployment that never releases a document handler
 * never loads it.
 */
async function renderDocument(build, config) {
  const { jsPDF } = await import('jspdf');
  return build(new jsPDF(), {
    logoDataUrl: config?.documentLogoDataUrl || null,
    generatedOn: documentDate(),
  }).output('arraybuffer');
}

/** Answers with the bytes, as `generateBagTechniquePDF` and `generateUserManual` did. */
async function pdfResponse(build, filename, config) {
  return { binary: true, body: await renderDocument(build, config), contentType: 'application/pdf', filename };
}

/**
 * Answers with base64 inside the envelope, as `generateSmartNoteGuide` did.
 *
 * The original chunked the bytes through `String.fromCharCode` and `btoa` to
 * avoid blowing the argument limit on a large document; `Buffer` produces the
 * same string without the dance.
 */
async function pdfBase64Response(build, filename, config) {
  return { pdf: Buffer.from(await renderDocument(build, config)).toString('base64'), filename };
}

export const HANDLERS = Object.freeze({
  // Each original took no parameters and rendered the same document for any
  // authenticated caller. That is kept, with the membership this service
  // requires added, since it has no global scope.
  listPolicyLibrary: Object.freeze({
    // The first port that reads an entity row, and the first to reach a
    // reviewed per-capability contract rather than the generic family.
    // `PolicyLibrary` returns `doc_url` — a locator into our own storage — so
    // D16's ceiling keeps it out of the family on purpose; the contract hands
    // it to this capability's callers, which is a decision about one endpoint.
    //
    // The authorization is the contract's and is not restated here. Who may see
    // drafts and archived policies is answered by the database, where the rest
    // of this design puts authorization; a copy in this handler would be a
    // second answer to keep in agreement with it.
    handle({ params, contract }) {
      exactObject(params, ['mode'], 'INVALID_PARAMS');
      return contract('listPolicyLibrary', params);
    },
  }),
  manageAuthorizedReferral: Object.freeze({
    // Referral intake, six actions over one contract. The largest capability
    // in the migration, and the envelope's per-action key sets are the
    // original's `assertOnlyKeys` table, field for field — so a caller who
    // sends `limit` to `get` is refused rather than having it ignored.
    //
    // `list_assignees` routes to this contract's own statement, which is a
    // filter over `pennsync_private.agency_roster` (D48). It is NOT routed to
    // `listAgencyRoster` the way the fleet's `staff` action is, and the
    // difference is worth knowing: that roster pages by keyset and projects
    // personnel detail by role, while this picker is a bounded list of three
    // roles with the membership id and version the published client
    // validates. Routing it to D22's roster would have handed an intake
    // clerk a paged staff directory to reassemble.
    //
    // The authorization is the contract's and is not restated here. Which
    // roles may work the queue, who may be given a referral, and which
    // referrals a caller opens at all are all decided in the database.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'list') {
        exactObject(params, ['action', 'limit', 'patient_id', 'status', 'assigned_to'],
          'INVALID_PARAMS');
        return contract('listAuthorizedReferrals', params);
      }
      if (params.action === 'get') {
        exactObject(params, ['action', 'referral_id'], 'INVALID_PARAMS');
        return contract('getAuthorizedReferral', params);
      }
      if (params.action === 'list_assignees') {
        exactObject(params, ['action'], 'INVALID_PARAMS');
        return contract('listAuthorizedReferralAssignees', {});
      }
      if (params.action === 'create') {
        exactObject(params, ['action', 'client_request_id', 'referral'], 'INVALID_PARAMS');
        if (!isObject(params.referral)) fail(400, 'INVALID_PARAMS');
        return contract('createAuthorizedReferral', params);
      }
      if (params.action === 'update') {
        exactObject(params, ['action', 'referral_id', 'changes'], 'INVALID_PARAMS');
        if (!isObject(params.changes)) fail(400, 'INVALID_PARAMS');
        return contract('updateAuthorizedReferral', params);
      }
      // The original's action is called `delete` and archives; the contract is
      // called `archive` and says so. The wire name stays the original's
      // because published clients send it.
      if (params.action === 'delete') {
        exactObject(params, ['action', 'referral_id'], 'INVALID_PARAMS');
        return contract('archiveAuthorizedReferral', params);
      }
      return fail(400, 'INVALID_PARAMS');
    },
  }),
  listAgencyRoster: Object.freeze({
    // D23. Not a ported Base44 name: the original read the `User` entity from
    // each of 35 capabilities, and what replaces that is one reviewed contract
    // rather than 35 copies of a query.
    //
    // The authorization is the contract's and is not restated here — who sees
    // a colleague's telephone number and credentials is decided by the
    // authoritative tenant role in the database, not by this handler and not
    // by the self-editable `is_manager` flag on the carried row.
    handle({ params, contract }) {
      exactObject(params, ['limit', 'after'], 'INVALID_PARAMS');
      return contract('listAgencyRoster', params);
    },
  }),
  getAgencyRosterMember: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['user_id'], 'INVALID_PARAMS');
      return contract('getAgencyRosterMember', params);
    },
  }),
  // The seven reference and configuration reads (D101).
  //
  // Each is one line over its contract, and that is the whole point: the
  // frontend called these seven entities straight through Base44's SDK, so what
  // had to be decided was who may read them, and that decision is in SQL where
  // the policies it sits beside are. A gate here would be the second copy D41
  // and D43 keep deleting.
  //
  // Note what is NOT in these params. No sort string, no filter object, no
  // offset. The orders these screens ask for are done in SQL by the contract,
  // the one predicate any of them needs is a date WINDOW, and `order` is a word
  // from a fixed set rather than a column a caller names. A capability that
  // took a caller's sort expression would be the generic entity route this
  // service does not have.
  listMedicareComplianceRules: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit'], 'INVALID_PARAMS');
      return contract('listMedicareComplianceRules', params);
    },
  }),
  listMedicareGuidelines: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit', 'active'], 'INVALID_PARAMS');
      return contract('listMedicareGuidelines', params);
    },
  }),
  listPhysicians: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit', 'order', 'active'], 'INVALID_PARAMS');
      return contract('listPhysicians', params);
    },
  }),
  listDocumentTemplates: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit'], 'INVALID_PARAMS');
      return contract('listDocumentTemplates', params);
    },
  }),
  listLibraryDocuments: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit'], 'INVALID_PARAMS');
      return contract('listLibraryDocuments', params);
    },
  }),
  listOnCallShifts: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit', 'from', 'to'], 'INVALID_PARAMS');
      return contract('listOnCallShifts', params);
    },
  }),
  listVisitPointConfigs: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['limit'], 'INVALID_PARAMS');
      return contract('listVisitPointConfigs', params);
    },
  }),
  listBrokeredRecords: Object.freeze({
    // D16's ceiling, given a caller at last.
    //
    // The tenant-scoped broker family has been generated, migrated and applied
    // for a long time — three entities, all read-only, each admitted only
    // because its own schema plainly permits the read — and nothing could
    // reach it: no
    // handler destructured `records`, so it served no request the browser
    // could make. This is that handler, and it is the whole of it.
    //
    // It takes an entity NAME from the caller, which looks like the generic
    // entity route this service deliberately does not have and is not one. The
    // set of names that can succeed is `BROKERED_ENTITIES`, generated beside
    // the family's SQL from the dispositions, and it is enforced three times
    // over: here by nothing at all, in `records.mjs` against that generated
    // list, and in the database by a family that resolves no other relation.
    // Adding a name means changing an entity's disposition and regenerating —
    // which re-runs D16's audit — not editing anything here.
    //
    // The ORDER and the PREDICATE the screens ask for are deliberately absent.
    // The family pages by id and offers neither, and answering a sort by
    // ignoring it is the silent-reorder bug; the caller proves it holds the
    // whole set and orders it itself.
    handle({ params, records }) {
      exactObject(params, ['entity', 'limit', 'after'], 'INVALID_PARAMS');
      if (typeof params.entity !== 'string' || !params.entity) fail(400, 'INVALID_PARAMS');
      const { entity, ...page } = params;
      return records('list', entity, page);
    },
  }),
  listAuthorizedPatients: Object.freeze({
    // The first ported capability that reads clinical rows.
    //
    // The original is 1,404 lines, and almost all of them are work Base44
    // forced on it: no row-level security, so it built the tenant query
    // itself, re-resolved the caller's membership four times around it,
    // re-read every care-team assignment after choosing the rows, and ran the
    // whole read twice to catch an authority change in between. Here the rows
    // a caller may see are decided by the policies on the table inside one
    // statement in one snapshot — tenancy from `caller_agencies()`, the chart
    // from D24 — so there is no window between the check and the read to
    // fence off, and nothing for this handler to re-check.
    //
    // What is left for the handler is the shape of the request, and the shape
    // is per mode, exactly as the original's is: naming `patient_ids` on a
    // page is not a request anybody meant, and neither is naming a cursor on
    // a batch. Who may see which fields is the contract's, in the database,
    // and is not restated here.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const mode = params.mode === undefined ? 'page' : params.mode;
      if (mode === 'page') {
        exactObject(params, ['mode', 'purpose', 'status', 'sort', 'page_size', 'after'], 'INVALID_PARAMS');
        // The contract orders by id ascending and has no second ordering to
        // offer. The original takes the argument and refuses anything else,
        // so a caller that sends it still gets the answer it expects.
        if (params.sort !== undefined && params.sort !== 'id_asc') fail(400, 'INVALID_PARAMS');
        const { mode: unused, sort: alsoUnused, ...rest } = params;
        return contract('listAuthorizedPatientsPage', rest);
      }
      if (mode === 'ids') {
        exactObject(params, ['mode', 'purpose', 'patient_ids'], 'INVALID_PARAMS');
        const { mode: unused, ...rest } = params;
        return contract('listAuthorizedPatientsBatch', rest);
      }
      fail(400, 'INVALID_PARAMS');
    },
  }),
  getAuthorizedPatient: Object.freeze({
    // One chart, under its own purposes. The contract answers null for a
    // chart that is not there and for one that is not this caller's, in the
    // same words, so that an id cannot be tested for existence; the original
    // answers 404 to both for the same reason, and so does this.
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id'], 'INVALID_PARAMS');
      const patient = await contract('getAuthorizedPatient', params);
      if (patient === null) fail(404, 'PATIENT_UNAVAILABLE');
      return { patient };
    },
  }),
  listAuthorizedVisits: Object.freeze({
    // The same shape as the patient list and for the same reasons; the one
    // thing worth naming is `patient_id`, which is what a chart's visit
    // history is. It narrows a read the caller is already entitled to and
    // cannot widen one: D24 decided which visits they can see at all.
    handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id', 'status', 'sort', 'page_size', 'after'], 'INVALID_PARAMS');
      // The contract orders by id ascending and has no second ordering to
      // offer. The original takes the argument and refuses anything else.
      if (params.sort !== undefined && params.sort !== 'id_asc') fail(400, 'INVALID_PARAMS');
      const { sort: unused, ...rest } = params;
      return contract('listAuthorizedVisits', rest);
    },
  }),
  getAuthorizedVisit: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'visit_id'], 'INVALID_PARAMS');
      const visit = await contract('getAuthorizedVisit', params);
      if (visit === null) fail(404, 'VISIT_UNAVAILABLE');
      return { visit };
    },
  }),
  listAuthorizedDocuments: Object.freeze({
    // `binding_purpose` is what a document is attached to — a patient's chart
    // or a referral — and `patient_id` narrows to one chart. A caller who
    // does not open every chart must name one; that rule is the contract's,
    // not this handler's, because it is about who is asking.
    handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id', 'binding_purpose', 'sort', 'page_size', 'after'],
        'INVALID_PARAMS');
      // The contract orders by document id ascending and has no second
      // ordering to offer. The original takes the argument and refuses
      // anything else, under its own name for the same order.
      if (params.sort !== undefined && params.sort !== 'document_id_asc') fail(400, 'INVALID_PARAMS');
      const { sort: unused, ...rest } = params;
      return contract('listAuthorizedDocuments', rest);
    },
  }),
  getAuthorizedDocument: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'document_id'], 'INVALID_PARAMS');
      const document = await contract('getAuthorizedDocument', params);
      if (document === null) fail(404, 'DOCUMENT_UNAVAILABLE');
      return { document };
    },
  }),
  createAuthorizedPatient: Object.freeze({
    // The first ported write. Which fields a client may supply is the
    // contract's, checked in SQL against a list extracted from the original
    // rather than retyped — so this handler does not carry a copy of it, and
    // a field added to the original reaches the database by regenerating
    // rather than by remembering.
    handle({ params, contract }) {
      exactObject(params, ['client_request_id', 'patient'], 'INVALID_PARAMS');
      if (!isObject(params.patient)) fail(400, 'INVALID_PARAMS');
      return contract('createAuthorizedPatient', params);
    },
  }),
  updateAuthorizedPatient: Object.freeze({
    // A caller names workflow actions, never a patch. Which actions exist,
    // which fields each one may touch and which roles may perform it are all
    // the contract's, checked in SQL against the original's own fenced
    // declaration — so this handler checks the envelope and nothing else, and
    // an action added to the original reaches the database by regenerating
    // rather than by remembering.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'expected_updated_date', 'actions'], 'INVALID_PARAMS');
      if (!Array.isArray(params.actions)) fail(400, 'INVALID_PARAMS');
      return contract('updateAuthorizedPatient', params);
    },
  }),
  createAuthorizedVisit: Object.freeze({
    // Scheduling input and nothing else. Which fields a client may supply is
    // the contract's, checked in SQL against a list extracted from the
    // original, and so is who may schedule against which chart — so this
    // handler checks the envelope and carries no copy of either.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'client_request_id', 'visit'], 'INVALID_PARAMS');
      if (!isObject(params.visit)) fail(400, 'INVALID_PARAMS');
      return contract('createAuthorizedVisit', params);
    },
  }),
  updateAuthorizedVisit: Object.freeze({
    // A caller names one workflow action and the fields it accepts. Which
    // actions exist, which this port serves, which inputs each accepts and who
    // may perform it are all the contract's — so this handler checks the
    // envelope and nothing else, and the four served actions grow by changing
    // the extraction rather than by editing here.
    handle({ params, contract }) {
      exactObject(params, ['visit_id', 'action', 'fields'], 'INVALID_PARAMS');
      if (!isObject(params.fields)) fail(400, 'INVALID_PARAMS');
      return contract('updateAuthorizedVisit', params);
    },
  }),
  getScopedPatientAlerts: Object.freeze({
    // "Scoped" in the original meant the caller's own charts, worked out from
    // `Patient.assigned_nurses`. It means D24's care team now, decided by the
    // policies, so this handler carries no scope of its own.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'status', 'severity', 'limit'], 'INVALID_PARAMS');
      if (params.severity !== undefined && !Array.isArray(params.severity)) {
        fail(400, 'INVALID_PARAMS');
      }
      return contract('getScopedPatientAlerts', params);
    },
  }),
  updateScopedPatientAlert: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['alert_id', 'action', 'resolution_notes'], 'INVALID_PARAMS');
      return contract('updateScopedPatientAlert', params);
    },
  }),
  getAuthorizedPatientNoteHistory: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'event_limit', 'offset'], 'INVALID_PARAMS');
      return contract('getAuthorizedPatientNoteHistory', params);
    },
  }),
  appendPatientNoteHistory: Object.freeze({
    // Every save appends an event; nothing edits one. The store enforces that
    // rather than the handler: D32 gives the table no update or delete policy
    // at all, because its own schema calls the row immutable.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'mode', 'entry', 'clinical_notes'], 'INVALID_PARAMS');
      if (!isObject(params.entry)) fail(400, 'INVALID_PARAMS');
      return contract('appendPatientNoteHistory', params);
    },
  }),
  saveVisitPointConfig: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['config'], 'INVALID_PARAMS');
      if (!isObject(params.config)) fail(400, 'INVALID_PARAMS');
      return contract('saveVisitPointConfig', params);
    },
  }),
  savePayrollProfile: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['employee_email', 'profile'], 'INVALID_PARAMS');
      if (!isObject(params.profile)) fail(400, 'INVALID_PARAMS');
      return contract('savePayrollProfile', params);
    },
  }),
  manageVehicleMaintenance: Object.freeze({
    // Eight actions, six contracts. `context` and `staff` are routed to
    // contracts that already exist — D34's tenant memberships and D22's
    // roster — because the authority store has modelled both since before
    // this capability was looked at. The envelope's per-action key sets are
    // the original's `actionKeys` table, field for field.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'context') {
        exactObject(params, ['action'], 'INVALID_PARAMS');
        return contract('listMyTenantMemberships', {});
      }
      if (params.action === 'staff') {
        exactObject(params, ['action', 'offset'], 'INVALID_PARAMS');
        // D22's roster pages by KEYSET and the original pages by a numeric
        // offset, which cannot be translated into one. The original already
        // solves this for its own `history` action — it forwards an opaque
        // token in the offset property and, in its own words, "Stale numeric
        // offsets are rejected, not skipped" — so `staff` does the same: a
        // cursor is passed through, and a number that is not the first page
        // is refused rather than silently answering the first page again.
        if (typeof params.offset === 'number' && params.offset !== 0) {
          fail(400, 'INVALID_PARAMS');
        }
        const after = typeof params.offset === 'string' ? params.offset : undefined;
        return contract('listAgencyRoster', after === undefined ? {} : { after });
      }
      if (params.action === 'vehicles') {
        exactObject(params, ['action', 'offset', 'include_retired'], 'INVALID_PARAMS');
        return contract('listFleetVehicles', params);
      }
      if (params.action === 'history') {
        exactObject(params, ['action', 'vehicle_id', 'offset', 'cursor'], 'INVALID_PARAMS');
        // The original accepts the opaque token in either property and
        // refuses a stale numeric offset rather than skipping it.
        if (params.cursor !== undefined && params.offset !== undefined) {
          fail(400, 'INVALID_PARAMS');
        }
        return contract('getFleetVehicleHistory', {
          vehicle_id: params.vehicle_id,
          cursor: params.cursor ?? params.offset ?? null,
        });
      }
      if (params.action === 'create_vehicle') {
        exactObject(params, ['action', 'request_id', 'vehicle'], 'INVALID_PARAMS');
        if (!isObject(params.vehicle)) fail(400, 'INVALID_PARAMS');
        return contract('createFleetVehicle', params);
      }
      if (params.action === 'update_vehicle') {
        exactObject(params, ['action', 'vehicle_id', 'expected_version', 'vehicle'],
          'INVALID_PARAMS');
        if (!isObject(params.vehicle)
          || !Number.isSafeInteger(params.expected_version)) fail(400, 'INVALID_PARAMS');
        return contract('updateFleetVehicle', params);
      }
      if (params.action === 'add_entry') {
        exactObject(params, ['action', 'vehicle_id', 'request_id', 'entry'], 'INVALID_PARAMS');
        if (!isObject(params.entry)) fail(400, 'INVALID_PARAMS');
        return contract('addFleetServiceEntry', params);
      }
      if (params.action === 'review_entry') {
        exactObject(params, ['action', 'vehicle_id', 'entry_id', 'request_id',
          'expected_review_count', 'status', 'note'], 'INVALID_PARAMS');
        if (!Number.isSafeInteger(params.expected_review_count)) fail(400, 'INVALID_PARAMS');
        return contract('reviewFleetServiceEntry', params);
      }
      return fail(400, 'INVALID_PARAMS');
    },
  }),
  createNotification: Object.freeze({
    // The original's flat body, packed. `agency_id` is dropped: every request
    // to this service names its tenant in the envelope, which is the invariant
    // D34 settled, so a second copy in the body could only disagree with it.
    handle({ params, contract }) {
      exactObject(params, ['agency_id', 'user_email', 'title', 'message', 'type',
        'priority', 'action_url', 'action_label', 'metadata', 'patient_id'],
      'INVALID_PARAMS');
      const { agency_id: named, ...notification } = params;
      if (named !== undefined && typeof named !== 'string') fail(400, 'INVALID_PARAMS');
      return contract('createNotification', { notification });
    },
  }),
  manageMyNotifications: Object.freeze({
    // The original's one envelope over three actions, and its own rule for
    // which keys each carries: a list and a mark-all name no row, and the two
    // single-row actions name one with the version they saw.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'list') {
        exactObject(params, ['action'], 'INVALID_PARAMS');
        return contract('listMyNotifications', {});
      }
      if (params.action === 'mark_all_read') {
        exactObject(params, ['action'], 'INVALID_PARAMS');
        return contract('markAllMyNotificationsRead', {});
      }
      if (params.action !== 'mark_read' && params.action !== 'dismiss') {
        fail(400, 'INVALID_PARAMS');
      }
      exactObject(params, ['action', 'notification_id', 'expected_version'], 'INVALID_PARAMS');
      if (!Number.isSafeInteger(params.expected_version)) fail(400, 'INVALID_PARAMS');
      return contract('transitionMyNotification', params);
    },
  }),
  submitIncidentReport: Object.freeze({
    // The flat payload both callers send — the reporting form and the retired
    // offline queue's drain, which is the only sender of `client_request_id`
    // and the reason the key survives into the stored row.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'patient_name', 'incident_type',
        'incident_name', 'incident_date', 'incident_time', 'severity', 'details',
        'report', 'photo_urls', 'physician_notified', 'office_notified',
        'immediate_alert', 'client_request_id'], 'INVALID_PARAMS');
      // `patient_name` is accepted and ignored: the contract reads the name
      // off the chart. Refusing it would break the form for no gain.
      return contract('submitIncidentReport', { incident: params });
    },
  }),
  updateIncident: Object.freeze({
    // The envelope is action-dependent, as the original's is: a patch carries
    // no status, a transition carries no patch, and a reassignment carries
    // only the destination chart. Everything past the envelope — who may act,
    // which field is a reviewer's, which transition is legal, and whether a
    // corrective action is owed — is the contract's.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'patch') {
        exactObject(params, ['action', 'incident_id', 'patch'], 'INVALID_PARAMS');
        if (!isObject(params.patch)) fail(400, 'INVALID_PARAMS');
      } else if (params.action === 'transition') {
        exactObject(params, ['action', 'incident_id', 'to_status',
          'resolution_notes', 'corrective_action_plan'], 'INVALID_PARAMS');
      } else if (params.action === 'reassign_patient') {
        exactObject(params, ['action', 'incident_id', 'patient_id'], 'INVALID_PARAMS');
      } else {
        fail(400, 'INVALID_PARAMS');
      }
      return contract('updateIncident', params);
    },
  }),
  submitTimesheet: Object.freeze({
    // The original's flat body, packed: `timesheet_id` names an existing sheet
    // and everything else is the sheet itself.
    handle({ params, contract }) {
      exactObject(params, ['timesheet_id', 'pay_period_start', 'pay_period_end',
        'notes', 'manager_email', 'status', 'entry_mode', 'daily_entries',
        'visit_counts', 'regular_points', 'emergency_visit_points', 'regular_hours',
        'overtime_hours', 'vacation_hours', 'holiday_hours', 'on_call_hours',
        'on_call_visits', 'miles', 'reimbursement'], 'INVALID_PARAMS');
      const { timesheet_id: id, ...timesheet } = params;
      if (id !== undefined && typeof id !== 'string') fail(400, 'INVALID_PARAMS');
      return contract('submitTimesheet', { timesheet_id: id ?? null, timesheet });
    },
  }),
  reviewTimesheet: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['timesheet_id', 'decision', 'note'], 'INVALID_PARAMS');
      return contract('reviewTimesheet', params);
    },
  }),
  checkAdrDeadlines: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('checkAdrDeadlines', params);
    },
  }),
  extractClinicalEvents: Object.freeze({
    // The body keys are the original's, and `visit_date` is NOT among them:
    // the event's date is the visit's own, which the contract returns.
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['visit_id', 'patient_id', 'nurse_notes'], 'INVALID_PARAMS');
      return runClinicalExtraction({ params, integration, contract });
    },
  }),
  analyzeAndGenerateClinicalTasks: Object.freeze({
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['patientId'], 'INVALID_PARAMS');
      return runTaskSuggestions({ params, integration, contract });
    },
  }),
  analyzeClinicalEvents: Object.freeze({
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['patient_id'], 'INVALID_PARAMS');
      return runClinicalEvents({ params, integration, contract });
    },
  }),
  analyzeClinicalTrends: Object.freeze({
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['patient_id'], 'INVALID_PARAMS');
      return runClinicalTrends({ params, integration, contract });
    },
  }),
  generateFollowUpTasks: Object.freeze({
    // The body keys are the original's (D58). `visitType` and `diagnosis` only
    // reach the prompt; nothing a caller sends decides who may be read.
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['noteText', 'patientId', 'visitId', 'visitType', 'diagnosis'],
        'INVALID_PARAMS');
      return runFollowUpTasks({ params, integration, contract });
    },
  }),
  expandClinicalPhrase: Object.freeze({
    // The body keys are the original's: `QuickPhraseTextarea.jsx` sends them
    // and the SPA is shared between both backends (D58).
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['phrase', 'patientId', 'contextData'], 'INVALID_PARAMS');
      return runClinicalPhrase({ params, integration, contract });
    },
  }),
  importProvidersCsv: Object.freeze({
    /*
     * The one handler whose request is larger than the service default.
     * `app.mjs` reads every body at `MAX_BODY` (1 MiB), while this capability
     * and its Base44 original both advertise a 10 MiB CSV — so every import
     * between those two figures was refused `BODY_TOO_LARGE` before the
     * parser ever ran, which is an accidental NARROWING of the original.
     *
     * Declared on the handler for the reason `needsIntegration` is: a
     * hand-maintained list in `app.mjs` would drift from the handler it
     * describes. The figure is twice `MAX_CSV_BYTES` because the CSV arrives
     * inside a JSON string, and escaping quotes and newlines can approach
     * doubling it — a ceiling that only admitted the unescaped size would
     * reintroduce the same defect for exactly the quote-heavy files most
     * likely to be near the limit.
     */
    maxBody: 2 * MAX_CSV_BYTES,
    // A PARTIAL port. The `csv_text` branch is what the SPA calls and what the
    // original's own comment says needs nothing else — "A provider directory
    // CSV needs no storage upload or AI integration" — while the legacy
    // `file_url` branch downloads through an allowlist naming Base44's own
    // storage host, which is the file-layer dependency D56 measured.
    handle({ params, contract }) {
      exactObject(params, ['csv_text', 'file_url'], 'INVALID_PARAMS');
      return importProviders({ params, contract });
    },
  }),
  analyzeVisitForSupplyUsage: Object.freeze({
    // The body keys are the original's: `src/pages/SmartNoteAssistant.jsx`
    // sends them and the SPA is shared between both backends, so renaming
    // them would break the capability on the independent path. That is the
    // counter-case to D57's rename, which was safe because nothing calls it.
    needsIntegration: true,
    handle({ params, integration, contract }) {
      exactObject(params, ['visitId', 'visitNotes', 'patientId'], 'INVALID_PARAMS');
      return analyzeVisitSupplyUsage({ params, integration, contract });
    },
  }),
  predictSupplyNeeds: Object.freeze({
    // The original's body key is `patientId`, the one camelCase body in the
    // set; every capability here names a chart `patient_id`, and nothing in
    // `src/` calls this one, so there is no caller to keep in step with the
    // outlier. The rename is the whole of the request-shape change.
    handle({ params, contract }) {
      exactObject(params, ['patient_id'], 'INVALID_PARAMS');
      return contract('predictSupplyNeeds', params);
    },
  }),
  sendPersonnelExpirationNotifications: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('sendPersonnelExpirationNotifications', params);
    },
  }),
  sendCredentialRenewalReminders: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('sendCredentialRenewalReminders', params);
    },
  }),
  sendExpirationNotifications: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('sendExpirationNotifications', params);
    },
  }),
  checkExpiredInvitations: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('checkExpiredInvitations', params);
    },
  }),
  resendInvitation: Object.freeze({
    // Both names reach the one contract: the two originals are the same file.
    async handle({ params, contract }) {
      exactObject(params, ['invitation_id'], 'INVALID_PARAMS');
      return { ...(await contract('resendInvitation', params)), delivery_paused: true };
    },
  }),
  resendInvitationV2: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['invitation_id'], 'INVALID_PARAMS');
      return { ...(await contract('resendInvitation', params)), delivery_paused: true };
    },
  }),
  auditDataQuality: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('auditDataQuality', params);
    },
  }),
  reviewPersonnelCredential: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['credential_id', 'action', 'rejection_reason'], 'INVALID_PARAMS');
      return { ...(await contract('reviewPersonnelCredential', params)), delivery_paused: true };
    },
  }),
  submitPersonnelCredential: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['credential_id', 'renews_credential_id', 'credential'],
        'INVALID_PARAMS');
      if (!isObject(params.credential)) fail(400, 'INVALID_PARAMS');
      return { ...(await contract('submitPersonnelCredential', params)), delivery_paused: true };
    },
  }),
  submitTimeOffRequest: Object.freeze({
    // `delivery_paused` is reported the way the original reports it when
    // `OUTBOUND_DELIVERY_RELEASE` is not `enabled-v1`: the record work is done
    // and the approver email is not sent. Outbound delivery is the integration
    // runtime's, which is deployed and paused, so the shape a migrated caller
    // already handles is the honest answer.
    async handle({ params, contract }) {
      exactObject(params, ['request_type', 'start_date', 'end_date', 'half_day',
        'reason', 'coverage', 'manager_email'], 'INVALID_PARAMS');
      return { ...(await contract('submitTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  cancelTimeOffRequest: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['request_id'], 'INVALID_PARAMS');
      return { ...(await contract('cancelTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  reviewTimeOffRequest: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['request_id', 'decision', 'note'], 'INVALID_PARAMS');
      return { ...(await contract('reviewTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  getApprovedTimeOff: Object.freeze({
    // The only one of the four that sends nothing, so it reports nothing.
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('getApprovedTimeOff', params);
    },
  }),
  getAiContentAgreementStatus: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('getAiContentAgreementStatus', params);
    },
  }),
  acceptAiContentAgreement: Object.freeze({
    // The original's body is exactly `{accepted: true, agreement_version}` and
    // nothing else. `accepted` carries no information a request to this
    // endpoint does not already carry, so it is required and then dropped:
    // a caller that sends `accepted: false` is refused rather than silently
    // treated as an acceptance.
    handle({ params, contract }) {
      exactObject(params, ['accepted', 'agreement_version'], 'INVALID_PARAMS');
      if (params.accepted !== true) fail(400, 'INVALID_PARAMS');
      return contract('acceptAiContentAgreement',
        { agreement_version: params.agreement_version });
    },
  }),
  policyAcknowledgment: Object.freeze({
    // The original defaults `action` to `acknowledge` when absent, and this
    // keeps that. `list` is refused HERE rather than at the contract, because
    // there is no contract to refuse it: its only performer was the platform
    // tier D14 and D22 removed, so nothing was written for it.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const action = params.action ?? 'acknowledge';
      if (action === 'list') fail(403, 'PENNSYNC_POLICY_ACK_ACTION_UNPORTED');
      if (action !== 'acknowledge') fail(400, 'INVALID_PARAMS');
      exactObject(params, ['action', 'acknowledgment_id', 'signed_name'], 'INVALID_PARAMS');
      return contract('acknowledgePolicy', params);
    },
  }),
  distributePolicyAcknowledgment: Object.freeze({
    // The distribution half of the policy pair, and the ONLY Base44 name that
    // reaches this contract. `policyId` is required upstream and is left to
    // the contract to refuse, which is where the message that names it lives.
    //
    // The four keys are the four the SPA sends, camelCase and unchanged: the
    // bundle is shared between both backends, so normalising the request shape
    // here would break the Base44 path (D58). An unknown key is refused rather
    // than ignored, which is what keeps `filters` from arriving as a top-level
    // field the contract would never read.
    handle({ params, contract }) {
      exactObject(params, ['policyId', 'dueDate', 'userEmails', 'filters'], 'INVALID_PARAMS');
      return contract('distributePolicyAcknowledgment', params);
    },
  }),
  manageAgencyMembership: Object.freeze({
    // One Base44 capability with six actions reaching two contracts, five of
    // them served. `provision` is NOT filtered out here: it reaches the
    // contract and is refused by name, because a caller asking for it is
    // asking for something real in the original and deserves to be told which
    // it is rather than "unknown action".
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'inspect') {
        exactObject(params, ['action', 'target_user_id'], 'INVALID_PARAMS');
        return contract('inspectAgencyMembership', params);
      }
      exactObject(params,
        ['action', 'target_user_id', 'tenant_role', 'reason', 'expected_version'],
        'INVALID_PARAMS');
      return contract('transitionAgencyMembership', params);
    },
  }),
  listMyTenantMemberships: Object.freeze({
    // The originals take an empty body; so does this.
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('listMyTenantMemberships', params);
    },
  }),
  getMyTenantContext: Object.freeze({
    // The original's optional `agency_id` is not a parameter here: the
    // envelope already names the agency this request acts in, and a second way
    // to name it is a second thing that can disagree with the first.
    handle({ params, contract }) {
      exactObject(params,
        ['expected_membership_id', 'expected_membership_version'], 'INVALID_PARAMS');
      return contract('getMyTenantContext', params);
    },
  }),
  managePatientCareTeamAssignment: Object.freeze({
    // One Base44 capability with five actions, reaching two contracts — the
    // same shape `listAuthorizedPatients` has. `inspect` was the only action
    // the original served: the other four were refused at module scope by
    // `CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false` before the handler read
    // anything, and D33 re-enables them because the owned store meets the
    // three conditions that pause names.
    //
    // The envelope is the original's and is action-dependent, which is why
    // there are three `exactObject` calls rather than one: an inspect carries
    // no request id, a grant carries no version, and a transition carries
    // both. Everything past the envelope — who may ask, who may be named, what
    // the reason must look like, which transition is legal — is the contract's.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const subject = ['patient_id', 'target_user_id'];
      if (params.action === 'inspect') {
        exactObject(params, ['action', ...subject], 'INVALID_PARAMS');
        return contract('inspectPatientCareTeamAssignment', params);
      }
      const transition = ['action', ...subject, 'client_request_id', 'reason'];
      exactObject(params, params.action === 'grant'
        ? transition : [...transition, 'expected_version'], 'INVALID_PARAMS');
      return contract('transitionPatientCareTeamAssignment', params);
    },
  }),
  generateBagTechniquePDF: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildBagTechniqueChecklist, BAG_TECHNIQUE_FILENAME, config);
    },
  }),
  generateSmartNoteGuide: Object.freeze({
    // Not a binary handler: this original answered with JSON carrying base64,
    // and a port answers the way its original did.
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfBase64Response(buildSmartNoteGuide, SMART_NOTE_GUIDE_FILENAME, config);
    },
  }),
  generatePatientHandout: Object.freeze({
    // A PARTIAL port: the document is served, and the email action is refused
    // with the answer the original itself gives while outbound delivery is
    // unreleased. JSON carrying base64 rather than bytes, because that is how
    // the original answered. The narrowings are in `patient-handout.mjs`.
    handle({ params, config }) {
      return generatePatientHandout({ params, config });
    },
  }),
  sendAccountReadyEmail: Object.freeze({
    // D86 shipped this as a PARTIAL port with nothing in the served half — the
    // whole capability is one `Core.SendEmail` — and D97 serves the send behind
    // `PENNSYNC_API_DELIVERY`. `needsIntegration` moves in the same change and
    // has to: D92's gate reads it off whether `handle` destructures
    // `integration`, both directions, so taking the capability here without the
    // flag fails the build. The comment it replaces cited
    // `generatePatientHandout`'s reason — the one integration it has is the half
    // that is paused — and that reason expired with the pause: a released
    // deployment's send really does need the runtime to report ready, and the
    // ladder must place these in the integration wave rather than in the
    // read-only one whose whole promise is that nothing in it writes or sends.
    needsIntegration: true,
    // Reaches an outbound channel, so `publicReadiness` refuses to report a
    // released deployment ready while `PENNSYNC_API_DELIVERY` is unset. Without
    // it a rollout probe passes while every send answers 503 — the same shape
    // `needsIntegration` exists to prevent one layer down.
    needsDelivery: true,
    handle({ actor, params, config, integration, contract }) {
      return sendAccountReadyEmail({ actor, params, config, integration, contract });
    },
  }),
  sendWelcomeEmail: Object.freeze({
    // The same, and the one whose body carries a temporary password.
    needsIntegration: true,
    // Reaches an outbound channel, so `publicReadiness` refuses to report a
    // released deployment ready while `PENNSYNC_API_DELIVERY` is unset. Without
    // it a rollout probe passes while every send answers 503 — the same shape
    // `needsIntegration` exists to prevent one layer down.
    needsDelivery: true,
    handle({ actor, params, config, integration, contract }) {
      return sendWelcomeEmail({ actor, params, config, integration, contract });
    },
  }),
  generateUserGuidePDF: Object.freeze({
    binary: true,
    needsIntegration: true,
    // The only port that both asks a model and renders. The guide type is
    // resolved before anything else because it reaches the download filename:
    // an unresolved one could mislabel the file or carry into the header, which
    // is what the original's own comment guards against.
    async handle({ params, integration }) {
      exactObject(params, ['guide_type'], 'INVALID_PARAMS');
      const guideType = resolveGuideType(params.guide_type);
      const guideContent = await integration('InvokeLLM', {
        prompt: USER_GUIDE_PROMPTS[guideType],
        response_json_schema: structuredClone(USER_GUIDE_SCHEMA),
      });
      const { jsPDF } = await import('jspdf');
      // One clock read for both stamps, so a render that straddles midnight
      // cannot date its footer and its copyright to different years.
      const now = new Date();
      // Letter, as the original constructs it — not the A4 default.
      const body = buildUserGuide(new jsPDF(GUIDE_FORMAT), guideContent, {
        generatedOn: documentDate(now), year: now.getFullYear(),
      }).output('arraybuffer');
      return { binary: true, body, contentType: 'application/pdf', filename: `${guideType}_guide.pdf` };
    },
  }),
  submitStateReportableIncident: Object.freeze({
    // The fifth PARTIAL port. The incident and its notification fan-out ship;
    // the PDF retention (the file layer) and the email (D56's open decision)
    // are refused by name, and both are REPORTED as paused rather than
    // silently skipped.
    handle({ params, contract }) {
      exactObject(params, STATE_INCIDENT_FIELDS, 'INVALID_PARAMS');
      return submitStateIncident({ params, contract });
    },
  }),
  extractReferralDataForSmartNote: Object.freeze({
    // D76. The one capability the queue held as `ported_function`, and the
    // whole port is a wiring: the transform was written and parity-pinned long
    // ago, and `api.test.mjs` recorded in its own words why the handler was
    // withheld — "it needs an authorized referral read that this service does
    // not yet have; exposing it would let a caller supply its own referral
    // payload". D68 built that read, so the reason expired and nothing but
    // this registry entry was missing.
    //
    // Everything the original does between the two is the wire check it needed
    // for a cross-function HTTP hop and this does not have: `exactKeys` over
    // the broker's envelope, `referral.agency_id !== agencyId`, the
    // safe-integer version, the two `Date.parse` calls. A contract taking
    // `p_agency` and `p_referral_id` and selecting on exactly those cannot
    // answer about a different referral, so validating that it did not is
    // D68's compensation-for-having-no-transaction in its cross-call form.
    //
    // Its `INTAKE_ROLES` gate goes the same way and for D69's reason rather
    // than this one: `referral_authority` admits `agency_admin`, `manager` and
    // `office_staff` and nothing else, so the refusal is INHERITED from the
    // contract this delegates to. A clinician who may be assigned a referral
    // still cannot seed a note from one.
    //
    // What is NOT machinery is the `extracted_data` check. That is a business
    // rule — a referral nobody has run the extractor over has nothing to seed
    // a note with — and `referral_row` drops null-valued keys, so an
    // unprocessed referral arrives with no such key at all.
    async handle({ params, contract }) {
      exactObject(params, ['referral_id'], 'INVALID_PARAMS');
      const answer = await contract('getAuthorizedReferral', params);
      const referral = isObject(answer?.referral) ? answer.referral : null;
      if (!referral || !isObject(referral.extracted_data)) {
        fail(404, 'REFERRAL_NOT_PROCESSED');
      }
      return {
        smartNoteData: buildSmartNoteData(referral),
        // The original's own key casing. `getDashboardData` matches the
        // widget that destructures it; nothing in `src/` calls this one, so
        // the only shape that could have a consumer is the deployed
        // endpoint's — and `contract_referral_get`'s scope is snake_case
        // beside it. What does NOT carry over is the `success: true` envelope,
        // which no ported handler returns.
        scope: {
          agency_id: answer?.scope?.agency_id,
          referral_id: referral.id,
          referral_version: referral.version,
        },
      };
    },
  }),
  getDashboardData: Object.freeze({
    // Five collections, one round trip, and a response shaped as the published
    // client reads it — `recentCompletedVisits` and `carePlans` are the names
    // `Dashboard.jsx` destructures, so they are the names that come back.
    //
    // The authorization is the contract's. The original's scope is
    // `patient.created_by` plus `patient.assigned_nurses`, with a
    // `SUPER_ADMIN_EMAIL` branch for the cross-tenant view; D24 answers the
    // first two and gives the third to an `agency_admin` or `manager` within
    // their own agency.
    async handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      const answer = await contract('readDashboard', {});
      return {
        patients: answer.patients ?? [],
        visits: answer.visits ?? [],
        incidents: answer.incidents ?? [],
        recentCompletedVisits: answer.recent_completed_visits ?? [],
        carePlans: answer.care_plans ?? [],
      };
    },
  }),
  searchPDFs: Object.freeze({
    // The indexed-PDF search. The corpus is the contract's and the scoring is
    // the service's, which is D67's split; nothing here reads a file, because
    // `PDFIndex` holds the extracted text rather than the document.
    handle({ params, contract, audit }) {
      exactObject(params, ['query', 'document_type', 'patient_id', 'fuzzy',
        'count_only', 'limit'], 'INVALID_PARAMS');
      return searchIndexedPdfs({ params, contract, audit });
    },
  }),
  generatePatientChartPDF: Object.freeze({
    needsIntegration: true,
    // D53's sequence with no write behind it, because the answer is a document
    // rather than a record — and, despite the name, not a PDF: the original
    // asks a model for formatted text and returns the text.
    //
    // The authorization is the contract's. The original's own gate was
    // `patient.created_by`, `patient.assigned_nurses` and the `SUPER_ADMIN_EMAIL`
    // platform owner, all three of which D21, D22 and D24 removed, so what
    // decides now is whether the caller opens the chart.
    handle({ params, contract, integration, audit }) {
      exactObject(params, ['patient_id', 'include_visits', 'include_incidents'],
        'INVALID_PARAMS');
      return exportPatientChart({ params, contract, integration, audit });
    },
  }),
  generateAIReport: Object.freeze({
    binary: true,
    needsIntegration: true,
    // The NINTH partial port. The document is served; `recipients` gets the
    // original's own 503, on the branch the original already refuses itself.
    //
    // The gate is the contract's, and it is D40's sixth widening. Worth reading
    // what the original's scope filter really was before assuming this one
    // loosened anything: its own comment promises that "an agency_admin cannot
    // pull every tenant's PHI into a PDF/email", and no `agency_admin` can
    // reach the code — `isAdminLike` is `role === 'admin'`, and
    // `withTrustedClaims` hands a built-in admin's profile back untouched. So
    // the scope was selected by the caller it was meant to constrain, out of
    // their own self-editable `account_type` and `agency_name`. It is a real
    // boundary here for the first time.
    handle({ params, contract, integration }) {
      exactObject(params, AI_REPORT_PARAMS, 'INVALID_PARAMS');
      return generateAiReport({ params, contract, integration });
    },
  }),
  generateUserRosterPDF: Object.freeze({
    binary: true,
    // The roster report. Everything interesting about the port is a deletion:
    // the original lists 5,000 `User` rows across every tenant and keeps the
    // ones whose `agency_name` STRING matches the caller's — plus every row
    // whose `account_type` is `super_admin`, which put a platform tier into
    // every agency's report. `contract_roster_report` answers from the
    // authority store's own membership, and the gate is the contract's.
    //
    // The whole roster is paged here rather than in the document, because the
    // report's summary is counted over the agency and its table is not: the
    // contract supplies the first and this loop supplies the second.
    async handle({ params, contract, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      const entries = [];
      let summary = null;
      let after;
      // Bounded, so a contract that answered a cursor equal to its own input
      // could not spin here. Five hundred a page is the roster's own ceiling.
      for (let page = 0; page < 200; page += 1) {
        const answer = await contract('readRosterReport',
          after === undefined ? {} : { after });
        entries.push(...(Array.isArray(answer.entries) ? answer.entries : []));
        summary ??= answer.summary;
        if (!answer.next || answer.next === after) break;
        after = answer.next;
      }
      const { jsPDF } = await import('jspdf');
      const now = new Date();
      const body = buildUserRoster(new jsPDF(ROSTER_FORMAT), { entries, summary },
        { logoDataUrl: config?.documentLogoDataUrl || null, generatedOn: documentDate(now) })
        .output('arraybuffer');
      return { binary: true, body, contentType: 'application/pdf',
        filename: rosterFilename(now.toISOString().split('T')[0]) };
    },
  }),
  generateUserManual: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildUserManual, USER_MANUAL_FILENAME, config);
    },
  }),
  analyzeReferral: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    // A dispatcher: the action decides which params are required, so the shape
    // is checked inside rather than by one `exactObject` here.
    handle({ params, integration }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      return runReferralAnalysis({ params, integration });
    },
  }),
  analyzeReferralIntake: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'analysisResults'], 'INVALID_PARAMS');
      return runReferralIntake({ params, integration });
    },
  }),
  analyzeReferralPriority: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    // The first port that reaches outside the service. `integration` is bound
    // to this caller by `app.mjs`; the handler never sees the credential that
    // authorizes the brokered call.
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'analysisResults'], 'INVALID_PARAMS');
      return runReferralPriority({ params, integration });
    },
  }),
  generateReferralTasks: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['referralData', 'priorityAnalysis'], 'INVALID_PARAMS');
      return runReferralTasks({ params, integration });
    },
  }),
  syncCMSRegulations: Object.freeze({
    // Model, then record contract, then trail (D53). The prompt asks the model
    // to search the internet, so `add_context_from_internet` and the response
    // schema are the original's and pass through the broker unchanged.
    needsIntegration: true,
    handle({ params, integration, contract, audit }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return syncCmsRegulations({ integration, contract, audit });
    },
  }),
  triageReferralWithAI: Object.freeze({
    // The first port to sequence a brokered model call and a write. The trail
    // entry carries the urgency category and nothing else, which is the
    // original's own containment rule: "The analysis contains patient identity
    // and clinical detail; UserActivity is a broad operational audit surface,
    // not a second copy of the referral record."
    needsIntegration: true,
    handle({ params, integration, audit }) {
      exactObject(params, ['referralData'], 'INVALID_PARAMS');
      return triageReferral({ params, integration, audit });
    },
  }),
  matchPatientWithAI: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'existingPatients'], 'INVALID_PARAMS');
      return runPatientMatch({ params, integration });
    },
  }),
  validatePatientData: Object.freeze({
    // Reproduces the original's authenticated-caller requirement, tightened to
    // a current agency membership because this service has no global scope.
    handle({ params }) {
      exactObject(params, ['patient'], 'INVALID_PARAMS');
      if (!isObject(params.patient)) fail(400, 'PATIENT_REQUIRED');
      const errors = validatePatientData(params.patient);
      return errors.length
        ? { valid: false, errors }
        : { valid: true, message: 'Patient data is valid' };
    },
  }),
});

export const HANDLER_NAMES = Object.freeze(Object.keys(HANDLERS).sort());
