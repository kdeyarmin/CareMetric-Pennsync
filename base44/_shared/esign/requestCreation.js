// Secure creation of one signature request: one DocumentSignature per chart
// document (each bound to its private version-2 DocumentTenantBinding and the
// exact SHA-256 of its bytes) and one DocumentPackage per signer. Every row
// carries the creator's User id, normalized email and exact AgencyMembership
// id/version, so revoking the creator's membership invalidates every link the
// request ever issued. Identity is deterministic from (agency, creator,
// client_request_id): a retry returns the same request, and the agency-level
// creation reservation serializes concurrent duplicates.
const ESIGN_SIGNER_ROLES = new Set(['patient', 'caregiver', 'legal_representative', 'witness', 'provider']);
const ESIGN_DOCUMENT_TYPES = new Set([
  'consent', 'hipaa', 'treatment_agreement', 'financial_agreement', 'advance_directive', 'release', 'custom_request', 'other',
]);
const ESIGN_FIELD_TYPES = new Set(['signature', 'initials', 'date', 'text']);
const ESIGN_MAX_DOCUMENTS = 25;
const ESIGN_MAX_SIGNERS = 10;
const ESIGN_MAX_FIELDS = 100;
const ESIGN_MAX_DUE_DAYS = 90;

function esignBoundedText(value, min, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max
    || [...text].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return text;
}

function esignCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? value : null;
}

function esignPercent(value, allowZero) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > 100 || (allowZero ? number < 0 : number <= 0)) return null;
  return Math.round(number * 100) / 100;
}

/** Parse and bound a request spec. Unknown keys are refused, never ignored. */
function esignParseRequestSpec(raw, allowedExtraKeys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EsignError(400, 'Request body must be an object');
  const allowed = new Set(['agency_id', 'patient_id', 'document_ids', 'signers', 'package_name', 'document_type',
    'due_date', 'message', 'signature_fields', 'auto_reminders', 'reminder_days_before', 'client_request_id',
    ...(allowedExtraKeys || [])]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) throw new EsignError(400, 'Unsupported signature request field: ' + unknown[0]);
  const agencyId = esignId(raw.agency_id);
  const patientId = esignId(raw.patient_id);
  const clientRequestId = esignId(raw.client_request_id);
  if (!agencyId || !patientId || !clientRequestId) {
    throw new EsignError(400, 'agency_id, patient_id and client_request_id are required');
  }
  const documentIds = Array.isArray(raw.document_ids) ? raw.document_ids.map(esignId) : [];
  if (!allowedExtraKeys?.includes('template_id')) {
    if (documentIds.length < 1 || documentIds.length > ESIGN_MAX_DOCUMENTS || documentIds.includes(null)
      || new Set(documentIds).size !== documentIds.length) {
      throw new EsignError(400, 'Between 1 and ' + ESIGN_MAX_DOCUMENTS + ' distinct chart documents are required');
    }
  }
  const rawSigners = Array.isArray(raw.signers) ? raw.signers : [];
  if (rawSigners.length < 1 || rawSigners.length > ESIGN_MAX_SIGNERS) {
    throw new EsignError(400, 'Between 1 and ' + ESIGN_MAX_SIGNERS + ' signers are required');
  }
  const signers = rawSigners.map((signer) => {
    if (!signer || typeof signer !== 'object' || Array.isArray(signer)
      || Object.keys(signer).some((key) => !['name', 'email', 'role'].includes(key))) {
      throw new EsignError(400, 'Each signer needs exactly name, email and role');
    }
    const name = esignBoundedText(signer.name, 2, 200);
    const email = esignEmail(signer.email);
    const role = String(signer.role || '');
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ESIGN_SIGNER_ROLES.has(role)) {
      throw new EsignError(400, 'Each signer needs a name, a valid email and a signer role');
    }
    return { name, email, role };
  });
  if (new Set(signers.map((signer) => signer.email)).size !== signers.length) {
    throw new EsignError(400, 'Each signer must have a distinct email address');
  }
  const packageName = raw.package_name == null ? 'Signature request' : esignBoundedText(raw.package_name, 1, 200);
  if (!packageName) throw new EsignError(400, 'package_name is invalid');
  const documentType = raw.document_type == null ? 'consent' : String(raw.document_type);
  if (!ESIGN_DOCUMENT_TYPES.has(documentType)) throw new EsignError(400, 'document_type is invalid');
  const dueDate = esignCalendarDate(raw.due_date);
  const today = new Date().toISOString().slice(0, 10);
  const latest = new Date(Date.now() + ESIGN_MAX_DUE_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!dueDate || dueDate < today || dueDate > latest) {
    throw new EsignError(400, 'due_date must be a calendar date from today through ' + ESIGN_MAX_DUE_DAYS + ' days out');
  }
  let message = null;
  if (raw.message != null && raw.message !== '') {
    if (typeof raw.message !== 'string' || raw.message.length > 1000
      || [...raw.message].some((character) => {
        const code = character.charCodeAt(0);
        return (code <= 31 && code !== 10) || code === 127;
      })) throw new EsignError(400, 'message is invalid');
    message = raw.message.trim() || null;
  }
  const rawFields = raw.signature_fields == null ? [] : raw.signature_fields;
  if (!Array.isArray(rawFields) || rawFields.length > ESIGN_MAX_FIELDS) throw new EsignError(400, 'signature_fields is invalid');
  const fields = rawFields.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) throw new EsignError(400, 'signature field is invalid');
    const documentId = field.document_id == null ? null : esignId(field.document_id);
    const signerIndex = Number(field.signer_index);
    const page = Number(field.page);
    const x = esignPercent(field.x, true);
    const y = esignPercent(field.y, true);
    const width = esignPercent(field.width, false);
    const height = esignPercent(field.height, false);
    if ((field.document_id != null && !documentId) || !Number.isSafeInteger(signerIndex) || signerIndex < 0
      || signerIndex >= signers.length || !ESIGN_FIELD_TYPES.has(String(field.type || ''))
      || !Number.isSafeInteger(page) || page < 1 || page > 500
      || x === null || y === null || width === null || height === null
      || x + width > 100.001 || y + height > 100.001) {
      throw new EsignError(400, 'signature field geometry is invalid');
    }
    return { documentId, signerIndex, type: field.type, page, x, y, width, height };
  });
  const autoReminders = raw.auto_reminders == null ? true : raw.auto_reminders === true;
  const reminderDays = raw.reminder_days_before == null ? 2 : Number(raw.reminder_days_before);
  if (!Number.isSafeInteger(reminderDays) || reminderDays < 1 || reminderDays > 14) {
    throw new EsignError(400, 'reminder_days_before must be 1 through 14');
  }
  return {
    agencyId, patientId, clientRequestId, documentIds, signers, packageName, documentType,
    dueDate, message, fields, autoReminders, reminderDays,
  };
}

