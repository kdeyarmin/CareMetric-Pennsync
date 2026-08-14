import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Guard for computeAttemptScore / hasNoGradableQuestions, the pure scoring
 * helpers inlined in gradeTrainingAttempt (single-file Deno deploy model).
 *
 * WHY THIS EXISTS
 * The score used to be `earnedPoints / (sum(points) || 1)`. For a course with
 * no ACTIVE questions that is 0 / 1 = 0%, which against the default 80% pass
 * mark recorded a FAILED attempt — and at max_attempts: 1 LOCKED the
 * assignment — for a learner who completed everything the course asked. Two
 * supported configurations reach it: an attestation-only in-service, and any
 * course whose questions an admin deactivated (grading counts only
 * `active: true` questions). The player's Submit button is enabled in that
 * state too, because `answeredCount < totalQuestions` is false at 0 of 0.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import[^;]*from\s+'npm:[^']*';?/g, "");
  const js = transpileTs(src).outputText;
  const stubs = "const createClientFromRequest = () => ({});\n";
  const tmp = join(tmpdir(), `grade_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${stubs}${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const load = () =>
  loadInline("../functions/gradeTrainingAttempt/entry.ts", [
    "computeAttemptScore",
    "hasNoGradableQuestions",
    "resolveUngradedOutcome",
  ]);

test("hasNoGradableQuestions recognizes an unscoreable course", async () => {
  const { hasNoGradableQuestions } = await load();
  assert.equal(hasNoGradableQuestions([]), true);
  assert.equal(hasNoGradableQuestions(undefined), true);
  assert.equal(hasNoGradableQuestions(null), true);
  assert.equal(hasNoGradableQuestions([{ points: 1 }]), false);
});

test("a question-less course scores 100, not the 0% that failed the learner", async () => {
  const { computeAttemptScore } = await load();
  assert.equal(computeAttemptScore([], 0), 100);
  assert.equal(computeAttemptScore(undefined, 0), 100);
  // The old expression: 0 earned over a `|| 1` denominator.
  assert.notEqual(computeAttemptScore([], 0), 0);
});

test("scores a normal attempt as earned/possible percent", async () => {
  const { computeAttemptScore } = await load();
  const questions = [{ points: 1 }, { points: 1 }, { points: 1 }, { points: 1 }];
  assert.equal(computeAttemptScore(questions, 4), 100);
  assert.equal(computeAttemptScore(questions, 3), 75);
  assert.equal(computeAttemptScore(questions, 0), 0);
});

test("weights questions by their point value and rounds", async () => {
  const { computeAttemptScore } = await load();
  const questions = [{ points: 5 }, { points: 5 }, { points: 10 }];
  assert.equal(computeAttemptScore(questions, 10), 50);
  // 2/3 of a 3-point paper rounds to 67.
  assert.equal(computeAttemptScore([{ points: 1 }, { points: 1 }, { points: 1 }], 2), 67);
});

test("a question with no point value still counts as one point", async () => {
  const { computeAttemptScore } = await load();
  assert.equal(computeAttemptScore([{}, {}], 1), 50);
});

/**
 * `attestation_required` cannot stand in for "authored without an assessment":
 * assignAnnualLearningPlan sets it on EVERY annual-plan assignment
 * (`settings.attestationRequired !== false`) and the seeded annual courses
 * require attestation while also carrying graded questions. Keying the
 * auto-pass off it would hand a 100% completion — certificate included — to a
 * learner whose course had merely had its questions deactivated.
 */
test("an attestation-only course (no questions authored) is the only auto-pass", async () => {
  const { resolveUngradedOutcome } = await load();
  assert.equal(
    resolveUngradedOutcome({ hasAnyQuestions: false, attestationRequired: true }),
    "attestation_only",
  );
});

test("a course whose questions were deactivated is refused, not passed", async () => {
  const { resolveUngradedOutcome } = await load();
  // The annual-plan shape: attestation required AND questions exist, all inactive.
  assert.equal(
    resolveUngradedOutcome({ hasAnyQuestions: true, attestationRequired: true }),
    "questions_deactivated",
  );
  assert.equal(
    resolveUngradedOutcome({ hasAnyQuestions: true, attestationRequired: false }),
    "questions_deactivated",
  );
});

test("a course with neither a test nor an attestation records nothing", async () => {
  const { resolveUngradedOutcome } = await load();
  assert.equal(
    resolveUngradedOutcome({ hasAnyQuestions: false, attestationRequired: false }),
    "nothing_to_record",
  );
});
