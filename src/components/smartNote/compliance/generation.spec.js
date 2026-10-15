import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestSmartNoteGrounding } = vi.hoisted(() => ({ requestSmartNoteGrounding: vi.fn() }));

vi.mock('@/components/smartNote/compliance/smartNoteOperations', () => ({
  requestSmartNoteDraft: vi.fn(),
  requestSmartNoteGrounding: (...args) => requestSmartNoteGrounding(...args),
}));
vi.mock('@/components/utils/security', () => ({ secureAICall: (call) => call() }));

import { groundNote } from './generation';

const NOTE = 'Patient ambulated 50 feet with walker. Wound bed pink, no drainage. Denies chest pain.';
const SOURCE = 'ambulated 50 ft w/ walker. wound pink no drainage.';
const verdict = (text, status = 'supported') => ({ text, status, source: 'draft' });

describe('groundNote', () => {
  beforeEach(() => requestSmartNoteGrounding.mockReset());

  it('verifies a note only when every sentence came back supported', async () => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences: [
      verdict('Patient ambulated 50 feet with walker'),
      verdict('Wound bed pink, no drainage'),
      verdict('Denies chest pain'),
    ] });
    expect(await groundNote(NOTE, SOURCE)).toMatchObject({ ok: true, unsupported: [] });
    expect(requestSmartNoteGrounding).toHaveBeenCalledWith({
      sentences: ['Patient ambulated 50 feet with walker', 'Wound bed pink, no drainage', 'Denies chest pain'],
      sourceText: SOURCE,
    });
  });

  it('accepts verdicts out of order or echoed with list numbers, spacing and end punctuation', async () => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences: [
      verdict('3. Denies chest pain.'),
      verdict('patient ambulated  50 feet with walker'),
      verdict('Wound bed pink, no drainage', 'unsupported'),
    ] });
    const result = await groundNote(NOTE, SOURCE);
    expect(result.error).toBeUndefined();
    expect(result.unsupported.map((s) => s.text)).toEqual(['Wound bed pink, no drainage']);
  });

  it('matches repeated sentences one verdict each', async () => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences: [
      verdict('Denies chest pain'),
      verdict('Denies chest pain'),
    ] });
    expect(await groundNote('Denies chest pain. Denies chest pain.', SOURCE)).toMatchObject({ ok: true });
  });

  it('flags an unsupported sentence', async () => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences: [
      verdict('Patient ambulated 50 feet with walker'),
      verdict('Wound bed pink, no drainage'),
      verdict('Denies chest pain', 'unsupported'),
    ] });
    const result = await groundNote(NOTE, SOURCE);
    expect(result.ok).toBe(false);
    expect(result.unsupported.map((s) => s.text)).toEqual(['Denies chest pain']);
  });

  it.each([
    ['an empty verdict list', []],
    ['a dropped sentence', [verdict('Patient ambulated 50 feet with walker'), verdict('Wound bed pink, no drainage')]],
    ['merged sentences', [verdict('Patient ambulated 50 feet with walker. Wound bed pink, no drainage. Denies chest pain')]],
    ['one sentence three times', [
      verdict('Patient ambulated 50 feet with walker'),
      verdict('Patient ambulated 50 feet with walker'),
      verdict('Patient ambulated 50 feet with walker'),
    ]],
    ['a substituted sentence', [
      verdict('Patient ambulated 50 feet with walker'),
      verdict('Wound bed pink, no drainage'),
      verdict('Denies shortness of breath'),
    ]],
  ])('does not verify a note when the check returns %s', async (_label, sentences) => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences });
    const result = await groundNote(NOTE, SOURCE);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/every sentence/);
  });
});
