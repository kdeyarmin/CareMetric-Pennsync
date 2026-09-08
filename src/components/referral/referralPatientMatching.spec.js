import { describe, expect, it } from 'vitest';
import {
  AI_MATCH_CANDIDATE_LIMIT,
  buildReferralPatientMatchCandidates,
} from './referralPatientMatching';

const demographics = {
  full_name: 'Ada Lovelace',
  date_of_birth: '1815-12-10',
  phone: '555-0100',
  address: '1 Computing Way',
};

describe('referral patient candidate ranking', () => {
  it('puts the actual highest-scored record into a bounded AI shortlist even beyond source position 100', () => {
    const patients = Array.from({ length: 100 }, (_, index) => ({
      id: `patient-${String(index).padStart(3, '0')}`,
      first_name: 'Different',
      last_name: `Person${index}`,
    }));
    patients.push({
      id: 'patient-z-best',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '1815-12-10',
      phone: '555-0100',
      address: '1 Computing Way',
    });

    const result = buildReferralPatientMatchCandidates({ patients, demographics });

    expect(result.bestMatch).toMatchObject({
      patient: { id: 'patient-z-best' },
      score: 95,
      nameMatched: true,
    });
    expect(result.aiCandidates).toHaveLength(AI_MATCH_CANDIDATE_LIMIT);
    expect(result.aiCandidates[0].id).toBe('patient-z-best');
    expect(result.aiCandidates.map((patient) => patient.id)).not.toContain('patient-099');
  });

  it('uses patient id as the deterministic tie-break independent of source order', () => {
    const patients = [
      { id: 'patient-b', first_name: 'Ada', last_name: 'Lovelace' },
      { id: 'patient-a', first_name: 'Ada', last_name: 'Lovelace' },
    ];

    const result = buildReferralPatientMatchCandidates({
      patients,
      demographics: { full_name: 'Ada Lovelace' },
    });

    expect(result.rankedMatches.map(({ patient }) => patient.id)).toEqual([
      'patient-a',
      'patient-b',
    ]);
  });

  it('does not mutate the roster or patient objects', () => {
    const patients = [
      { id: 'patient-b', first_name: 'Grace', last_name: 'Hopper' },
      { id: 'patient-a', first_name: 'Ada', last_name: 'Lovelace' },
    ];
    const snapshot = structuredClone(patients);

    buildReferralPatientMatchCandidates({ patients, demographics });

    expect(patients).toEqual(snapshot);
  });

  it('keeps empty or shared non-name identity signals from becoming auto-linkable', () => {
    const noIdentity = buildReferralPatientMatchCandidates({
      patients: [
        { id: 'patient-b', first_name: 'Grace' },
        { id: 'patient-a', first_name: 'Ada' },
      ],
      demographics: {},
    });
    expect(noIdentity.bestMatch).toMatchObject({ score: 0, nameMatched: false });
    expect(noIdentity.aiCandidates.map((patient) => patient.id)).toEqual([
      'patient-a',
      'patient-b',
    ]);

    const sharedHousehold = buildReferralPatientMatchCandidates({
      patients: [{
        id: 'patient-household',
        first_name: 'Grace',
        last_name: 'Hopper',
        date_of_birth: demographics.date_of_birth,
        phone: demographics.phone,
        address: demographics.address,
      }],
      demographics,
    });
    expect(sharedHousehold.bestMatch).toMatchObject({ score: 55, nameMatched: false });
    expect(
      sharedHousehold.bestMatch.score >= 60 && sharedHousehold.bestMatch.nameMatched,
    ).toBe(false);
  });

  it('does not treat empty or underspecified normalized phone values as matches', () => {
    const punctuationOnly = buildReferralPatientMatchCandidates({
      patients: [{ id: 'patient-punctuation', phone: '---' }],
      demographics: { phone: '()' },
    });
    expect(punctuationOnly.bestMatch).toMatchObject({ score: 0, nameMatched: false });

    const shortExtension = buildReferralPatientMatchCandidates({
      patients: [{ id: 'patient-extension', phone: '1234' }],
      demographics: { phone: '1234' },
    });
    expect(shortExtension.bestMatch).toMatchObject({ score: 0, nameMatched: false });
  });
});
