import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIDE_IN_SERVICE_RULE,
  buildCeTranscript,
  creditYear,
  dedupeCreditRecords,
  getInServiceRequirement,
  inServiceProgress,
} from './ceTranscript.js';

const COURSES = {
  'course-hipaa': { id: 'course-hipaa', category: 'compliance', estimated_minutes: 60, ceu_hours: 1 },
  'course-falls': { id: 'course-falls', category: 'safety', estimated_minutes: 90, ceu_hours: 1 },
  'course-oasis': { id: 'course-oasis', category: 'documentation', estimated_minutes: 30 },
};

const cert = (overrides) => ({
  id: overrides.id,
  course_id: overrides.course_id,
  assignment_id: overrides.assignment_id,
  hours: overrides.hours,
  completion_date: overrides.completion_date,
  issued_at: overrides.issued_at,
  training_category: overrides.training_category,
  revoked: overrides.revoked,
});

test('creditYear prefers the completion date and is timezone-stable', () => {
  assert.equal(creditYear({ completion_date: '2026-03-04', issued_at: '2027-01-01' }), 2026);
  // A late-December completion stays in that year even for a viewer west of UTC.
  assert.equal(creditYear({ completion_date: '2025-12-31T23:30:00Z' }), 2025);
  assert.equal(creditYear({ issued_at: '2024-07-09T10:00:00Z' }), 2024);
  assert.equal(creditYear({}), null);
  assert.equal(creditYear(null), null);
});

test('dedupeCreditRecords drops revoked/undated rows and double-counted retakes', () => {
  const records = dedupeCreditRecords([
    cert({ id: 'a', assignment_id: 'asg-1', course_id: 'course-hipaa', completion_date: '2026-02-01' }),
    // Same assignment passed again — one credit, not two.
    cert({ id: 'b', assignment_id: 'asg-1', course_id: 'course-hipaa', completion_date: '2026-05-01' }),
    cert({ id: 'c', course_id: 'course-falls', completion_date: '2026-02-01' }),
    // Legacy row with no assignment id, same course and year — still one credit.
    cert({ id: 'd', course_id: 'course-falls', completion_date: '2026-08-01' }),
    // Same course a year later is a genuine renewal and counts again.
    cert({ id: 'e', course_id: 'course-falls', completion_date: '2027-01-15' }),
    cert({ id: 'f', course_id: 'course-hipaa', completion_date: '2026-02-01', revoked: true }),
    cert({ id: 'g', course_id: 'course-hipaa' }),
  ]);

  assert.deepEqual(
    records.map((record) => [record.certificate.id, record.year]),
    [['a', 2026], ['c', 2026], ['e', 2027]]
  );
});

test('dedupeCreditRecords credits each assignment of a recurring course', () => {
  // A quarterly in-service arrives as separate assignments for the same course,
  // so each completion is its own training time and earns credit again.
  const records = dedupeCreditRecords([
    cert({ id: 'q1', assignment_id: 'asg-q1', course_id: 'course-falls', completion_date: '2026-01-10' }),
    cert({ id: 'q2', assignment_id: 'asg-q2', course_id: 'course-falls', completion_date: '2026-04-10' }),
  ]);

  assert.deepEqual(records.map((record) => record.certificate.id), ['q1', 'q2']);
});

test('buildCeTranscript groups CE credit and clock hours by credit year', () => {
  const transcript = buildCeTranscript(
    [
      cert({ id: '1', assignment_id: 'a1', course_id: 'course-hipaa', hours: 1, completion_date: '2026-02-01', training_category: 'compliance' }),
      cert({ id: '2', assignment_id: 'a2', course_id: 'course-falls', hours: 1, completion_date: '2026-06-01', training_category: 'safety' }),
      cert({ id: '3', assignment_id: 'a3', course_id: 'course-oasis', completion_date: '2025-04-01', training_category: 'documentation' }),
    ],
    { coursesById: COURSES, now: new Date('2026-07-01T12:00:00Z') }
  );

  assert.deepEqual(transcript.years, [
    {
      year: 2026,
      ceHours: 2,
      // 60 min + 90 min of seat time, which is more than the 2.0 CE credits.
      trainingHours: 2.5,
      courseCount: 2,
      byCategory: [
        { category: 'safety', hours: 1.5 },
        { category: 'compliance', hours: 1 },
      ],
    },
    {
      year: 2025,
      // No ceu_hours on the course and none on the certificate — zero CE credit,
      // but the half hour of training still counts.
      ceHours: 0,
      trainingHours: 0.5,
      courseCount: 1,
      byCategory: [{ category: 'documentation', hours: 0.5 }],
    },
  ]);
  assert.equal(transcript.currentYear.year, 2026);
  assert.equal(transcript.totalCeHours, 2);
  assert.equal(transcript.totalTrainingHours, 3);
});

