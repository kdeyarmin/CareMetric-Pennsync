import { describe, it, expect } from 'vitest';
import { itemToPayload, questionToItem } from './CourseQuizBuilder';

// These guard the contract between the manual quiz builder and gradeTrainingAttempt:
// the grader compares correct_answer_json.answer against the option `value` the
// learner submits (TrainingQuestionRenderer submits option.value). If these shapes
// drift, hand-built quizzes silently grade every answer wrong.

describe('CourseQuizBuilder serialization', () => {
  it('mcq stores the correct option value in correct_answer_json.answer', () => {
    const item = {
      type: 'mcq',
      prompt: 'What is 2 + 2?',
      points: 1,
      rationale: '',
      options: [
        { _localId: 'a', value: 'opt-1', label: '3', correct: false },
        { _localId: 'b', value: 'opt-2', label: '4', correct: true },
      ],
    };
    const payload = itemToPayload(item, 'course-1', 0);
    expect(payload).toMatchObject({
      course_id: 'course-1',
      type: 'mcq',
      order_index: 0,
      active: true,
    });
    expect(payload.options_json).toEqual([
      { value: 'opt-1', label: '3' },
      { value: 'opt-2', label: '4' },
    ]);
    expect(payload.correct_answer_json).toEqual({ answer: 'opt-2' });
  });

  it('multi_select stores all correct values as an array', () => {
    const item = {
      type: 'multi_select',
      prompt: 'Select the even numbers',
      points: 2,
      options: [
        { _localId: 'a', value: 'v1', label: '2', correct: true },
        { _localId: 'b', value: 'v2', label: '3', correct: false },
        { _localId: 'c', value: 'v3', label: '4', correct: true },
      ],
    };
    const payload = itemToPayload(item, 'c', 1);
    expect(payload.correct_answer_json).toEqual({ answer: ['v1', 'v3'] });
  });

  it('true_false stores a boolean answer', () => {
    const payload = itemToPayload({ type: 'true_false', prompt: 'Sky is blue', correctBool: true }, 'c', 0);
    expect(payload.options_json).toEqual([]);
    expect(payload.correct_answer_json).toEqual({ answer: true });
  });

  it('short_answer has no fixed answer (AI graded)', () => {
    const payload = itemToPayload({ type: 'short_answer', prompt: 'Explain hand hygiene' }, 'c', 0);
    expect(payload.correct_answer_json).toEqual({});
    expect(payload.options_json).toEqual([]);
  });

  it('matching builds an option pool from the right texts and stores pairs by value', () => {
    const item = {
      type: 'matching',
      prompt: 'Match term to definition',
      points: 3,
      pairs: [
        { _localId: 'a', left: 'RN', rightText: 'Registered Nurse' },
        { _localId: 'b', left: 'LPN', rightText: 'Licensed Practical Nurse' },
        { _localId: 'c', left: '', rightText: '' }, // incomplete pair is dropped
      ],
    };
    const payload = itemToPayload(item, 'c', 0);
    // Option pool is the distinct right texts.
    expect(payload.options_json).toEqual([
      { value: 'm-0', label: 'Registered Nurse' },
      { value: 'm-1', label: 'Licensed Practical Nurse' },
    ]);
    // Pairs reference option values, matching what the renderer submits + grader compares.
    expect(payload.correct_answer_json).toEqual({
      answer: { pairs: [
        { left: 'RN', right: 'm-0' },
        { left: 'LPN', right: 'm-1' },
      ] },
    });
  });

  it('round-trips a matching question back to editable left/right text', () => {
    const persisted = {
      id: 'qm',
      type: 'matching',
      prompt: 'Match',
      options_json: [
        { value: 'm-0', label: 'Registered Nurse' },
        { value: 'm-1', label: 'Licensed Practical Nurse' },
      ],
      correct_answer_json: { answer: { pairs: [
        { left: 'RN', right: 'm-0' },
        { left: 'LPN', right: 'm-1' },
      ] } },
    };
    const item = questionToItem(persisted);
    expect(item.pairs.map((p) => ({ left: p.left, rightText: p.rightText }))).toEqual([
      { left: 'RN', rightText: 'Registered Nurse' },
      { left: 'LPN', rightText: 'Licensed Practical Nurse' },
    ]);
    // Re-serializing preserves the mapping.
    expect(itemToPayload(item, 'c', 0).correct_answer_json).toEqual({
      answer: { pairs: [
        { left: 'RN', right: 'm-0' },
        { left: 'LPN', right: 'm-1' },
      ] },
    });
  });

  it('round-trips an mcq question from persisted form back to the editor', () => {
    const persisted = {
      id: 'q1',
      type: 'mcq',
      prompt: 'Pick B',
      points: 1,
      options_json: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      correct_answer_json: { answer: 'b' },
    };
    const item = questionToItem(persisted);
    expect(item.id).toBe('q1');
    const correct = item.options.filter((o) => o.correct).map((o) => o.value);
    expect(correct).toEqual(['b']);
    // Re-serializing preserves the correct answer.
    const payload = itemToPayload(item, 'c', 0);
    expect(payload.correct_answer_json).toEqual({ answer: 'b' });
  });
});