/** The chart document a request may bind: private, version 2, same chart. */
async function esignLoadChartSource(entities, agencyId, patientId, documentId) {
  const document = await esignExactOne(entities.Document, { id: documentId }, 'Document', 404);
  const bindings = esignRows(await entities.DocumentTenantBinding.filter(
    { document_id: documentId, agency_id: agencyId }, '-created_date', ESIGN_ROW_LIMIT,
  ), 'DocumentTenantBinding.filter');
  const exact = bindings.filter((row) => row?.document_id === documentId && row?.agency_id === agencyId);
  if (exact.length !== 1 || bindings.length >= ESIGN_ROW_LIMIT) throw new EsignError(404, 'Chart document unavailable');
  const binding = exact[0];
  if (document.patient_id !== patientId || binding.patient_id !== patientId || document.file_url != null
    || binding.storage_mode !== 'private' || binding.version !== 2 || !isPrivateFileUri(binding.file_uri)
    || !esignDigest(binding.content_sha256) || !ESIGN_SOURCE_TYPES.has(String(binding.file_type || ''))
    || !esignId(binding.id)) {
    throw new EsignError(409, 'Only private PDF or image documents in this patient chart can be sent for signature');
  }
  return { document, binding };
}

function esignSignerIdFor(requestKeyDigest, email) {
  return esignSha256(requestKeyDigest + '\u0000signer\u0000' + email).then((digest) => 'signer_' + digest.slice(0, 32));
}

