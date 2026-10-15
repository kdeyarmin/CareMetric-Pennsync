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
  ])('does not verify a note when the check returns %s', async (_label, sentences) => {
    requestSmartNoteGrounding.mockResolvedValue({ sentences });
    const result = await groundNote(NOTE, SOURCE);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/every sentence/);
  });
});
