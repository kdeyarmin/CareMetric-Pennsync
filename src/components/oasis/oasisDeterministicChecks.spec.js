import { describe, it, expect } from 'vitest';
import {
  runOasisDeterministicChecks,
  deterministicChecksPromptBlock,
} from '@/components/oasis/oasisDeterministicChecks';

const TODAY = new Date(2026, 7, 29); // 2026-08-29 local

// A fully valid extraction — the all-pass baseline every test mutates from.
const validPdgm = () => ({
  patient_info: { assessment_date: '2026-08-25', assessment_type: 'SOC' },
  primary_diagnosis_code: 'I50.9',
  episode_timing: 'early',
  clinical_items: { dyspnea: 2 },
  functional_scores: {
    m1800_grooming: 1,
    m1810_dress_upper: 2,
    m1820_dress_lower: 2,
    m1830_bathing: 3,
    m1840_toilet_transfer: 2,
    m1850_transferring: 2,
    m1860_ambulation: 3,
  },
});

const findingChecks = (result) => result.findings.map((f) => f.check);

describe('runOasisDeterministicChecks', () => {
  it('passes a fully valid extraction', () => {
    const result = runOasisDeterministicChecks(validPdgm(), { today: TODAY });
    expect(result.findings).toEqual([]);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(result.total);
  });

  it('flags out-of-range and non-numeric functional scores at their per-item maxima', () => {
    const data = validPdgm();
    data.functional_scores.m1810_dress_upper = 5; // max 3
    data.functional_scores.m1830_bathing = 6; // max 6 — valid
    data.functional_scores.m1860_ambulation = 'severe'; // not numeric
    const result = runOasisDeterministicChecks(data, { today: TODAY });
    expect(findingChecks(result)).toEqual(
      expect.arrayContaining(['m1810_dress_upper-range', 'm1860_ambulation-range'])
    );
    expect(findingChecks(result)).not.toContain('m1830_bathing-range');
    const m1810 = result.findings.find((f) => f.check === 'm1810_dress_upper-range');
    expect(m1810.severity).toBe('high');
    expect(m1810.message).toContain('0–3');
    expect(m1810.m_items).toEqual(['M1810']);
  });

  it('flags missing functional scores as PDGM gaps, accepting string numbers as documented', () => {
    const data = validPdgm();
    delete data.functional_scores.m1850_transferring;
    data.functional_scores.m1800_grooming = '2'; // string but numeric — documented
    const result = runOasisDeterministicChecks(data, { today: TODAY });
    expect(findingChecks(result)).toContain('m1850_transferring-missing');
    expect(findingChecks(result)).not.toContain('m1800_grooming-missing');
    expect(result.findings.find((f) => f.check === 'm1850_transferring-missing').severity).toBe('medium');
  });

  it('detects the bedfast-vs-ambulation contradiction in both directions', () => {
    const bedfastTransfer = validPdgm();
    bedfastTransfer.functional_scores.m1850_transferring = 5; // bedfast
    bedfastTransfer.functional_scores.m1860_ambulation = 0; // walks independently
    expect(findingChecks(runOasisDeterministicChecks(bedfastTransfer, { today: TODAY })))
      .toContain('bedfast-vs-ambulation');

    const bedfastAmbulation = validPdgm();
    bedfastAmbulation.functional_scores.m1860_ambulation = 6; // bedfast, unable
    bedfastAmbulation.functional_scores.m1850_transferring = 0; // independent transfer
    expect(findingChecks(runOasisDeterministicChecks(bedfastAmbulation, { today: TODAY })))
      .toContain('bedfast-vs-transferring');

    // A consistent bedfast patient triggers neither.
    const consistent = validPdgm();
    consistent.functional_scores.m1850_transferring = 5;
    consistent.functional_scores.m1860_ambulation = 6;
    const checks = findingChecks(runOasisDeterministicChecks(consistent, { today: TODAY }));
    expect(checks).not.toContain('bedfast-vs-ambulation');
    expect(checks).not.toContain('bedfast-vs-transferring');
  });

  it('validates the assessment date (missing, unparseable, future)', () => {
    const missing = validPdgm();
    missing.patient_info.assessment_date = '';
    expect(findingChecks(runOasisDeterministicChecks(missing, { today: TODAY })))
      .toContain('assessment-date-missing');

    const future = validPdgm();
    future.patient_info.assessment_date = '2026-09-15';
    const result = runOasisDeterministicChecks(future, { today: TODAY });
    expect(findingChecks(result)).toContain('assessment-date-future');
    expect(result.findings.find((f) => f.check === 'assessment-date-future').severity).toBe('high');
  });

  it('validates the primary diagnosis code shape, accepting dotted and undotted ICD-10', () => {
    const undotted = validPdgm();
    undotted.primary_diagnosis_code = 'I509';
    expect(runOasisDeterministicChecks(undotted, { today: TODAY }).failed).toBe(0);

    const malformed = validPdgm();
    malformed.primary_diagnosis_code = 'CHF';
    expect(findingChecks(runOasisDeterministicChecks(malformed, { today: TODAY })))
      .toContain('primary-dx-format');

    const absent = validPdgm();
    absent.primary_diagnosis_code = '';
    const result = runOasisDeterministicChecks(absent, { today: TODAY });
    expect(findingChecks(result)).toContain('primary-dx-missing');
    expect(result.findings.find((f) => f.check === 'primary-dx-missing').severity).toBe('high');
  });

  it('flags out-of-range dyspnea and unrecognized episode timing, tolerating absent values', () => {
    const bad = validPdgm();
    bad.clinical_items.dyspnea = 7;
    bad.episode_timing = 'sometimes';
    const checks = findingChecks(runOasisDeterministicChecks(bad, { today: TODAY }));
    expect(checks).toContain('m1400-range');
    expect(checks).toContain('episode-timing-value');

    const sparse = validPdgm();
    delete sparse.clinical_items;
    delete sparse.episode_timing;
    const sparseChecks = findingChecks(runOasisDeterministicChecks(sparse, { today: TODAY }));
    expect(sparseChecks).not.toContain('m1400-range');
    expect(sparseChecks).not.toContain('episode-timing-value');
  });
});

describe('deterministicChecksPromptBlock', () => {
  it('summarizes an all-pass run without listing findings', () => {
    const block = deterministicChecksPromptBlock(
      runOasisDeterministicChecks(validPdgm(), { today: TODAY })
    );
    expect(block).toContain('DETERMINISTIC PRE-CHECKS');
    expect(block).toContain('deterministic checks passed');
    expect(block).not.toContain('FAIL');
  });

  it('lists each failure with severity and M-items', () => {
    const data = validPdgm();
    data.functional_scores.m1810_dress_upper = 9;
    const block = deterministicChecksPromptBlock(
      runOasisDeterministicChecks(data, { today: TODAY })
    );
    expect(block).toContain('FAIL [high] M1810');
    expect(block).toContain('do NOT contradict');
  });
});
