import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';

const read = (relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8');

const ENTITY_SOURCE = read('base44/entities/TrainingQuestion.jsonc');
const BROKER_SOURCE = read('base44/functions/getCoursePlayerQuestions/entry.ts');
const PLAYER_SOURCE = read('src/pages/TrainingCoursePlayer.jsx');
const BOOSTER_SOURCE = read('src/components/training/LearnerMemoryBoosters.jsx');

function loadSanitizer() {
  const start = BROKER_SOURCE.indexOf('function sanitizeTrainingQuestionOptions');
  const end = BROKER_SOURCE.indexOf('Deno.serve', start);
  assert.ok(start >= 0 && end > start, 'learner sanitizer must be a testable pure helper');
  const helperSource = BROKER_SOURCE.slice(start, end);
  return Function(`${helperSource}\nreturn sanitizeTrainingQuestionForLearner;`)();
}

test('TrainingQuestion full records are admin-only for every entity operation', () => {
  const entity = JSON5.parse(ENTITY_SOURCE);
  for (const operation of ['read', 'create', 'update', 'delete']) {
    assert.deepEqual(
      entity.rls?.[operation],
      { user_condition: { role: 'admin' } },
      `${operation} must require the protected admin role`,
    );
  }
});

test('learner question payload omits answer keys and grading guidance', () => {
  const sanitize = loadSanitizer();
  const result = sanitize({
    id: 'q1',
    course_id: 'course-1',
    type: 'mcq',
    prompt: 'What is safest?',
    options_json: [
      { label: 'A', value: 'a', correct: false, feedback: 'Not this one' },
      { label: 'B', value: 'b', correct: true, feedback: 'This gives it away' },
    ],
    correct_answer_json: { answer: 'b' },
    rationale: 'B is correct.',
    rubric: 'Award credit only for B.',
    source_citations_json: [{ url: 'https://example.test/secret-source' }],
    difficulty: 'medium',
    points: 2,
    order_index: 1,
    active: true,
  });

  assert.deepEqual(result, {
    id: 'q1',
    course_id: 'course-1',
    type: 'mcq',
    prompt: 'What is safest?',
    options_json: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    difficulty: 'medium',
    points: 2,
    order_index: 1,
    active: true,
  });
  for (const secret of ['correct_answer_json', 'rationale', 'rubric', 'source_citations_json']) {
    assert.equal(Object.hasOwn(result, secret), false, `${secret} must not reach a learner`);
  }
  assert.doesNotMatch(JSON.stringify(result.options_json), /correct|feedback|gives it away/);
});

test('matching payload keeps prompts but removes every answer-side value', () => {
  const sanitize = loadSanitizer();
  const result = sanitize({
    id: 'matching-1',
    course_id: 'course-1',
    type: 'matching',
    prompt: 'Match the terms.',
    options_json: ['Hand hygiene', 'PPE'],
    correct_answer_json: {
      answer: {
        pairs: [
          { left: 'Before patient contact', right: 'Hand hygiene' },
          { left: 'Isolation room', right: 'PPE' },
        ],
      },
    },
    active: true,
  });

  assert.deepEqual(result.correct_answer_json, {
    answer: {
      pairs: [
        { left: 'Before patient contact' },
        { left: 'Isolation room' },
      ],
    },
  });
  assert.doesNotMatch(JSON.stringify(result.correct_answer_json), /Hand hygiene|PPE|right/);
});

test('known learner flows use the sanitized broker, including forced preview', () => {
  assert.match(
    PLAYER_SOURCE,
    /const canSeeAnswerKey = previewMode && getRoleView\(currentUser\) !== "nurse"/,
    'a URL preview flag alone must not unlock the full entity',
  );
  assert.match(PLAYER_SOURCE, /getCoursePlayerQuestions\(\{ course_id: cid \}\)/);
  assert.match(BOOSTER_SOURCE, /getCoursePlayerQuestions\(\{ course_id: courseId \}\)/);
  assert.doesNotMatch(
    BOOSTER_SOURCE,
    /base44\.entities\.TrainingQuestion/,
    'memory boosters must not fetch full TrainingQuestion rows',
  );
});
