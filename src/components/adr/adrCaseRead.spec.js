import { describe, expect, it } from 'vitest';
import { readAdrCases } from './adrCaseRead';
import { buildAdrChecklist } from './adrRequirements';
import { summarizePacketVerification, toPersistedVerification } from './adrPacketReview';

describe('ADR read contract compatibility', () => {
  it('keeps a valid historical minimal case and its unknown fields unchanged', () => {
    const value = [{ id: 'legacy-a', migration_note: 'Preserved' }];
    expect(readAdrCases(value)).toBe(value);
  });
  it('accepts the actual checklist and verification writers without altering their result', () => {
    const checklist = buildAdrChecklist({ letterItems: [], auditType: 'adr' });
    const verification_summary = toPersistedVerification(summarizePacketVerification({
      checklist, verification: { items: [] }, pageCount: 10,
    }));
    const value = [{ id: 'case-a', status: 'packet_verified', checklist, verification_summary }];
    expect(readAdrCases(value)).toBe(value);
  });
  it.each([
    { case_name: {} }, { status: [] }, { checklist: {} }, { checklist: [null] },
    { checklist: [{ title: [] }] }, { checklist: [{ verification_points: 'bad' }] },
    { letter_analysis: [] }, { letter_analysis: { special_instructions: [{}] } },
    { verification_summary: { items: {} } },
    { verification_summary: { items: [{ pages: [], issues: [null] }] } },
    { verification_summary: { items: [], readiness: { blocking: {} } } },
    { verification_summary: { items: [], follow_ups: [{}], overall_observations: [null] } },
    { submission_faxes: {} }, { submission_faxes: [{ to_number: {} }] },
    { packet_page_count: {} }, { final_packet_pages: Infinity },
  ])('rejects malformed retained-panel fields without echoing case content (%j)', bad => {
    expect(() => readAdrCases([{ id: 'case-a', ...bad }])).toThrow('ADR_CASE_READ_INVALID');
  });
});