test('buildCeTranscript falls back to CE hours when a course has no duration', () => {
  const transcript = buildCeTranscript(
    [cert({ id: '1', assignment_id: 'a1', course_id: 'course-unknown', hours: 2, completion_date: '2026-02-01' })],
    { coursesById: {}, now: new Date('2026-07-01T12:00:00Z') }
  );

  assert.equal(transcript.currentYear.ceHours, 2);
  assert.equal(transcript.currentYear.trainingHours, 2);
  assert.deepEqual(transcript.currentYear.byCategory, [{ category: 'general', hours: 2 }]);
});

test('buildCeTranscript has no current year when nothing was completed this year', () => {
  const transcript = buildCeTranscript(
    [cert({ id: '1', assignment_id: 'a1', course_id: 'course-hipaa', hours: 1, completion_date: '2024-02-01' })],
    { coursesById: COURSES, now: new Date('2026-07-01T12:00:00Z') }
  );

  assert.equal(transcript.currentYear, null);
  assert.equal(transcript.years.length, 1);
});

test('buildCeTranscript handles an empty transcript', () => {
  const transcript = buildCeTranscript([], { now: new Date('2026-07-01T12:00:00Z') });
  assert.deepEqual(transcript.years, []);
  assert.equal(transcript.totalCeHours, 0);
  assert.equal(transcript.totalTrainingHours, 0);
  assert.equal(transcript.requirement, null);
  assert.equal(transcript.progress, null);
});

test('getInServiceRequirement applies the CMS aide rule to aide titles only', () => {
  for (const user of [
    { job_title: 'Home Health Aide' },
    { job_title: 'Hospice Aide' },
    { job_title: 'Certified Nursing Assistant' },
    { credentials: 'HHA' },
    { credential_type: 'CNA' },
    { job_title: 'Personal Care Aide' },
  ]) {
    assert.equal(getInServiceRequirement(user), AIDE_IN_SERVICE_RULE, JSON.stringify(user));
  }

  for (const user of [
    { job_title: 'Registered Nurse' },
    { credential_type: 'RN' },
    { job_title: 'Physical Therapist' },
    { job_title: 'Clinical Manager' },
    null,
    {},
  ]) {
    assert.equal(getInServiceRequirement(user), null, JSON.stringify(user));
  }
});

test('buildCeTranscript measures aide progress against the current year only', () => {
  const certificates = [
    cert({ id: '1', assignment_id: 'a1', course_id: 'course-hipaa', hours: 1, completion_date: '2026-02-01' }),
    cert({ id: '2', assignment_id: 'a2', course_id: 'course-falls', hours: 1, completion_date: '2026-06-01' }),
    // Prior-year hours must not carry forward into this year's 12-hour period.
    cert({ id: '3', assignment_id: 'a3', course_id: 'course-falls', hours: 1, completion_date: '2025-06-01' }),
  ];

  const aide = buildCeTranscript(certificates, {
    coursesById: COURSES,
    user: { job_title: 'Home Health Aide' },
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.deepEqual(aide.progress, {
    requiredHours: 12,
    completedHours: 2.5,
    remainingHours: 9.5,
    percent: 21,
    met: false,
  });

  const nurse = buildCeTranscript(certificates, {
    coursesById: COURSES,
    user: { credential_type: 'RN' },
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.equal(nurse.progress, null);
});

test('inServiceProgress caps at the requirement and flags completion', () => {
  assert.deepEqual(inServiceProgress(AIDE_IN_SERVICE_RULE, 12), {
    requiredHours: 12,
    completedHours: 12,
    remainingHours: 0,
    percent: 100,
    met: true,
  });
  assert.deepEqual(inServiceProgress(AIDE_IN_SERVICE_RULE, 15), {
    requiredHours: 12,
    completedHours: 15,
    remainingHours: 0,
    percent: 100,
    met: true,
  });
  assert.deepEqual(inServiceProgress(AIDE_IN_SERVICE_RULE, -3), {
    requiredHours: 12,
    completedHours: 0,
    remainingHours: 12,
    percent: 0,
    met: false,
  });
  assert.deepEqual(inServiceProgress({ hours: 0 }, 4), {
    requiredHours: 0,
    completedHours: 4,
    remainingHours: 0,
    percent: 100,
    met: true,
  });
});
