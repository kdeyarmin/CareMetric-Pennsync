import { describe, it, expect } from 'vitest';
import { buildPdgmNavigatorCsv } from './pdgmNavigatorExport';

describe('buildPdgmNavigatorCsv', () => {
  it('includes section headers and the row data', () => {
    const csv = buildPdgmNavigatorCsv(
      {
        discrepancies: [
          { type: 'Coding', severity: 'High', finding: 'Missing comorbidity', recommendation: 'Add N18.3' },
        ],
        optimization_opportunities: [{ area: 'Functional', opportunity: 'Re-score M1830' }],
      },
      new Date('2026-06-05T00:00:00Z')
    );
    expect(csv).toContain('DISCREPANCIES');
    expect(csv).toContain('OPTIMIZATION OPPORTUNITIES');
    expect(csv).toContain('Missing comorbidity');
    expect(csv).toContain('Re-score M1830');
  });

  it('neutralizes spreadsheet formula injection in AI-generated cells', () => {
    const csv = buildPdgmNavigatorCsv({
      discrepancies: [{ finding: '=cmd|calc', recommendation: '+1+1' }],
    });
    // Dangerous leading chars are prefixed with a single quote (text, not formula).
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'+1+1");
    // The raw formula must never sit at the start of a cell (after a delimiter).
    expect(csv).not.toMatch(/(^|,)=cmd\|calc/);
  });

  it('RFC-quotes cells containing commas/quotes', () => {
    const csv = buildPdgmNavigatorCsv({ discrepancies: [{ finding: 'a, b "c"' }] });
    expect(csv).toContain('"a, b ""c"""');
  });

  it('tolerates missing/empty navigation', () => {
    expect(typeof buildPdgmNavigatorCsv(null)).toBe('string');
    expect(buildPdgmNavigatorCsv({})).toContain('DISCREPANCIES');
  });
});
