import { describe, it, expect } from 'vitest';
import { moduleToItem, itemToContentJson } from './CourseLessonBuilder';

// Guards the P1 fix: editing a rich (AI-generated / seeded) lesson in the manual
// builder must not erase the section/content fields the builder doesn't surface
// (example, pro_tip, warning, steps, do_dont, mnemonic, regulation_ref, plus
// top-level case_scenarios / clinical_pearl / summary).

describe('CourseLessonBuilder content round-trip', () => {
  const richModule = {
    id: 'm1',
    title: 'Hand Hygiene',
    estimated_minutes: 12,
    is_required: true,
    content_json: {
      intro: 'Why hand hygiene matters',
      sections: [
        {
          heading: 'When to wash',
          body: 'Before and after patient contact.',
          bullets: ['Before contact', 'After contact'],
          example: 'Nurse washes before wound care',
          pro_tip: 'Count to 20',
          warning: 'Alcohol gel is not enough for C. diff',
          steps: ['Wet', 'Lather', 'Scrub', 'Rinse', 'Dry'],
          do_dont: { do: ['Use soap'], dont: ['Skip drying'] },
          mnemonic: 'WLSRD',
          regulation_ref: 'CDC 2002',
        },
      ],
      key_takeaways: ['Wash for 20 seconds'],
      case_scenarios: [{ situation: 'Outbreak', guidance: 'Escalate hand-hygiene audits' }],
      clinical_pearl: 'Most missed step is drying',
      summary: 'Hand hygiene prevents infection',
    },
  };

  it('preserves rich section and top-level fields through an unrelated edit', () => {
    const item = moduleToItem(richModule);
    // Simulate the admin editing only the section body.
    item.sections[0].body = 'Before and after every patient contact.';

    const content = itemToContentJson(item);

    // Edited field applied.
    expect(content.sections[0].body).toBe('Before and after every patient contact.');
    // Rich section fields survive.
    const s = content.sections[0];
    expect(s.example).toBe('Nurse washes before wound care');
    expect(s.pro_tip).toBe('Count to 20');
    expect(s.warning).toContain('C. diff');
    expect(s.steps).toEqual(['Wet', 'Lather', 'Scrub', 'Rinse', 'Dry']);
    expect(s.do_dont).toEqual({ do: ['Use soap'], dont: ['Skip drying'] });
    expect(s.mnemonic).toBe('WLSRD');
    expect(s.regulation_ref).toBe('CDC 2002');
    // Top-level extras survive.
    expect(content.case_scenarios).toHaveLength(1);
    expect(content.clinical_pearl).toBe('Most missed step is drying');
    expect(content.summary).toBe('Hand hygiene prevents infection');
    // Edited intro + takeaways still round-trip.
    expect(content.intro).toBe('Why hand hygiene matters');
    expect(content.key_takeaways).toEqual(['Wash for 20 seconds']);
  });

  it('still serializes a brand-new lesson with no raw content', () => {
    const content = itemToContentJson({
      intro: 'Intro',
      sections: [{ heading: 'H', body: 'B', bulletsText: 'one\ntwo' }],
      takeawaysText: 'takeaway',
    });
    expect(content.sections[0]).toEqual({ heading: 'H', body: 'B', bullets: ['one', 'two'] });
    expect(content.key_takeaways).toEqual(['takeaway']);
  });
});
