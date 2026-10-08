import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>
// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Does an MRN-matched chart carry a different person's name?
//
// Stricter than the import-side helper this was ported from, deliberately.
// That one returns "no conflict" as soon as the surnames match, without ever
// comparing first names — but discharging is destructive, and spouses and
// siblings on service together share a surname, so one misread MRN digit could
// close the wrong family member's chart. Whenever BOTH first names are known,
// they must agree. Surnames may still legitimately differ (marriage), which is
// why a first-name match alone clears the check.
// A row with no name at all never conflicts, so MRN-only discharge rows keep
// matching exactly as before.
const foldNamePart = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
function mrnNameConflict(row, rec) {
  const rowLast = foldNamePart(row.last_name);
  const recLast = foldNamePart(rec?.last_name);
  const rowFirst = foldNamePart(row.first_name);
  const recFirst = foldNamePart(rec?.first_name);
  if (!rowLast && !rowFirst) return false;
  if (rowFirst && recFirst) return rowFirst !== recFirst;
  if (!rowLast || !recLast) return false;
  return !(rowLast === recLast || rowLast.includes(recLast) || recLast.includes(rowLast));
}

// Operational debug logs are compiled out in production (the FUNCTIONS_DEBUG
// secret was retired). console.error/warn remain ungated for visibility.
const debugLog = (..._args) => {};

const PATIENT_SCAN_LIMIT = 5000;
const DISCHARGE_ROW_LIMIT = 500;
const SIGNED_URL_TTL_SECONDS = 10 * 60;

// The uploader stores the report with UploadPrivateFile, so the only accepted
// input is a private file URI. A public or caller-chosen URL is refused: a
// discharge report is PHI and must never be read from an arbitrary location.
function isPrivateDischargeFileUri(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/\s/.test(value) && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    && (value.startsWith('private/') || value.startsWith('private://')
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}

const boundedId = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');

// Owner decision (2026-10-08): bulk discharge is released for the protected
// platform owner and for an agency administrator, and only ever against the
// patients of ONE agency. An agency administrator's agency comes from their
// single active, service-owned AgencyMembership (withTrustedClaims), never
// from the request. The platform owner names the agency, which must be an
// existing active Agency; with no membership of their own there is nothing
// else to derive it from.
async function resolveDischargeAgency(base44, user, requestedAgencyId) {
  if (isProtectedSuperAdmin(user)) {
    if (!boundedId(requestedAgencyId)) {
      return { error: Response.json({ error: 'agency_id is required' }, { status: 400 }) };
    }
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: requestedAgencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!agency || agency.id !== requestedAgencyId || !['active', 'trial'].includes(agency.status)) {
      return { error: Response.json({ error: 'Agency not found' }, { status: 404 }) };
    }
    return { agencyId: requestedAgencyId };
  }
  // withTrustedClaims leaves a built-in admin's profile untouched, so its
  // account_type and agency_id are self-editable; only a role 'user' profile
  // has them rebuilt from the membership.
  const agencyId = String(user.agency_id || '');
  if (user.role !== 'user' || user.account_type !== 'agency_admin' || !boundedId(agencyId)) {
    return { error: Response.json({ error: 'Forbidden: agency administrator required' }, { status: 403 }) };
  }
  if (requestedAgencyId != null && requestedAgencyId !== agencyId) {
    return { error: Response.json({ error: 'Forbidden: agency mismatch' }, { status: 403 }) };
  }
  return { agencyId };
}

