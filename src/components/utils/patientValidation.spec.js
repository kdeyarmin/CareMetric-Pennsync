import { describe, it, expect } from 'vitest';
import {
  SEVERITY,
  VALIDATION_ERRORS,
  validateDate,
  validateDateOfBirth,
  validateDateOrder,
  validateEmail,
  validatePhone,
  formatPhoneNumber,
  validatePatient,
} from './patientValidation';

describe('validateDate', () => {
  it('accepts real calendar dates', () => {
    expect(validateDate('2026-01-31')).toBeNull();
    expect(validateDate('2024-02-29')).toBeNull(); // leap year
  });

  it('rejects dates that are not YYYY-MM-DD', () => {
    expect(validateDate('01/31/2026')).toBe(VALIDATION_ERRORS.INVALID_DATE);
    expect(validateDate('2026-1-31')).toBe(VALIDATION_ERRORS.INVALID_DATE);
  });

  // `new Date('2026-02-31T00:00:00')` is NOT Invalid Date — V8 rolls it forward
  // to 2026-03-03 — so a shape check plus an isNaN check passed these through
  // and every downstream reader saw a different calendar day than was typed.
  it.each([
    '2026-02-30',
    '2026-02-31',
    '2026-04-31',
    '2026-06-31',
    '2026-09-31',
    '2026-11-31',
    '2025-02-29', // not a leap year
    '2026-13-01',
    '2026-00-10',
    '2026-05-00',
  ])('rejects the impossible date %s instead of rolling it forward', (bad) => {
    expect(validateDate(bad)).toBe(VALIDATION_ERRORS.INVALID_DATE);
  });

  it('treats an empty value as "not provided", not invalid', () => {
    expect(validateDate('')).toBeNull();
    expect(validateDate(null)).toBeNull();
  });
});

describe('validateDateOfBirth', () => {
  it('rejects an impossible DOB rather than aging the patient off a rolled date', () => {
    expect(validateDateOfBirth('2026-02-31')).toBe(VALIDATION_ERRORS.INVALID_DATE);
  });

  it('rejects a future date of birth', () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(validateDateOfBirth(`${nextYear}-01-01`)).toBe(VALIDATION_ERRORS.FUTURE_DOB);
  });

  it('rejects an implausible age', () => {
    expect(validateDateOfBirth('1850-01-01')).toBe(VALIDATION_ERRORS.INVALID_AGE);
  });

  it('accepts an ordinary adult DOB', () => {
    expect(validateDateOfBirth('1961-12-01')).toBeNull();
  });
});

describe('validateDateOrder', () => {
  it('flags an admission after discharge', () => {
    expect(validateDateOrder('2026-05-02', '2026-05-01')).toBe(VALIDATION_ERRORS.INVALID_DATE_ORDER);
  });

  it('allows same-day admission and discharge', () => {
    expect(validateDateOrder('2026-05-01', '2026-05-01')).toBeNull();
  });

  // 2026-04-31 used to roll to 2026-05-01, which is NOT after the discharge
  // date, so the ordering check silently passed on a typo'd admission.
  it('does not compare a rolled-forward impossible date', () => {
    expect(validateDateOrder('2026-04-31', '2026-04-30')).toBeNull();
    // …and the field's own validator is what reports it.
    expect(validateDate('2026-04-31')).toBe(VALIDATION_ERRORS.INVALID_DATE);
  });

  it('is a no-op when either side is missing', () => {
    expect(validateDateOrder('', '2026-05-01')).toBeNull();
    expect(validateDateOrder('2026-05-01', null)).toBeNull();
  });
});

describe('validateEmail / validatePhone / formatPhoneNumber', () => {
  it('validates email shape', () => {
    expect(validateEmail('nurse@example.com')).toBeNull();
    expect(validateEmail('nurse@@example.com')).toBe(VALIDATION_ERRORS.INVALID_EMAIL);
    expect(validateEmail('')).toBeNull();
  });

  it('requires at least 10 phone digits, ignoring formatting', () => {
    expect(validatePhone('(215) 555-0100')).toBeNull();
    expect(validatePhone('555-0100')).toBe(VALIDATION_ERRORS.INVALID_PHONE);
  });

  it('formats a 10-digit number and passes anything else through', () => {
    expect(formatPhoneNumber('2155550100')).toBe('(215) 555-0100');
    expect(formatPhoneNumber('+1 215 555 0100')).toBe('+1 215 555 0100');
  });
});

describe('validatePatient', () => {
  it('reports the impossible admission date as an error', () => {
    const results = validatePatient({ admission_date: '2026-02-31' });
    expect(results).toEqual([
      { field: 'admission_date', message: VALIDATION_ERRORS.INVALID_DATE, severity: SEVERITY.ERROR },
    ]);
  });

  it('returns no findings for a clean record', () => {
    expect(
      validatePatient({
        email: 'patient@example.com',
        phone: '2155550100',
        date_of_birth: '1950-06-15',
        admission_date: '2026-05-01',
        discharge_date: '2026-06-01',
      }),
    ).toEqual([]);
  });

  it('warns (overridably) on a minor rather than erroring', () => {
    const year = new Date().getFullYear() - 10;
    const results = validatePatient({ date_of_birth: `${year}-01-01` });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      field: 'date_of_birth',
      severity: SEVERITY.WARNING,
      canOverride: true,
    });
  });
});
