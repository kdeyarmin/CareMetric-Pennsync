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


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

// Tolerant JSON extractor: the model is asked (in-prompt) to return strict JSON,
// but may wrap it in ```json fences or prose. Pull the outermost {...} and parse.
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

const buildPrompt = (course) => `Create a presentation-style healthcare in-service with short, easy-to-follow lesson sections and a graded quiz at the end.

Course title: ${course.title}
Short description: ${course.short_description || ''}
Description: ${course.description || ''}
Category: ${course.category || 'compliance'}
Business line: ${course.business_line_scope || 'all'}
Audience: ${course.employee_audience || course.role_targets?.join(', ') || 'frontline healthcare staff'}
Estimated minutes: ${course.estimated_minutes || 30}
Training type: ${course.training_type}

Reference style inspiration:
- Relias-style annual mandatory education: concise modules, practical application, strong compliance focus
- Home care training style: short plain-language explanations, realistic home setting examples, quick knowledge checks

Requirements:
- Write in plain, practical language suitable for frontline staff
- Make the lesson easy to scan and understand quickly
- Use short sections, bullets, examples, and mini-scenarios
- Avoid academic tone and unnecessary theory
- Include 2-3 modules that feel like presentation slides/sections
- Include 8-10 quiz questions at the end
- Mix MCQ, true/false, multi-select, and 1-2 short-answer questions
- Make questions directly based on lesson content
- Include key takeaways

Return strict JSON in this shape:
{
  "course": {
    "short_description": "",
    "description": "",
    "learning_objectives": [""],
    "passing_score": 80
  },
  "modules": [
    {
      "title": "",
      "type": "lesson",
      "content": {
        "intro": "",
        "sections": [
          {
            "heading": "",
            "body": "",
            "bullets": [""],
            "example": ""
          }
        ],
        "case_scenarios": [
          {
            "title": "",
            "situation": "",
            "guidance": ""
          }
        ],
        "key_takeaways": [""]
      }
    }
  ],
  "questions": [
    {
      "type": "mcq|multi_select|true_false|short_answer|scenario_based",
      "prompt": "",
      "options": [{"value":"A","label":""}],
      "correct_answer": {},
      "rationale": "",
      "rubric": "",
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (Deno.env.get('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1') {
      return Response.json({ error: 'Course creation and video publishing have moved to the CareMetric Support Hub.', code: 'LEARNING_MOVED', hub_url: 'https://support-hub-web-production.up.railway.app/library' }, { status: 410 });
    }

    // Default limit=1: each course requires a full LLM generation (~15-30s),
    // so processing many courses in a single invocation would exceed the
    // platform's 120s execution timeout. The admin calls this repeatedly to
    // work through the backlog, or passes an explicit limit for small batches.
    const { limit = 1 } = await req.json();
    const courses = await base44.asServiceRole.entities.TrainingCourse.list('-updated_date', limit);
    const targets = courses.filter((course) => ['in_service', 'annual_mandatory'].includes(course.training_type));
    const results = [];

    for (const course of targets) {
     try {
      // Ask for JSON in-prompt and parse the text result. We avoid
      // response_json_schema because the provider's strict structured-output mode
      // rejects deeply-nested free-form objects (requires explicit `required` on
      // every nested object), which this rich lesson/quiz shape can't satisfy.
      let generated;
      try {
        // Default model is sufficient for generating structured training content
        // and avoids the 120s timeout that claude_opus_4_8 hits on the rich
        // lesson/quiz prompt. Saves credits too.
        const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You create practical healthcare in-service training. Return ONLY valid JSON, no prose or code fences.\n\n${buildPrompt(course)}`
        });
        generated = parseLLMJson(raw);
      } catch {
        generated = null;
      }
      // Guard the AI response BEFORE any destructive writes: a malformed/empty
      // response must skip this course, not delete its existing modules/questions
      // and leave a corrupted course behind.
      if (!generated || typeof generated !== 'object') {
        results.push({ course_id: course.id, title: course.title, error: 'AI returned invalid content; left unchanged' });
        continue;
      }

      const existingModules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id: course.id }, 'order_index', 100);
      const existingQuestions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id: course.id }, 'order_index', 200);

      // Create-then-swap: build ALL new modules/questions first, and only delete
      // the originals once every create has succeeded. If a create throws mid-way,
      // roll back the partially-created new rows and keep the original content —
      // the course is never left with deleted-but-not-recreated content.
      const createdModuleIds = [];
      const createdQuestionIds = [];
      try {
        for (const [index, module] of (generated.modules || []).entries()) {
          const createdModule = await base44.asServiceRole.entities.TrainingModule.create({
            course_id: course.id,
            title: module.title || `Module ${index + 1}`,
            type: module.type || 'lesson',
            category: course.category || 'compliance',
            content_json: module.content || {},
            order_index: index,
            estimated_minutes: Math.max(5, Math.floor((course.estimated_minutes || 30) / Math.max((generated.modules || []).length, 1))),
            is_required: true,
          });
          createdModuleIds.push(createdModule.id);
        }

        for (const [index, question] of (generated.questions || []).entries()) {
          const createdQuestion = await base44.asServiceRole.entities.TrainingQuestion.create({
            course_id: course.id,
            type: question.type || 'mcq',
            prompt: question.prompt || `Question ${index + 1}`,
            options_json: question.options || [],
            correct_answer_json: { answer: question.correct_answer },
            rationale: question.rationale || '',
            rubric: question.rubric || '',
            difficulty: question.difficulty || 'medium',
            order_index: index,
            points: 1,
            active: true,
          });
          createdQuestionIds.push(createdQuestion.id);
        }
      } catch (createErr) {
        // Roll back the new content so the original modules/questions remain the
        // course's only content, then surface the failure to the per-course catch.
        await Promise.all(createdModuleIds.map((id) => base44.asServiceRole.entities.TrainingModule.delete(id).catch(() => {})));
        await Promise.all(createdQuestionIds.map((id) => base44.asServiceRole.entities.TrainingQuestion.delete(id).catch(() => {})));
        throw createErr;
      }

      // All new content is durably written — now remove the originals and commit
      // the course metadata.
      await Promise.all(existingModules.map((item) => base44.asServiceRole.entities.TrainingModule.delete(item.id)));
      await Promise.all(existingQuestions.map((item) => base44.asServiceRole.entities.TrainingQuestion.delete(item.id)));

      await base44.asServiceRole.entities.TrainingCourse.update(course.id, {
        short_description: generated.course?.short_description || course.short_description,
        description: generated.course?.description || course.description,
        learning_objectives: generated.course?.learning_objectives || course.learning_objectives || [],
        passing_score: generated.course?.passing_score || course.passing_score || 80,
        ai_generated: true,
        needs_sme_review: true,
        include_case_scenarios: true,
        include_key_takeaways: true,
      });

      await base44.asServiceRole.entities.TrainingAuditLog.create({
        actor_id: user.email,
        actor_name: user.full_name,
        action: 'course_created',
        entity_type: 'TrainingCourse',
        entity_id: course.id,
        after_json: { rebuilt_with_ai: true, module_count: (generated.modules || []).length, question_count: (generated.questions || []).length },
        reason: 'rebuilt existing in-service with AI presentation-style content',
        severity: 'info'
      });

      results.push({ course_id: course.id, title: course.title, modules: (generated.modules || []).length, questions: (generated.questions || []).length });
     } catch (e) {
      // Isolate per-course failures so one bad course doesn't abort the batch.
      results.push({ course_id: course.id, title: course.title, error: e?.message || 'rebuild failed' });
     }
    }

    return Response.json({ success: true, rebuilt: results });
  } catch (error) {
    console.error('rebuildExistingInServices failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});