import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const isAdminUser = (user) =>
  user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

// Tolerant JSON extractor (mirrors generateTrainingCourse): the model is asked
// for strict JSON but may wrap it in fences or prose.
const parseLLMJson = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const ALLOWED_TYPES = ['mcq', 'true_false', 'multi_select', 'short_answer', 'scenario_based'];

// Match an AI-provided correct answer to one of the option values (by value or
// label). Returns null when it can't be matched, so the authoring UI forces the
// admin to pick a correct answer rather than silently shipping a wrong one.
const matchOptionValue = (options, answer) => {
  if (answer == null) return null;
  const s = String(answer).trim().toLowerCase();
  const byValue = options.find((o) => String(o.value).toLowerCase() === s);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => String(o.label).toLowerCase() === s);
  if (byLabel) return byLabel.value;
  return null;
};

// Normalize an LLM question into the exact persisted TrainingQuestion shape the
// course builder and gradeTrainingAttempt expect.
const normalizeQuestion = (q, index) => {
  const type = ALLOWED_TYPES.includes(q?.type) ? q.type : 'mcq';
  const prompt = String(q?.prompt || `Question ${index + 1}`).trim();
  const points = type === 'short_answer' || type === 'scenario_based' ? 2 : 1;
  const base = {
    type,
    prompt,
    rationale: String(q?.rationale || ''),
    rubric: String(q?.rubric || ''),
    difficulty: ['easy', 'medium', 'hard'].includes(q?.difficulty) ? q.difficulty : 'medium',
    points,
  };

  if (type === 'mcq' || type === 'multi_select') {
    const rawOptions = Array.isArray(q?.options) ? q.options : [];
    const options = rawOptions
      .map((o, i) =>
        o && typeof o === 'object'
          ? { value: String(o.value ?? `o${i}`), label: String(o.label ?? o.value ?? '') }
          : { value: `o${i}`, label: String(o) }
      )
      .filter((o) => o.label);

    let answer;
    if (type === 'multi_select') {
      const list = Array.isArray(q?.correct_answer)
        ? q.correct_answer
        : q?.correct_answer != null
          ? [q.correct_answer]
          : [];
      answer = list.map((a) => matchOptionValue(options, a)).filter(Boolean);
    } else {
      answer = matchOptionValue(options, q?.correct_answer);
    }
    return { ...base, options_json: options, correct_answer_json: { answer } };
  }

  if (type === 'true_false') {
    const ca = q?.correct_answer;
    const answer = ca === true || ca === 'true' || ca === 'True';
    return { ...base, options_json: [], correct_answer_json: { answer } };
  }

  // short_answer / scenario_based — AI graded, no fixed answer.
  return { ...base, options_json: [], correct_answer_json: {} };
};

const buildLessonContext = (modules) =>
  modules
    .map((m, i) => {
      const c = m.content_json || {};
      const sections = (Array.isArray(c.sections) ? c.sections : [])
        .map((s) => `${s.heading || ''}: ${s.body || ''} ${(Array.isArray(s.bullets) ? s.bullets : []).join('; ')}`)
        .join('\n');
      const takeaways = (Array.isArray(c.key_takeaways) ? c.key_takeaways : []).join('; ');
      return `LESSON ${i + 1}: ${m.title || ''}\n${c.intro || ''}\n${sections}${takeaways ? `\nKey takeaways: ${takeaways}` : ''}`;
    })
    .join('\n\n');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized - admin access required' }, { status: 403 });
    }

    if (Deno.env.get('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1') {
      return Response.json({ error: 'Course creation and video publishing have moved to the CareMetric Support Hub.', code: 'LEARNING_MOVED', hub_url: 'https://support-hub-web-production.up.railway.app/library' }, { status: 410 });
    }

    const {
      course_id,
      question_count = 5,
      question_types = ['mcq', 'true_false', 'short_answer'],
    } = await req.json();

    if (!course_id) {
      return Response.json({ error: 'course_id is required' }, { status: 400 });
    }

    const courseList = await base44.asServiceRole.entities.TrainingCourse.filter({ id: course_id }, undefined, 5000);
    const course = courseList[0];
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    const modules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id }, 'order_index', 100);
    const lessonContext = buildLessonContext(modules).trim();
    if (!lessonContext) {
      return Response.json({ error: 'Add at least one lesson with content before generating a quiz.' }, { status: 400 });
    }

    const count = Math.max(1, Math.min(Number(question_count) || 5, 20));
    const types = Array.isArray(question_types) && question_types.length ? question_types : ['mcq', 'true_false', 'short_answer'];

    const prompt = `You are a healthcare instructional designer writing an end-of-course knowledge check. Generate exactly ${count} quiz questions that test the learner ONLY on the lesson content below — do not introduce facts that are not covered in the lessons.

COURSE: ${course.title}

LESSON CONTENT:
${lessonContext}

REQUIREMENTS:
- Use only these question types: ${types.join(', ')}.
- Spread difficulty roughly 30% easy / 40% medium / 30% hard.
- Every question must be answerable from the lesson content above.
- For each question include a short "rationale" explaining why the correct answer is right.
- For short_answer/scenario_based, include a "rubric" describing full/partial/no credit.

Return ONLY valid JSON (no prose, no code fences) in EXACTLY this shape:
{
  "questions": [
    {
      "type": "mcq | true_false | multi_select | short_answer",
      "prompt": "the question text",
      "options": [ { "value": "a", "label": "Option text" } ],   // mcq/multi_select only; 3-5 options
      "correct_answer": "a",                                       // mcq: the correct option value; true_false: true/false; multi_select: array of correct option values; omit for short_answer
      "rationale": "why the correct answer is correct",
      "rubric": "for short_answer only: grading criteria",
      "difficulty": "easy | medium | hard"
    }
  ]
}`;

    let generated;
    try {
      const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: 'automatic',
        prompt: `You write rigorous, fair healthcare training assessments grounded strictly in the provided material. Return ONLY valid JSON, no prose or code fences.\n\n${prompt}`,
      });
      generated = parseLLMJson(raw);
    } catch {
      generated = null;
    }

    const rawQuestions = Array.isArray(generated?.questions) ? generated.questions : [];
    if (rawQuestions.length === 0) {
      return Response.json({ error: 'The AI could not generate questions from these lessons. Please try again.' }, { status: 502 });
    }

    const questions = rawQuestions.slice(0, count).map(normalizeQuestion);

    return Response.json({ success: true, questions });
  } catch (error) {
    console.error('generateCourseQuiz failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