async function esignBuildRequestPlan(authority, spec, sources) {
  const requestKey = await esignSha256(
    'esign-request\u0000' + spec.agencyId + '\u0000' + authority.caller.userId + '\u0000' + spec.clientRequestId,
  );
  const signers = [];
  for (const signer of spec.signers) {
    signers.push({ ...signer, signerId: await esignSignerIdFor(requestKey, signer.email) });
  }
  const creator = {
    created_by_user_id: authority.caller.userId,
    created_by_user_email_normalized: authority.caller.email,
    creator_membership_id: authority.membership.id,
    creator_membership_version: authority.membership.version,
  };
  const documents = [];
  for (const source of sources) {
    const documentId = source.document.id;
    const fields = spec.fields
      .filter((field) => field.documentId === null || field.documentId === documentId)
      .map((field, index) => ({
        id: 'field_' + (index + 1),
        signerId: signers[field.signerIndex].signerId,
        type: field.type,
        label: field.type === 'signature' ? 'Signature' : field.type === 'initials' ? 'Initials'
          : field.type === 'date' ? 'Date signed' : 'Printed name',
        required: true,
        page: field.page,
        position: { x: field.x, y: field.y },
        size: { width: field.width, height: field.height },
      }));
    documents.push({
      key: await esignSha256(requestKey + '\u0000document\u0000' + documentId),
      source,
      payload: {
        agency_id: spec.agencyId,
        request_key: requestKey,
        client_request_id: spec.clientRequestId,
        ...creator,
        created_by_email: authority.caller.email,
        document_id: documentId,
        document_binding_id: source.binding.id,
        document_binding_version: 2,
        document_content_sha256: source.binding.content_sha256,
        patient_id: spec.patientId,
        document_type: spec.documentType,
        document_title: String(source.document.title || source.binding.file_name || spec.packageName).slice(0, 200),
        document_name: String(source.binding.file_name || '').slice(0, 200),
        signature_fields: fields,
        signers: signers.map((signer) => ({
          signer_id: signer.signerId, signer_name: signer.name, signer_role: signer.role,
          email: signer.email, required: true, status: 'pending',
        })),
        status: 'pending',
        workflow_status: 'pending',
        authority_version: 1,
        due_date: spec.dueDate,
        ...(spec.message ? { message: spec.message } : {}),
        reminder_sent_count: 0,
      },
    });
  }
  const packages = [];
  for (const signer of signers) {
    packages.push({
      key: await esignSha256(requestKey + '\u0000package\u0000' + signer.signerId),
      signer,
      // A request's packages are the rows sharing (agency_id,
      // created_by_user_id, client_request_id); the package schema is carried
      // into the owned store, so it gains no request-level columns here.
      payload: {
        agency_id: spec.agencyId,
        client_request_id: spec.clientRequestId,
        ...creator,
        authority_version: 1,
        package_name: spec.packageName,
        patient_id: spec.patientId,
        status: 'pending',
        due_date: spec.dueDate,
        auto_reminder_enabled: spec.autoReminders,
        reminder_days_before: spec.reminderDays,
        signer_id: signer.signerId,
        signer_email: signer.email,
        signer_name: signer.name,
      },
    });
  }
  return { requestKey, signers, documents, packages };
}

function esignCanonical(value) {
  if (Array.isArray(value)) return value.map(esignCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, esignCanonical(value[key])]));
  }
  return value ?? null;
}

function esignSameValue(left, right) {
  return JSON.stringify(esignCanonical(left)) === JSON.stringify(esignCanonical(right));
}

function esignRowMatchesPlan(row, payload, ignored) {
  for (const [key, value] of Object.entries(payload)) {
    if (ignored && ignored.has(key)) continue;
    if (!esignSameValue(row?.[key], value)) return false;
  }
  return true;
}

async function esignLoadRequestRows(entities, agencyId, requestKey, creatorId, clientRequestId) {
  const signatures = esignRows(await entities.DocumentSignature.filter(
    { agency_id: agencyId, request_key: requestKey }, 'created_date', 50,
  ), 'DocumentSignature.filter').filter((row) => row?.agency_id === agencyId && row?.request_key === requestKey);
  const packages = await esignLoadRequestPackages(entities, agencyId, creatorId, clientRequestId);
  return { signatures, packages };
}

function esignRequestView(plan, rows) {
  const signatureByKey = new Map(rows.signatures.map((row) => [row.signature_request_key, row]));
  const packageByKey = new Map(rows.packages.map((row) => [row.package_key, row]));
  return {
    request_key: plan.requestKey,
    documents: plan.documents.map((entry) => {
      const row = signatureByKey.get(entry.key);
      return { id: row.id, document_id: row.document_id, title: row.document_title, status: row.status };
    }),
    packages: plan.packages.map((entry) => {
      const row = packageByKey.get(entry.key);
      return {
        id: row.id, signer_id: row.signer_id, signer_name: row.signer_name,
        signer_email: row.signer_email, signer_role: entry.signer.role, status: row.status,
      };
    }),
  };
}

