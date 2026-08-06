import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Platform-wide: role:admin without agency, or super_admin. Facility admins
// with an agency_name may run the import but only against their agency's charts.
const canRunDischargeImport = (u) => !!u && (
  u.account_type === 'super_admin'
  || u.role === 'admin'
  || u.account_type === 'agency_admin'
);

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

Deno.serve(async (req) => {
  try {
    debugLog('Starting discharge report processing...');
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!canRunDischargeImport(user)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { file_url } = await req.json();
    if (!file_url) {
      return Response.json({ error: 'file_url is required' }, { status: 400 });
    }

    debugLog('Extracting discharge data from file...');
    
    // Extract patient discharge data using AI
    const extractResponse = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
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

    if (extractResponse.status !== 'success' || !extractResponse.output?.discharged_patients) {
      console.error('Extraction failed:', extractResponse);
      return Response.json({ 
        success: false,
        error: 'Failed to extract discharge data from file',
        details: extractResponse.details 
      }, { status: 400 });
    }

    const dischargedPatientsData = extractResponse.output.discharged_patients;
    debugLog(`Extracted ${dischargedPatientsData.length} discharged patients`);

    // Fetch patients to match the discharge records against (bounded to the
    // SDK's 5000/request max; omitting a limit silently caps at the SDK default
    // of 50).
    let allPatients = await base44.asServiceRole.entities.Patient.list('-created_date', 5000);
    const isAgencyScoped = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScoped) {
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      allPatients = (allPatients || []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e))),
      );
    } else if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }
    
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

    for (const patient of allPatients) {
      // Only consider charts that can actually be discharged as match candidates.
      // An already-discharged / merged / archived duplicate sharing a name (or MRN)
      // must not shadow the active chart or create a false "ambiguous" match that
      // blocks discharging the real patient.
      if (patient.is_archived || patient.status === 'merged' || patient.status === 'discharged') continue;
      if (patient.medical_record_number) {
        // Bucket per MRN for the same reason the name map does. Last-write-wins
        // meant two charts sharing an MRN silently resolved to whichever was
        // iterated last.
        const mrnKey = patient.medical_record_number.trim().toLowerCase();
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
          const mrn = dischargeData.medical_record_number.trim().toLowerCase();
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
          const nameKey = `${dischargeData.first_name.toLowerCase()}_${dischargeData.last_name.toLowerCase()}`;
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

      } catch (error) {
        results.errors.push(`${dischargeData.first_name} ${dischargeData.last_name}: ${error.message}`);
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
            .catch(err => {
              results.errors.push(`Failed to discharge ${update.patientInfo.name}: ${err.message}`);
            })
        )
      );
      
      // Delay between batches
      if (i + BATCH_SIZE < updateBatch.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    // Log the discharge processing activity
    await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'Discharge Report Processing',
      job_type: 'other',
      status: 'success',
      message: `Processed ${results.discharged_count} patient discharges`,
      details: {
        file_url,
        processed_by: user.email,
        results
      }
    });

    debugLog('Discharge processing complete:', results);
    return Response.json({
      success: true,
      ...results
    });

  } catch (error) {
    console.error('Error processing discharge report:', error);
    
    return Response.json({ 
      success: false,
      error: 'Failed to process discharge report',
      details: 'Internal server error'
    }, { status: 500 });
  }
});