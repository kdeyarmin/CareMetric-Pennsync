import { describe, expect, it } from 'vitest';
import dischargePdfContent from './dischargePdfContent';
describe('discharge clinical PDF content', () => {
  it('includes instructions, follow-up, medications, function, and outcomes', () => {
    const result = dischargePdfContent({
      summary_of_care: 'Reviewed narrative', discharge_instructions: 'Call for SpO2 <90% or temperature >100.4.',
      discharge_disposition: 'home_with_support', functional_status: { at_discharge: 'Ambulates with assistance' },
      medication_summary: { medications_at_discharge: ['Test medication'], medication_changes: [{ medication: 'Test medication', change_type: 'dose_changed', reason: 'Reviewed dose' }] },
      care_plan_outcomes: [{ problem: 'Mobility', goal: 'Safe ambulation', outcome: 'met', notes: 'With walker' }],
      follow_up_recommendations: [{ recommendation: 'Reassessment', provider: 'Treating clinician', timeframe: 'Next week' }],
    });
    const text = result.filter(section => section.type === 'text').map(section => section.text).join('\n');
    for (const value of ['Reviewed narrative', 'SpO2 <90%', 'temperature >100.4', 'Test medication', 'Reviewed dose', 'Ambulates with assistance', 'Safe ambulation', 'Reassessment', 'Next week']) expect(text).toContain(value);
  });
  it('does not invent clinical facts when optional sections are missing', () => {
    const result = dischargePdfContent({ summary_of_care: 'Narrative only' });
    expect(result.filter(section => section.type === 'heading').map(section => section.text)).toEqual(['Admission / Discharge', 'Summary of Care']);
  });
});