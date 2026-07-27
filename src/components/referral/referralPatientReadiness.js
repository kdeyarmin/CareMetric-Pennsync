// Shared admission-readiness helpers for referral -> patient creation.
// Conservative rule for Phase 1: create a Patient only when the referral has a
// usable full name plus at least one verifiable identifier/contact. Otherwise,
// keep the item in the referral queue so staff can complete missing data without
// polluting the active census with placeholders.

const PLACEHOLDER_VALUES = new Set([
  'not provided', 'not provided on referral', 'unknown', 'n/a', 'na', 'none',
  // The exact filler referralExtraction.js instructs the extractor to emit —
  // without it a "Not documented in referral" string counted as a real value.
  'not documented', 'not documented in referral', 'not documented on referral',
]);

export function cleanReferralValue(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text) return '';
  return PLACEHOLDER_VALUES.has(text.toLowerCase()) ? '' : text;
}

export function splitPatientName(fullName) {
  const cleaned = cleanReferralValue(fullName).replace(/\s+/g, ' ');
  if (!cleaned) return { first_name: '', last_name: '', full_name: '' };
  // Faxed referrals commonly write "Last, First [Middle]" — splitting that
  // positionally created patients named first_name "Doe," last_name "Jane".
  const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
  if (comma) {
    const last = comma[1].trim();
    const given = comma[2].trim();
    return {
      first_name: given.split(' ')[0] || '',
      last_name: last,
      full_name: `${given} ${last}`.trim(),
    };
  }
  const parts = cleaned.split(' ');
  return {
    first_name: parts[0] || '',
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
    full_name: cleaned,
  };
}

export function referralPatientReadiness(analysis = {}) {
  const { first_name, last_name, full_name } = splitPatientName(analysis.patient_name || analysis.full_name);
  const identifiers = {
    date_of_birth: cleanReferralValue(analysis.date_of_birth),
    medical_record_number: cleanReferralValue(analysis.medical_record_number || analysis.mrn),
    phone: cleanReferralValue(analysis.phone),
    address: cleanReferralValue(analysis.address),
  };
  const missing = [];
  if (!first_name || !last_name) missing.push('patient full name');
  if (!Object.values(identifiers).some(Boolean)) missing.push('DOB, MRN, phone, or address');
  return {
    ready: missing.length === 0,
    missing,
    first_name,
    last_name,
    full_name,
    identifiers,
  };
}

export function buildIncompleteReferralFromTriage(analysis = {}, { assignedTo, referralDate } = {}) {
  const readiness = referralPatientReadiness(analysis);
  return {
    patient_name: readiness.full_name || cleanReferralValue(analysis.patient_name) || 'Incomplete referral',
    patient_dob: readiness.identifiers.date_of_birth || null,
    diagnosis: cleanReferralValue(analysis.primary_diagnosis),
    referral_source: cleanReferralValue(analysis.referral_source) || 'Manual triage',
    referral_date: referralDate || null,
    document_type: 'manual',
    priority: analysis.priority || 'normal',
    status: 'awaiting_info',
    assigned_to: assignedTo || null,
    requires_manual_review: true,
    extracted_data: {
      triage_analysis: analysis,
      missing_patient_identity: readiness.missing,
    },
    follow_up_notes: [
      {
        type: 'missing_patient_identity',
        note: `Patient chart not created. Missing: ${readiness.missing.join(', ')}.`,
        created_at: new Date().toISOString(),
        created_by: assignedTo || null,
      },
    ],
  };
}
