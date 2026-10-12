import { describe, expect, it } from 'vitest';
import { usableAnswers } from './responseIngestion';
const openItems = [{ id: 'question' }];
const answer = { id: 'question', answered: true, response_text: 'Provider response' };
describe('provider response selection', () => {
  it('deduplicates repeated identical answers', () => {
    expect(usableAnswers({ answers: [answer, { ...answer, response_text: ' Provider response ' }] }, openItems)).toEqual([answer]);
  });
  it('withholds conflicting answers for the same question', () => {
    expect(usableAnswers({ answers: [answer, { ...answer, response_text: 'Conflicting response' }] }, openItems)).toEqual([]);
  });
  it('does not render or apply non-text responses', () => {
    expect(usableAnswers({ answers: [{ ...answer, response_text: { text: 'unsafe shape' } }] }, openItems)).toEqual([]);
  });
  it('handles a malformed answers collection', () => {
    expect(usableAnswers({ answers: {} }, openItems)).toEqual([]);
  });
  it('excludes unknown, unanswered, and empty responses', () => {
    expect(usableAnswers({ answers: [
      { ...answer, id: 'unknown' }, { ...answer, answered: false }, { ...answer, response_text: ' ' },
    ] }, openItems)).toEqual([]);
  });
});