function esignVerifyRequestRows(plan, rows) {
  const signatureByKey = new Map();
  for (const row of rows.signatures) {
    if (signatureByKey.has(row.signature_request_key)) throw new EsignError(409, 'Signature request rows are ambiguous');
    signatureByKey.set(row.signature_request_key, row);
  }
  const packageByKey = new Map();
  for (const row of rows.packages) {
    if (packageByKey.has(row.package_key)) throw new EsignError(409, 'Signature request rows are ambiguous');
    packageByKey.set(row.package_key, row);
  }
  for (const key of signatureByKey.keys()) {
    if (!plan.documents.some((entry) => entry.key === key)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  for (const key of packageByKey.keys()) {
    if (!plan.packages.some((entry) => entry.key === key)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  // A replayed request may legitimately have progressed (sent, signed); compare
  // only the immutable creation snapshot, never lifecycle fields.
  const lifecycle = new Set(['status', 'workflow_status', 'signers', 'authority_version', 'reminder_sent_count']);
  for (const entry of plan.documents) {
    const row = signatureByKey.get(entry.key);
    if (row && !esignRowMatchesPlan(row, entry.payload, lifecycle)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
    if (row) {
      const roster = (Array.isArray(row.signers) ? row.signers : []).map((signer) => [signer?.signer_id, signer?.email]);
      const planned = entry.payload.signers.map((signer) => [signer.signer_id, signer.email]);
      if (JSON.stringify(roster) !== JSON.stringify(planned)) {
        throw new EsignError(409, 'client_request_id conflicts with another signature request');
      }
    }
  }
  const packageLifecycle = new Set(['status', 'authority_version', 'document_signatures']);
  for (const entry of plan.packages) {
    const row = packageByKey.get(entry.key);
    if (row && !esignRowMatchesPlan(row, entry.payload, packageLifecycle)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  return {
    complete: plan.documents.every((entry) => signatureByKey.has(entry.key))
      && plan.packages.every((entry) => packageByKey.has(entry.key)),
    signatureByKey, packageByKey,
  };
}

/**
 * Create (or replay) one request. `sources` are esignLoadChartSource results in
 * document order. Returns { created, request }.
 */
async function esignCreateSignatureRequest(base44, authority, spec, sources) {
  const entities = authority.entities;
  const plan = await esignBuildRequestPlan(authority, spec, sources);
  const loadRows = () => esignLoadRequestRows(entities, spec.agencyId, plan.requestKey,
    authority.caller.userId, spec.clientRequestId);
  let rows = await loadRows();
  let state = esignVerifyRequestRows(plan, rows);
  if (state.complete) {
    const anyRow = rows.signatures[0];
    await releaseRecoveredFaxQueueCreation(entities, spec.agencyId, 'esign_request', plan.requestKey,
      { queue_creation_reservation_token: anyRow?.creation_reservation_token ?? null }).catch(() => false);
    return { created: false, request: esignRequestView(plan, rows), plan };
  }
  let reservation = await reserveFaxQueueCreation(entities, spec.agencyId, 'esign_request', plan.requestKey);
  if (!reservation) {
    // Resume only this request's own partial write: the document rows (always
    // written first) must all carry the reservation token still held for this
    // exact request key.
    const key = await faxQueueCreationKey('esign_request', plan.requestKey);
    const agency = await esignExactOne(entities.Agency, { id: spec.agencyId }, 'Agency', 409);
    const token = agency.fax_workflow_reservations?.[key];
    const written = rows.signatures;
    if (typeof token !== 'string' || !written.length
      || written.some((row) => row.creation_reservation_token !== token)) {
      throw new EsignError(409, 'This signature request is already being created; retry shortly', 'request_in_progress');
    }
    reservation = { agencyId: spec.agencyId, key, token };
  }
  let createStarted = false;
  try {
    rows = await loadRows();
    state = esignVerifyRequestRows(plan, rows);
    const signatureIds = [];
    for (const entry of plan.documents) {
      let row = state.signatureByKey.get(entry.key);
      if (!row) {
        createStarted = true;
        row = await entities.DocumentSignature.create({
          ...entry.payload, signature_request_key: entry.key, creation_reservation_token: reservation.token,
          sent_date: new Date().toISOString(),
        });
        if (!esignId(row?.id)) throw new Error('DocumentSignature.create returned no exact id');
      }
      signatureIds.push(row.id);
    }
    for (const entry of plan.packages) {
      if (state.packageByKey.get(entry.key)) continue;
      createStarted = true;
      const row = await entities.DocumentPackage.create({
        ...entry.payload, package_key: entry.key, document_signatures: signatureIds,
      });
      if (!esignId(row?.id)) throw new Error('DocumentPackage.create returned no exact id');
    }
    rows = await loadRows();
    state = esignVerifyRequestRows(plan, rows);
    if (!state.complete) throw new EsignError(409, 'Signature request persistence could not be verified');
    for (const row of rows.packages) {
      if (JSON.stringify(row.document_signatures) !== JSON.stringify(signatureIds)) {
        throw new EsignError(409, 'Signature request persistence could not be verified');
      }
    }
    await esignAudit(entities, {
      event_key: await esignSha256('request_created\u0000' + plan.requestKey),
      agency_id: spec.agencyId,
      action: 'request_created', actor_type: 'authenticated_user',
      actor_user_id: authority.caller.userId,
      membership_id: authority.membership.id, membership_version: authority.membership.version,
      request_id: spec.clientRequestId, authority_version: 1,
      occurred_at: new Date().toISOString(),
    });
    await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    return { created: true, request: esignRequestView(plan, rows), plan };
  } catch (error) {
    if (!createStarted) await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    throw error;
  }
}