Deno.serve(async (req) => {
  try {
    debugLog('Starting discharge report processing...');
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    const user = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Admin-only, before the caller-controlled body is parsed: the protected
    // platform owner, or a service-owned agency administrator. A built-in
    // admin who is not the configured owner, and a profile that merely CLAIMS
    // agency_admin, are refused (withTrustedClaims rebuilds account_type from
    // the membership).
    const isServiceOwnedAgencyAdmin = user.role === 'user' && user.account_type === 'agency_admin';
    if (!isProtectedSuperAdmin(user) && !isServiceOwnedAgencyAdmin) {
      return Response.json({ error: 'Forbidden: agency administrator required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'file_uri is required' }, { status: 400 });
    }
    const { file_uri, agency_id } = body;
    if (!file_uri) {
      return Response.json({ error: 'file_uri is required' }, { status: 400 });
    }
    if (!isPrivateDischargeFileUri(file_uri)) {
      return Response.json({ error: 'file_uri must be a private uploaded file' }, { status: 400 });
    }

    const scope = await resolveDischargeAgency(base44, user, agency_id ?? null);
    if (scope.error) return scope.error;
    const agencyId = scope.agencyId;

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });
    const signedUrl = typeof signed?.signed_url === 'string' && /^https:\/\//i.test(signed.signed_url)
      ? signed.signed_url
      : null;
    if (!signedUrl) {
      return Response.json({ success: false, error: 'The uploaded report could not be opened' }, { status: 400 });
    }

    debugLog('Extracting discharge data from file...');

    // Extract patient discharge data using AI
    const extractResponse = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
      file_url: signedUrl,
      json_schema: {
        type: 'object',
        properties: {
          discharged_patients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                medical_record_number: { type: 'string' },
                discharge_date: { type: 'string' },
                discharge_reason: { type: 'string' },
                discharge_disposition: { type: 'string' }
              }
            }
          }
        }
      }
    });

    if (extractResponse?.status !== 'success' || !Array.isArray(extractResponse.output?.discharged_patients)) {
      // The extraction details can echo document content; do not log or return them.
      console.error('processDischargeReport: extraction failed');
      return Response.json({
        success: false,
        error: 'Failed to extract discharge data from file',
      }, { status: 400 });
    }

    const dischargedPatientsData = extractResponse.output.discharged_patients
      .filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    if (dischargedPatientsData.length > DISCHARGE_ROW_LIMIT) {
      return Response.json({
        success: false,
        error: `The report lists more than ${DISCHARGE_ROW_LIMIT} discharges; split it and upload each part.`,
      }, { status: 400 });
    }
    debugLog(`Extracted ${dischargedPatientsData.length} discharged patients`);

    // Match only against the ONE agency resolved above. Reading one row more
    // than the cap tells a full agency from a truncated read, and a truncated
    // candidate set could make an ambiguous name look unique — so it refuses.
    const agencyPatients = await base44.asServiceRole.entities.Patient.filter(
      { agency_id: agencyId }, '-created_date', PATIENT_SCAN_LIMIT + 1,
    );
    if (!Array.isArray(agencyPatients) || agencyPatients.length > PATIENT_SCAN_LIMIT) {
      return Response.json({
        success: false,
        error: 'This agency has too many patient charts to match safely in one report.',
      }, { status: 409 });
    }
    // Defence in depth: the store answered a filter, so re-check every row.
    const candidatePatients = agencyPatients.filter((patient) => patient?.agency_id === agencyId);

    const results = {
      total_processed: dischargedPatientsData.length,
      discharged_count: 0,
      files_closed: 0,
      not_found: 0,
      ambiguous: 0,
      discharged_patients: [],
      not_found_patients: [],
      ambiguous_patients: [],
      errors: []
    };

    // Create lookup maps. The name map BUCKETS patients per name key: with
    // last-write-wins a second "John Smith" would shadow the first, and a
    // name-only discharge match would then silently discharge whichever patient
    // happened to be iterated last — possibly the wrong John Smith. Bucketing lets
    // us detect the ambiguity and refuse to guess (mirrors processPatientFileUpdate,
    // which errors on >1 match). The discharge extraction schema carries no DOB, so
    // MRN is the only available disambiguator.
    const mrnMap = new Map();
    const nameMap = new Map();

    for (const patient of candidatePatients) {
      // Only consider charts that can actually be discharged as match candidates.
      // An already-discharged / merged / archived duplicate sharing a name (or MRN)
      // must not shadow the active chart or create a false "ambiguous" match that
      // blocks discharging the real patient.
      if (patient.is_archived || patient.status === 'merged' || patient.status === 'discharged') continue;
      if (patient.medical_record_number) {
        // Bucket per MRN for the same reason the name map does. Last-write-wins
        // meant two charts sharing an MRN silently resolved to whichever was
        // iterated last.
        const mrnKey = String(patient.medical_record_number).trim().toLowerCase();
        if (!mrnMap.has(mrnKey)) mrnMap.set(mrnKey, []);
        mrnMap.get(mrnKey).push(patient);
      }
      const nameKey = `${patient.first_name?.toLowerCase()}_${patient.last_name?.toLowerCase()}`;
      if (!nameMap.has(nameKey)) nameMap.set(nameKey, []);
      nameMap.get(nameKey).push(patient);
    }

    // Process each discharged patient with batching
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 1000;
    const updateBatch = [];
    const queuedPatientIds = new Set();

    for (const dischargeData of dischargedPatientsData) {
      try {
        // Find matching patient
        let matchingPatient = null;

        if (dischargeData.medical_record_number) {
          // An MRN hit used to be trusted outright, with no name cross-check —
          // but this MRN is AI-extracted from an uploaded document, exactly the
          // source that produces digit errors, and the name branch below is
          // skipped once matchingPatient is set. One mangled digit therefore
          // discharged whichever active chart owned that MRN, dropping a patient
          // off the census and cancelling their scheduled care. Same guard
          // processPatientFileUpdate already applies to its MRN matches.
          const mrn = String(dischargeData.medical_record_number).trim().toLowerCase();
          const mrnCandidates = mrnMap.get(mrn) || [];
          const displayName = `${dischargeData.first_name || ''} ${dischargeData.last_name || ''}`.trim();

          if (mrnCandidates.length > 1) {
            results.ambiguous++;
            results.ambiguous_patients.push({
              name: displayName,
              mrn: dischargeData.medical_record_number,
              candidate_count: mrnCandidates.length,
              reason: 'Multiple active charts share this MRN',
            });
            continue;
          }

          const mrnMatch = mrnCandidates[0] || null;
          if (mrnMatch && mrnNameConflict(dischargeData, mrnMatch)) {
            results.ambiguous++;
            results.ambiguous_patients.push({
              name: displayName,
              mrn: dischargeData.medical_record_number,
              candidate_count: 1,
              reason: 'MRN belongs to a chart with a different name',
            });
            continue;
          }
          matchingPatient = mrnMatch;
        }

        if (!matchingPatient && dischargeData.first_name && dischargeData.last_name) {
          const nameKey = `${String(dischargeData.first_name).toLowerCase()}_${String(dischargeData.last_name).toLowerCase()}`;
          const candidates = nameMap.get(nameKey) || [];
          if (candidates.length > 1) {
            // Ambiguous name with no MRN to disambiguate — refuse to discharge a
            // guess. Surface for manual review instead of mutating a chart.
            results.ambiguous++;
            results.ambiguous_patients.push({
              name: `${dischargeData.first_name} ${dischargeData.last_name}`,
              mrn: dischargeData.medical_record_number,
              candidate_count: candidates.length,
            });
            continue;
          }
          matchingPatient = candidates[0] || null;
        }

        if (!matchingPatient) {
          results.not_found++;
          results.not_found_patients.push({
            name: `${dischargeData.first_name || ''} ${dischargeData.last_name || ''}`,
            mrn: dischargeData.medical_record_number
          });
          continue;
        }

        // The same chart listed twice in one report is discharged once.
        if (queuedPatientIds.has(matchingPatient.id)) continue;
        queuedPatientIds.add(matchingPatient.id);

        // Prepare discharge update
        const dischargeUpdate = {
          status: 'discharged',
          discharge_date: dischargeData.discharge_date || new Date().toISOString().split('T')[0],
          discharge_disposition: dischargeData.discharge_disposition || 'home'
        };

        // Add discharge reason if provided
        if (dischargeData.discharge_reason) {
          dischargeUpdate.clinical_notes = (matchingPatient.clinical_notes || '') +
            `\n\nDischarged: ${dischargeData.discharge_date || 'today'} - ${dischargeData.discharge_reason}`;
        }

        updateBatch.push({
          id: matchingPatient.id,
          data: dischargeUpdate,
          patientInfo: {
            name: `${matchingPatient.first_name} ${matchingPatient.last_name}`,
            mrn: matchingPatient.medical_record_number,
            discharge_date: dischargeData.discharge_date,
            discharge_reason: dischargeData.discharge_reason
          }
        });

        results.discharged_count++;

      } catch {
        results.errors.push('A discharge row could not be processed');
      }
    }

    // Process updates in batches to avoid rate limiting
    debugLog(`Processing ${updateBatch.length} discharges in batches...`);
    for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
      const batch = updateBatch.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(update =>
          base44.asServiceRole.entities.Patient.update(update.id, update.data)
            .then(() => {
              results.files_closed++;
              results.discharged_patients.push(update.patientInfo);
            })
            .catch(() => {
              results.errors.push(`Failed to discharge ${update.patientInfo.name}`);
            })
        )
      );

      // Delay between batches
      if (i + BATCH_SIZE < updateBatch.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    // Log the discharge processing activity. Counts and the actor only: the
    // patient names, MRNs and the file reference stay in the caller's answer
    // and never reach the operational log.
    await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'Discharge Report Processing',
      job_type: 'other',
      status: 'success',
      message: `Processed ${results.files_closed} patient discharges`,
      details: {
        processed_by: user.email,
        agency_id: agencyId,
        total_processed: results.total_processed,
        discharged_count: results.discharged_count,
        files_closed: results.files_closed,
        not_found: results.not_found,
        ambiguous: results.ambiguous,
        error_count: results.errors.length,
      }
    }).catch(() => {});

    debugLog('Discharge processing complete');
    return Response.json({
      success: true,
      ...results
    });

  } catch {
    console.error('Error processing discharge report');

    return Response.json({
      success: false,
      error: 'Failed to process discharge report',
      details: 'Internal server error'
    }, { status: 500 });
  }
});
