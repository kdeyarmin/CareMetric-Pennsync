import { parseDob } from '@/components/patient/patientDuplicateUtils';
import { splitPatientName } from './referralPatientReadiness';

export const AI_MATCH_CANDIDATE_LIMIT = 100;

const normalize = (value) => (
  typeof value === 'string'
    ? value.toLowerCase().trim().replace(/[^a-z0-9]/g, '')
    : ''
);

const normalizePhone = (value) => (
  typeof value === 'string' ? value.replace(/\D/g, '') : ''
);

const levenshtein = (left, right) => {
  const leftLength = left.length;
  const rightLength = right.length;
  if (!leftLength) return rightLength;
  if (!rightLength) return leftLength;

  let previous = Array.from({ length: rightLength + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]
        : 1 + Math.min(
          previous[rightIndex - 1],
          previous[rightIndex],
          current[rightIndex - 1],
        );
    }
    previous = current;
  }
  return previous[rightLength];
};

const similarity = (left, right) => {
  if (!left || !right) return 0;
  const longerLength = Math.max(left.length, right.length);
  if (longerLength === 0) return 1;
  return (longerLength - levenshtein(left, right)) / longerLength;
};

function scorePatient(patient, demographics) {
  const fullName = demographics?.full_name || '';
  const { first_name: firstName, last_name: lastName } = splitPatientName(fullName);
  const middleName = '';
  const dob = demographics?.date_of_birth;
  const phone = demographics?.phone;
  const address = demographics?.address;

  let score = 0;
  let nameMatched = false;
  const reasons = [];

  if (firstName && patient.first_name) {
    const firstNameSimilarity = similarity(normalize(firstName), normalize(patient.first_name));
    if (firstNameSimilarity >= 0.8) {
      score += firstNameSimilarity * 20;
      nameMatched = true;
      reasons.push(`First name: ${(firstNameSimilarity * 100).toFixed(0)}%`);
    }
  }

  if (lastName && patient.last_name) {
    const lastNameSimilarity = similarity(normalize(lastName), normalize(patient.last_name));
    if (lastNameSimilarity >= 0.8) {
      score += lastNameSimilarity * 20;
      nameMatched = true;
      reasons.push(`Last name: ${(lastNameSimilarity * 100).toFixed(0)}%`);
    }
  }

  if (middleName && patient.middle_name) {
    const referralMiddleName = normalize(middleName);
    const patientMiddleName = normalize(patient.middle_name);
    if (
      referralMiddleName === patientMiddleName
      || referralMiddleName[0] === patientMiddleName[0]
    ) {
      score += 5;
      reasons.push('Middle name match');
    }
  }

  if (dob && patient.date_of_birth) {
    const referralDob = parseDob(dob);
    const patientDob = parseDob(patient.date_of_birth);
    if (
      referralDob
      && patientDob
      && referralDob.year === patientDob.year
      && referralDob.month === patientDob.month
      && referralDob.day === patientDob.day
    ) {
      score += 30;
      reasons.push('Exact DOB match');
    } else if (
      referralDob
      && patientDob
      && referralDob.year === patientDob.year
      && referralDob.month === patientDob.month
    ) {
      score += 15;
      reasons.push('Partial DOB match');
    }
  }

  if (phone && patient.phone) {
    const referralPhone = normalizePhone(phone);
    const patientPhone = normalizePhone(patient.phone);
    if (
      referralPhone.length >= 7
      && patientPhone.length >= 7
      && (
        referralPhone === patientPhone
        || referralPhone.endsWith(patientPhone.slice(-7))
        || patientPhone.endsWith(referralPhone.slice(-7))
      )
    ) {
      score += 15;
      reasons.push('Phone match');
    }
  }

  if (address && patient.address) {
    const referralAddress = normalize(address);
    const patientAddress = normalize(patient.address);
    if (similarity(referralAddress, patientAddress) >= 0.7) {
      score += 10;
      reasons.push('Address match');
    }
  }

  return { patient, score, nameMatched, reasons };
}

/**
 * Rank the authorized identity roster once and derive both the deterministic
 * match and the bounded AI shortlist from that same ordering.
 */
export function buildReferralPatientMatchCandidates({ patients, demographics } = {}) {
  const source = Array.isArray(patients) ? patients : [];
  const rankedMatches = source
    .filter((patient) => patient && typeof patient === 'object' && !Array.isArray(patient))
    .map((patient, sourceIndex) => ({
      ...scorePatient(patient, demographics || {}),
      sourceIndex,
    }))
    .sort((left, right) => {
      const scoreDifference = right.score - left.score;
      if (scoreDifference !== 0) return scoreDifference;
      const idDifference = String(left.patient.id || '').localeCompare(String(right.patient.id || ''));
      return idDifference || left.sourceIndex - right.sourceIndex;
    })
    .map(({ sourceIndex: _sourceIndex, ...match }) => match);

  return {
    rankedMatches,
    bestMatch: rankedMatches[0] || null,
    aiCandidates: rankedMatches
      .slice(0, AI_MATCH_CANDIDATE_LIMIT)
      .map(({ patient }) => patient),
  };
}
