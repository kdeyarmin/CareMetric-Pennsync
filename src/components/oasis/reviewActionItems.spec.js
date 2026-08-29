import { describe, it, expect } from 'vitest';
import { buildActionItemsFromReview } from '@/components/oasis/reviewActionItems';

const ctx = { analysisId: 'analysis_123', patientName: 'Testy McPatient' };

describe('buildActionItemsFromReview', () => {
  it('returns nothing without an analysis id or without findings', () => {
    expect(buildActionItemsFromReview({ reviewResults: { compliance_risks: [{ description: 'x' }] } })).toEqual([]);
    expect(buildActionItemsFromReview({ reviewResults: null, ...ctx })).toEqual([]);
    expect(
      buildActionItemsFromReview({
        reviewResults: { compliance_risks: [], documentation_inconsistencies: [] },
        ...ctx,
      })
    ).toEqual([]);
  });

  it('maps AI compliance risks onto compliance correction items', () => {
    const [item] = buildActionItemsFromReview({
      ...ctx,
      reviewResults: {
        compliance_risks: [{
          risk_title: 'Homebound status unsupported',
          description: 'Narrative does not establish homebound criteria.',
          corrective_action: 'Document taxing effort and assistance required to leave home.',
          severity: 'critical',
          affected_m_items: ['M1033', 'M1800'],
        }],
      },
    });
    expect(item).toMatchObject({
      analysis_id: 'analysis_123',
      patient_name: 'Testy McPatient',
      action_type: 'correction',
      category: 'compliance',
      oasis_item: 'M1033, M1800',
      severity: 'critical',
      source: 'ai_recommendation',
      status: 'pending_review',
    });
    expect(item.rationale).toContain('Homebound status unsupported');
    expect(item.rationale).toContain('Corrective action: Document taxing effort');
  });

  it('maps AI documentation inconsistencies onto documentation items with the suspect value', () => {
    const [item] = buildActionItemsFromReview({
      ...ctx,
      reviewResults: {
        documentation_inconsistencies: [{
          inconsistency_title: 'Ambulation vs narrative',
          description: 'M1860=1 but narrative describes wheelchair dependence.',
          how_to_reconcile: 'Re-assess ambulation and correct M1860.',
          likely_incorrect_value: 'M1860=1',
          severity: 'high',
          data_points_involved: ['M1860'],
        }],
      },
    });
    expect(item).toMatchObject({
      action_type: 'correction',
      category: 'documentation',
      oasis_item: 'M1860',
      current_value: 'M1860=1',
      severity: 'high',
      source: 'ai_recommendation',
    });
    expect(item.rationale).toContain('How to reconcile');
  });

  it('maps deterministic findings onto discrepancy items with rule-derived categories', () => {
    const items = buildActionItemsFromReview({
      ...ctx,
      reviewResults: null,
      deterministicFindings: [
        { check: 'm1810_dress_upper-range', severity: 'high', m_items: ['M1810'], message: 'M1810 out of range.', current_value: '9' },
        { check: 'primary-dx-format', severity: 'high', m_items: ['M1021'], message: 'Bad ICD-10.', current_value: 'CHF' },
        { check: 'episode-timing-value', severity: 'low', m_items: ['M0110'], message: 'Unrecognized timing.' },
        { check: 'assessment-type-missing', severity: 'medium', m_items: ['M0100'], message: 'No assessment type.' },
      ],
    });
    expect(items.map((i) => i.category)).toEqual([
      'functional_status', 'diagnosis', 'episode_timing', 'documentation',
    ]);
    expect(items.every((i) => i.source === 'discrepancy')).toBe(true);
    expect(items[0]).toMatchObject({ oasis_item: 'M1810', current_value: '9', severity: 'high' });
  });

  it('always emits the entity-required fields and normalizes unknown severities', () => {
    const items = buildActionItemsFromReview({
      ...ctx,
      reviewResults: {
        compliance_risks: [
          { description: 'Risk with a weird severity.', severity: 'catastrophic' },
          { risk_title: '', description: '', corrective_action: '' }, // nothing to say → skipped
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    for (const required of ['action_type', 'category', 'rationale']) {
      expect(items[0][required]).toBeTruthy();
    }
  });

  it('clips very long rationales', () => {
    const [item] = buildActionItemsFromReview({
      ...ctx,
      reviewResults: { compliance_risks: [{ description: 'x'.repeat(3000), severity: 'low' }] },
    });
    expect(item.rationale.length).toBeLessThanOrEqual(900);
    expect(item.rationale.endsWith('…')).toBe(true);
  });
});
