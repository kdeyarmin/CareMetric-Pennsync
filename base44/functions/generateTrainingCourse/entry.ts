import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// ─────────────────────────────────────────────────────────────────────────────
// Phased AI course generation.
//
// The original implementation ran the ENTIRE generation (outline LLM call +
// full-course LLM call + all entity writes) inside one synchronous HTTP
// invocation. With claude_opus_4_8 producing a whole multi-module course in a
// single response, total wall time routinely exceeded the platform's function
// execution window, so the platform killed the request and the client saw a
// bare 500 with nothing persisted.
//
// The function is now invoked once per PHASE, each phase making at most ONE
// bounded LLM call (the same budget as generateCourseQuiz, which fits the
// window comfortably). The frontend orchestrates the phases sequentially
// (src/functions/generateTrainingCourse.js):
//
//   1. phase 'outline'    — outline LLM call, creates the draft TrainingCourse
//                           (generation params + outline stored in ai_prompt_json
//                           so later phases need only course_id)
//   2. phase 'module'     — one LLM call per module (content for ONE module),
//                           upserts the TrainingModule at that order_index
//   3. phase 'assessment' — one LLM call for quiz + pre-assessment + brain
//                           sparks + references, grounded in the actual lesson
//                           content; replaces the course's TrainingQuestions
//   4. phase 'finalize'   — no LLM: audit log + optional HeyGen video kickoff
//
// Module/assessment writes are idempotent so a client retry of a failed phase
// cannot duplicate content.
// ─────────────────────────────────────────────────────────────────────────────

const LLM_MODEL = 'claude_opus_4_8';

// Shared prompt rule appended to every generation prompt so the published
// content never breaks the "human-authored" illusion. Update once, applies everywhere.
const NO_AI_MENTION_RULE = 'Never mention AI, this prompt, or that the content was generated.';

const isAdminUser = (user) =>
  user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

const normalizeCategory = (value) => {
  const allowed = ['compliance', 'clinical', 'safety', 'documentation', 'hospice', 'home_health', 'dme', 'onboarding', 'leadership'];
  return allowed.includes(value) ? value : 'compliance';
};

const normalizeBusinessLine = (value) => {
  if (value === 'home_health' || value === 'hospice') return value;
  return 'all';
};

// Tolerant JSON extractor: the model is asked (in-prompt) to return strict JSON
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

// We ask for JSON in-prompt and parse the text result rather than passing
// response_json_schema: the provider's strict structured-output mode rejects
// deeply-nested free-form objects (it requires an explicit `required` array on
// every nested object), which these rich shapes can't meet.
const invokeLLMJson = async (base44, systemRole, prompt) => {
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    model: LLM_MODEL,
    prompt: `${systemRole} Return ONLY valid JSON, no prose or code fences.\n\n${prompt}`,
  });
  return parseLLMJson(raw);
};

const ALLOWED_QUESTION_TYPES = ['mcq', 'true_false', 'multi_select', 'short_answer', 'scenario_based'];

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

const normalizeOptions = (rawOptions) =>
  (Array.isArray(rawOptions) ? rawOptions : [])
    .map((o, i) =>
      o && typeof o === 'object'
        ? { value: String(o.value ?? `o${i}`), label: String(o.label ?? o.value ?? '') }
        : { value: `o${i}`, label: String(o) }
    )
    .filter((o) => o.label);

// Normalize an LLM question into the exact persisted TrainingQuestion shape the
// course builder and gradeTrainingAttempt expect (mirrors generateCourseQuiz).
const normalizeQuestion = (q, index) => {
  const type = ALLOWED_QUESTION_TYPES.includes(q?.type) ? q.type : 'mcq';
  const base = {
    type,
    prompt: String(q?.prompt || `Question ${index + 1}`).trim(),
    rationale: String(q?.rationale || ''),
    rubric: String(q?.rubric || ''),
    difficulty: ['easy', 'medium', 'hard'].includes(q?.difficulty) ? q.difficulty : 'medium',
    points: type === 'short_answer' || type === 'scenario_based' ? 2 : 1,
    order_index: index,
  };

  if (type === 'mcq' || type === 'multi_select') {
    const options = normalizeOptions(q?.options);
    let answer;
    if (type === 'multi_select') {
      const list = Array.isArray(q?.correct_answer) ? q.correct_answer : q?.correct_answer != null ? [q.correct_answer] : [];
      answer = list.map((a) => matchOptionValue(options, a)).filter(Boolean);
    } else {
      answer = matchOptionValue(options, q?.correct_answer);
    }
    return { ...base, options_json: options, correct_answer_json: { answer } };
  }

  if (type === 'true_false') {
    const ca = q?.correct_answer;
    return { ...base, options_json: [], correct_answer_json: { answer: ca === true || ca === 'true' || ca === 'True' } };
  }

  // short_answer / scenario_based — AI graded against the rubric, no fixed answer.
  return { ...base, options_json: [], correct_answer_json: {} };
};

const normalizePreAssessment = (items) =>
  (Array.isArray(items) ? items : [])
    .map((q, i) => {
      const type = q?.type === 'true_false' ? 'true_false' : 'mcq';
      const options = type === 'mcq' ? normalizeOptions(q?.options) : [];
      const answer = type === 'true_false'
        ? q?.correct_answer === true || q?.correct_answer === 'true' || q?.correct_answer === 'True'
        : matchOptionValue(options, q?.correct_answer);
      return {
        type,
        prompt: String(q?.prompt || '').trim(),
        options,
        correct_answer: { answer },
        rationale: String(q?.rationale || ''),
        mapped_objective_index: Number.isInteger(q?.mapped_objective_index) ? q.mapped_objective_index : i,
        difficulty: ['easy', 'medium', 'hard'].includes(q?.difficulty) ? q.difficulty : 'medium',
      };
    })
    .filter((q) => q.prompt);

const BRAIN_SPARK_OFFSETS = [2, 4, 6, 30, 32, 34];

const normalizeBrainSparks = (items, moduleCount) =>
  (Array.isArray(items) ? items : [])
    .slice(0, BRAIN_SPARK_OFFSETS.length)
    .map((s, i) => {
      const options = normalizeOptions(s?.options);
      const rawIndex = Number.isInteger(s?.linked_module_index) ? s.linked_module_index : 0;
      return {
        prompt: String(s?.prompt || '').trim(),
        options,
        correct_answer: matchOptionValue(options, s?.correct_answer),
        rationale: String(s?.rationale || ''),
        // The spaced-recall schedule is fixed — don't trust an LLM-provided offset.
        day_offset: BRAIN_SPARK_OFFSETS[i],
        linked_module_index: Math.min(Math.max(rawIndex, 0), Math.max(moduleCount - 1, 0)),
      };
    })
    .filter((s) => s.prompt);

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

const loadCourseForGeneration = async (base44, course_id) => {
  if (!course_id) return { error: Response.json({ error: 'course_id is required' }, { status: 400 }) };
  const courseList = await base44.asServiceRole.entities.TrainingCourse.filter({ id: course_id }, undefined, 5000);
  const course = courseList[0];
  if (!course) return { error: Response.json({ error: 'Course not found' }, { status: 404 }) };
  const params = course.ai_prompt_json || {};
  if (!Array.isArray(params.outline_modules) || params.outline_modules.length === 0) {
    return { error: Response.json({ error: 'This course has no stored generation outline. Regenerate the course from the start.' }, { status: 409 }) };
  }
  return { course, params };
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — outline: one small LLM call, then create the draft course record.
// ─────────────────────────────────────────────────────────────────────────────
async function runOutlinePhase(base44, user, body) {
  const {
    topic,
    training_category = 'compliance',
    business_line = 'all',
    audience_roles = [],
    purpose_of_training = '',
    reading_level = 'plain professional',
    lesson_length = 30,
    question_count = 10,
    question_types = ['mcq', 'true_false', 'scenario_based'],
    include_case_scenarios = true,
    include_key_takeaways = true,
    include_policy_section = true,
    include_references = true,
    include_acknowledgement = true,
    include_competency = true,
    custom_instructions = '',
    state = '',
    policy_ids = [],
    status = 'draft',
    training_type = 'in_service',
    annual_cycle_year = null,
    skill_level = 'intermediate',
    num_modules = 0,
    passing_score = 80,
    enable_certificate = true,
    certificate_valid_months = null,
    generate_videos = false,
    video_avatar_id = '',
    video_voice_id = '',
  } = body;

  if (!topic) {
    return Response.json({ error: 'Topic is required' }, { status: 400 });
  }

  const audienceLabel = audience_roles.length > 0 ? audience_roles.join(', ') : 'all employees';
  const settingLabel = business_line === 'all' ? 'home health and hospice' : business_line;
  const moduleCount = Math.min(num_modules > 0 ? num_modules : lesson_length >= 60 ? 3 : lesson_length >= 40 ? 2 : 1, 6);

  const outlinePrompt = `You are a senior instructional designer specializing in healthcare workforce education. Design a course outline for the following training.

Topic: ${topic}
Category: ${training_category}
Business line: ${business_line}
Target audience: ${audienceLabel}
Skill level: ${skill_level}
Purpose: ${purpose_of_training || 'Ensure staff competency and regulatory compliance'}
${state ? `State-specific focus: ${state} — reflect that state's regulations where relevant.\n` : ''}Lesson duration: ${lesson_length} minutes across exactly ${moduleCount} module(s)
Assessment plan: ${question_count} questions using types: ${question_types.join(', ')}
${custom_instructions ? `Custom instructions: ${custom_instructions}\n` : ''}
Return JSON only:
{
  "title": "Clear, professional course title",
  "short_description": "1-2 sentence summary for catalog display",
  "description": "Comprehensive 3-4 sentence description including who should take this, what they will learn, and why it matters",
  "learning_objectives": ["4-6 measurable objectives using Bloom's action verbs — at least 2 at Apply level or higher"],
  "modules": [
    {
      "title": "Module title",
      "focus": "What this module specifically covers",
      "key_topics": ["topic1", "topic2"],
      "estimated_minutes": 15
    }
  ],
  "assessment_blueprint": [
    {
      "objective_index": 0,
      "bloom_level": "apply",
      "question_type": "scenario_based",
      "topic_focus": "What the question should test"
    }
  ],
  "prerequisite_knowledge": ["What learners should already know"],
  "real_world_relevance": "Why this training matters RIGHT NOW for this audience",
  "regulatory_crosswalk": [
    {
      "regulation": "Specific regulation code (e.g., 42 CFR 484.60, OSHA 1910.1030, HIPAA 164.502)",
      "title": "Plain-language name of the regulation",
      "how_this_course_addresses_it": "How this course satisfies or relates to this requirement"
    }
  ],
  "competency_skills": [
    {
      "skill": "Observable, measurable skill a supervisor could validate after completion",
      "validation_method": "return_demonstration|verbal_attestation|documentation_review|direct_observation",
      "criteria": "Specific criteria for demonstrating competency"
    }
  ],
  "certificate_wording": "One-sentence certificate text for this course",
  "attestation_text": "One-sentence attestation the learner signs after completing this course"
}

Design principles:
- Produce EXACTLY ${moduleCount} module(s); each must have a clear, distinct purpose — no overlap
- Scaffold from foundational knowledge to complex application
- Assessment blueprint must cover EVERY learning objective at least once
- ${include_policy_section ? `Include 2-4 regulatory_crosswalk entries mapping to CMS CoPs, OSHA, HIPAA, or state rules for ${settingLabel}` : 'Return an empty regulatory_crosswalk array'}
- ${include_competency ? 'Define 2-4 competency_skills a supervisor can validate' : 'Return an empty competency_skills array'}
- Make the "real_world_relevance" compelling — connect to actual incidents, regulatory changes, or common audit findings in ${settingLabel}
- NEVER include bracketed placeholders like [Agency Name] or [Date] — write generically ("your agency", "your supervisor") so the course is publishable as-is
- ${NO_AI_MENTION_RULE}`;

  let outline;
  try {
    outline = await invokeLLMJson(
      base44,
      "You are a senior healthcare instructional designer with expertise in ADDIE methodology, Bloom's Taxonomy, and CMS regulatory compliance for home health and hospice.",
      outlinePrompt
    );
  } catch {
    outline = null;
  }
  if (!outline || typeof outline !== 'object' || !Array.isArray(outline.modules) || outline.modules.length === 0) {
    return Response.json({ error: 'The AI could not produce a course outline. Please try again.' }, { status: 502 });
  }

  const outlineModules = outline.modules.slice(0, moduleCount).map((m, i) => ({
    title: String(m?.title || `Module ${i + 1}`),
    focus: String(m?.focus || topic),
    key_topics: Array.isArray(m?.key_topics) ? m.key_topics.map(String) : [topic],
    estimated_minutes: Number(m?.estimated_minutes) || Math.max(5, Math.floor(lesson_length / moduleCount)),
  }));

  const learningObjectives = (Array.isArray(outline.learning_objectives) ? outline.learning_objectives : []).map(String);
  const normalizedPassingScore = Math.max(1, Math.min(Number(passing_score) || 80, 100));
  const normalizedCertificateMonths =
    certificate_valid_months === null || certificate_valid_months === ''
      ? undefined
      : Math.max(1, Math.min(Number(certificate_valid_months) || 12, 120));

  const course = await base44.asServiceRole.entities.TrainingCourse.create({
    title: outline.title || topic,
    short_description: outline.short_description || '',
    description: outline.description || '',
    training_type,
    annual_cycle_year: annual_cycle_year || undefined,
    category: normalizeCategory(training_category),
    business_line_scope: normalizeBusinessLine(business_line),
    employee_audience: audience_roles.join(', '),
    purpose: purpose_of_training,
    reading_level,
    role_targets: audience_roles,
    estimated_minutes: Number(lesson_length) || 30,
    status: 'draft',
    created_by: user.email,
    learning_objectives: learningObjectives,
    passing_score: normalizedPassingScore,
    ai_generated: true,
    needs_sme_review: true,
    enable_certificate: enable_certificate !== false,
    certificate_valid_months: normalizedCertificateMonths,
    requires_attestation: include_acknowledgement,
    attestation_text: outline.attestation_text || 'I have reviewed and understand this training and agree to follow agency policy.',
    certificate_wording: outline.certificate_wording || 'This certifies successful completion of the assigned compliance in-service.',
    include_case_scenarios,
    include_key_takeaways,
    real_world_relevance: outline.real_world_relevance || '',
    regulatory_crosswalk_json: include_policy_section && Array.isArray(outline.regulatory_crosswalk) ? outline.regulatory_crosswalk : [],
    competency_skills_json: include_competency && Array.isArray(outline.competency_skills) ? outline.competency_skills : [],
    policy_references: Array.isArray(policy_ids) ? policy_ids : [],
    // Everything later phases need is stored here so they only receive course_id.
    ai_prompt_json: {
      topic,
      training_category,
      business_line,
      audience_roles,
      purpose_of_training,
      reading_level,
      lesson_length,
      question_count,
      question_types,
      include_case_scenarios,
      include_key_takeaways,
      include_policy_section,
      include_references,
      include_acknowledgement,
      include_competency,
      custom_instructions,
      state,
      policy_ids,
      skill_level,
      num_modules: moduleCount,
      passing_score: normalizedPassingScore,
      enable_certificate: enable_certificate !== false,
      certificate_valid_months: normalizedCertificateMonths ?? null,
      generate_videos: !!generate_videos,
      // Presenter choice is stored so an interrupted generation can be resumed
      // with the same avatar/voice the admin originally picked.
      video_avatar_id: String(video_avatar_id || ''),
      video_voice_id: String(video_voice_id || ''),
      requested_status: status,
      generation_method: 'phased',
      outline_title: outline.title || topic,
      outline_modules: outlineModules,
      learning_objectives: learningObjectives,
      assessment_blueprint: Array.isArray(outline.assessment_blueprint) ? outline.assessment_blueprint : [],
    },
    retake_settings_json: {
      passing_threshold: 80,
      unlimited_retakes: true,
      waiting_period_hours: 0,
      regenerate_test_on_retake: true,
    },
    test_settings_json: {
      randomize_questions: true,
      randomize_answers: true,
      show_correct_answers_after_completion: false,
    },
  });

  return Response.json({
    success: true,
    course_id: course.id,
    title: course.title,
    module_count: outlineModules.length,
    module_titles: outlineModules.map((m) => m.title),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — module: one LLM call generating content for ONE module.
// ─────────────────────────────────────────────────────────────────────────────
async function runModulePhase(base44, body) {
  const { course_id, module_index } = body;
  const loaded = await loadCourseForGeneration(base44, course_id);
  if (loaded.error) return loaded.error;
  const { course, params } = loaded;

  const index = Number(module_index);
  const outlineModules = params.outline_modules;
  if (!Number.isInteger(index) || index < 0 || index >= outlineModules.length) {
    return Response.json({ error: `module_index must be between 0 and ${outlineModules.length - 1}` }, { status: 400 });
  }
  const moduleOutline = outlineModules[index];
  const audienceLabel = (params.audience_roles || []).length > 0 ? params.audience_roles.join(', ') : 'all employees';
  const settingLabel = params.business_line === 'all' || !params.business_line ? 'home health and hospice' : params.business_line;

  const modulePrompt = `You are writing ONE module of the healthcare training course "${course.title}".

COURSE CONTEXT:
- Learning objectives: ${JSON.stringify(params.learning_objectives || [])}
- All modules in order: ${JSON.stringify(outlineModules.map((m) => m.title))}
- You are writing module ${index + 1} of ${outlineModules.length}: "${moduleOutline.title}"
- This module's focus: ${moduleOutline.focus}
- Key topics to cover: ${JSON.stringify(moduleOutline.key_topics)}
- Target audience: ${audienceLabel} in ${settingLabel} settings
- Skill level: ${params.skill_level || 'intermediate'} · Reading level: ${params.reading_level || 'plain professional'} (8th-10th grade)
- Estimated time: ${moduleOutline.estimated_minutes} minutes
${params.state ? `- State-specific focus: ${params.state}\n` : ''}${params.custom_instructions ? `- Custom instructions: ${params.custom_instructions}\n` : ''}
Return JSON only — the content object for this single module:
{
  "title": "${moduleOutline.title}",
  "content": {
    "intro": "A compelling opening hook — a brief real-world scenario, startling statistic, or question that makes the reader think. Connect to their daily work immediately.",
    "sections": [
      {
        "heading": "Clear, descriptive heading",
        "body": "Core teaching content — concise paragraphs explaining the concept. Every paragraph must answer: what should staff DO with this information?",
        "bullets": ["Action-oriented bullet points for key facts, steps, or requirements"],
        "example": "A specific, realistic workplace example with a named individual: 'Maria, a home health aide visiting an 82-year-old patient with diabetes...'",
        "pro_tip": "An insider tip from experienced practitioners (omit if forced)",
        "warning": "A critical safety or compliance warning (omit if not relevant)",
        "steps": ["Step-by-step procedure if this section teaches a process (omit if not applicable)"],
        "do_dont": { "do": ["Correct practices"], "dont": ["Common mistakes to avoid"] },
        "mnemonic": "A memory aid if genuinely helpful (omit if forced)",
        "regulation_ref": "Specific regulation citation if this section relates to one, e.g. 'CMS CoP §484.60(a)' (omit if not applicable)"
      }
    ],
    "case_scenarios": [
      {
        "title": "Scenario title",
        "patient_context": "Patient background — age, diagnosis, relevant history (or workplace context for admin topics)",
        "situation": "What is happening, what the employee observes, what decision they face",
        "challenge": "The specific question or decision point — a genuine dilemma, not an obvious choice",
        "guidance": "The correct approach and WHY, referencing specific policies or best practices",
        "what_could_go_wrong": "Concrete consequences of the wrong approach (denied claims, patient harm, survey deficiencies)",
        "discussion_questions": ["Questions that push higher-order thinking"]
      }
    ],
    "key_takeaways": ["3-5 actionable, memorable takeaways staff can immediately apply"],
    "check_your_understanding": ["2-3 quick self-check questions (not graded)"],
    "clinical_pearl": "One memorable insight experienced practitioners wish they had learned earlier (omit if not applicable)",
    "summary": "2-3 sentence recap — what to remember above all else",
    "video_narration": "A 250-450 word presenter script for this module's video, written for the EAR, to be read aloud VERBATIM by an on-camera presenter. Warm, conversational, short sentences, plain words. Open with the hook, walk through each section's core message with smooth spoken transitions, and close by reinforcing the key takeaways. No citations, no bullets, no markdown, no stage directions, no headings."
  }
}

CONTENT RULES:
- Write 3-5 sections. Each is a self-contained micro-segment completable in 3-5 minutes covering ONE concept.
- ${params.include_case_scenarios === false ? 'Return an empty case_scenarios array.' : 'Include 1-2 case scenarios.'}
- ${params.include_key_takeaways === false ? 'Return an empty key_takeaways array.' : 'Include 3-5 key takeaways.'}
- Do NOT repeat material covered by the other modules listed above — stay on this module's focus.
- Use "you" and "your", active voice, concrete language. When citing regulations, explain them in plain language.
- Every section must pass the "So what?" test — the learner should understand why this matters to THEM.
- NEVER include bracketed placeholders like [Agency Name] or [Policy #] — write generically ("your agency's policy") so the lesson is publishable as-is.
- ${NO_AI_MENTION_RULE}
- The video_narration is a standalone spoken script — someone hearing ONLY it (without the on-screen text) should still get the module's core message.`;

  let generated;
  try {
    generated = await invokeLLMJson(
      base44,
      'You are an award-winning healthcare education designer known for creating courses that are simultaneously rigorous, engaging, and immediately practical. You combine clinical accuracy with compelling storytelling, with deep expertise in CMS Conditions of Participation, OSHA standards, and state healthcare regulations.',
      modulePrompt
    );
  } catch {
    generated = null;
  }
  if (!generated || typeof generated !== 'object' || !generated.content) {
    return Response.json({ error: `The AI could not generate content for module ${index + 1}. Please try again.` }, { status: 502 });
  }

  const moduleRecord = {
    course_id,
    title: generated.title || moduleOutline.title,
    type: 'lesson',
    content_json: generated.content,
    order_index: index,
    estimated_minutes: moduleOutline.estimated_minutes,
    is_required: true,
  };

  // Upsert on (course_id, order_index) so a client retry can't duplicate a module.
  const existing = await base44.asServiceRole.entities.TrainingModule.filter({ course_id, order_index: index }, undefined, 5000);
  if (existing[0]) {
    await base44.asServiceRole.entities.TrainingModule.update(existing[0].id, moduleRecord);
  } else {
    await base44.asServiceRole.entities.TrainingModule.create(moduleRecord);
  }

  return Response.json({ success: true, module_index: index, title: moduleRecord.title });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — assessment: one LLM call for quiz + pre-assessment + brain sparks,
// grounded in the module content actually generated (not just the outline).
// ─────────────────────────────────────────────────────────────────────────────
async function runAssessmentPhase(base44, body) {
  const { course_id } = body;
  const loaded = await loadCourseForGeneration(base44, course_id);
  if (loaded.error) return loaded.error;
  const { course, params } = loaded;

  const modules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id }, 'order_index', 100);
  const lessonContext = buildLessonContext(modules).trim();
  if (!lessonContext) {
    return Response.json({ error: 'No module content found for this course. Generate the modules first.' }, { status: 409 });
  }

  const questionCount = Math.max(1, Math.min(Number(params.question_count) || 10, 30));
  const preAssessmentCount = Math.max(3, Math.round(questionCount * 0.4));
  // Only ask the LLM for types normalizeQuestion can persist correctly — an
  // unsupported requested type (e.g. 'matching') would otherwise come back and
  // be coerced into a broken mcq.
  const requestedTypes = Array.isArray(params.question_types) ? params.question_types.filter((t) => ALLOWED_QUESTION_TYPES.includes(t)) : [];
  const questionTypes = requestedTypes.length ? requestedTypes : ['mcq', 'true_false', 'scenario_based'];

  const assessmentPrompt = `You are writing the complete assessment package for the healthcare training course "${course.title}". Ground every item ONLY in the lesson content below — do not introduce facts the lessons don't cover.

LEARNING OBJECTIVES:
${JSON.stringify(params.learning_objectives || [])}

ASSESSMENT BLUEPRINT (follow it where possible):
${JSON.stringify(params.assessment_blueprint || [])}

LESSON CONTENT:
${lessonContext}

Return JSON only:
{
  "questions": [
    {
      "type": "mcq|multi_select|true_false|short_answer|scenario_based",
      "prompt": "Clear, unambiguous question stem. For scenario_based: include a detailed 3-5 sentence clinical/workplace vignette first.",
      "options": [{ "value": "a", "label": "Option text" }],
      "correct_answer": "a",
      "rationale": "MUST explain: (1) why the correct answer is right, (2) why each wrong answer is wrong, (3) the real-world consequence of choosing incorrectly",
      "rubric": "For short_answer/scenario_based: criteria for full credit, partial credit, and zero credit",
      "difficulty": "easy|medium|hard"
    }
  ],
  "pre_assessment": [
    {
      "type": "mcq|true_false",
      "prompt": "A screening question testing baseline knowledge of a core learning objective",
      "options": [{ "value": "a", "label": "Option text" }],
      "correct_answer": "a",
      "rationale": "Brief explanation",
      "mapped_objective_index": 0,
      "difficulty": "medium"
    }
  ],
  "brain_sparks": [
    {
      "prompt": "A concise multiple-choice retention question sent AFTER completion, focused on the most safety-critical or commonly forgotten concept from its module",
      "options": [{ "value": "a", "label": "Option text" }],
      "correct_answer": "a",
      "rationale": "Why this is correct and why remembering it matters",
      "day_offset": 2,
      "linked_module_index": 0
    }
  ],
  "references": [{ "title": "Source title", "url": "", "note": "How this source relates to the training content" }]
}

REQUIREMENTS:
- Generate exactly ${questionCount} questions using only these types: ${questionTypes.join(', ')}.
- mcq/multi_select need 3-5 options; correct_answer is the option value (array of values for multi_select); true/false for true_false; omit for short_answer/scenario_based.
- Spread difficulty roughly 30% easy / 40% medium / 30% hard; at least ${Math.max(2, Math.round(questionCount * 0.3))} questions at Apply/Analyze/Evaluate level.
- MCQ distractors must be plausible — each wrong answer should represent a real mistake someone might make.
- Generate exactly ${preAssessmentCount} pre_assessment questions (mcq/true_false only), each mapped to a learning objective.
- Generate exactly 6 brain_sparks (mcq only) with day_offset values 2, 4, 6, 30, 32, 34, each linked to the module (0-based index) it reinforces.
- ${params.include_references === false ? 'Return an empty references array.' : 'Include 2-4 authoritative references (CMS, OSHA, CDC, professional associations).'}
- NEVER include bracketed placeholders like [Agency Name]; ${NO_AI_MENTION_RULE}`;

  let generated;
  try {
    generated = await invokeLLMJson(
      base44,
      'You write rigorous, fair healthcare training assessments grounded strictly in the provided material.',
      assessmentPrompt
    );
  } catch {
    generated = null;
  }
  const rawQuestions = Array.isArray(generated?.questions) ? generated.questions : [];
  if (rawQuestions.length === 0) {
    return Response.json({ error: 'The AI could not generate assessment questions. Please try again.' }, { status: 502 });
  }

  // Replace-all so a client retry can't duplicate questions. Paginate the
  // deletes (bounded so a persistently-failing delete can't loop forever) in
  // case a course has accumulated more than one fetch page of questions.
  for (let pass = 0; pass < 10; pass++) {
    const existingQuestions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id }, 'order_index', 200);
    if (existingQuestions.length === 0) break;
    for (const q of existingQuestions) {
      await base44.asServiceRole.entities.TrainingQuestion.delete(q.id);
    }
  }
  const questions = rawQuestions.slice(0, questionCount).map(normalizeQuestion);
  for (const q of questions) {
    await base44.asServiceRole.entities.TrainingQuestion.create({ ...q, course_id });
  }

  await base44.asServiceRole.entities.TrainingCourse.update(course_id, {
    pre_assessment_json: normalizePreAssessment(generated?.pre_assessment),
    brain_sparks_json: normalizeBrainSparks(generated?.brain_sparks, modules.length),
    references_json: Array.isArray(generated?.references) ? generated.references : [],
  });

  return Response.json({ success: true, questions_created: questions.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — finalize: audit log + optional HeyGen video kickoff. No LLM call.
// ─────────────────────────────────────────────────────────────────────────────
async function runFinalizePhase(base44, user, body, req) {
  const { course_id, generate_videos = false, video_avatar_id = '', video_voice_id = '' } = body;
  const loaded = await loadCourseForGeneration(base44, course_id);
  if (loaded.error) return loaded.error;
  const { course, params } = loaded;

  const modules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id }, 'order_index', 100);
  const questions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id }, 'order_index', 200);

  // Finalize must be retry-safe: don't write a second 'course_created' audit
  // entry when a client retries after an ambiguous failure.
  const existingLogs = await base44.asServiceRole.entities.TrainingAuditLog.filter({ entity_id: course_id, action: 'course_created' }, undefined, 5000);
  if (existingLogs.length === 0) {
    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'course_created',
      entity_type: 'TrainingCourse',
      entity_id: course_id,
      after_json: {
        title: course.title,
        training_type: course.training_type,
        annual_cycle_year: course.annual_cycle_year || null,
        status: course.status,
        ai_generated: true,
        generation_method: 'phased',
        outline_modules: params.outline_modules.length,
        modules_generated: modules.length,
        questions_generated: questions.length,
      },
      severity: 'info',
    });
  }

  let video_generation_status = 'skipped';
  if (generate_videos) {
    try {
      const HEYGEN_API_KEY = Deno.env.get('HEYGEN_API_KEY') || '';
      if (!HEYGEN_API_KEY) {
        video_generation_status = 'skipped_no_api_key';
      } else if (modules.some((m) => m.video_status === 'processing' || m.video_url)) {
        // A retry of finalize must not re-kick HeyGen: manageTrainingVideos
        // 'start' targets every non-completed module, so re-invoking it while
        // jobs are processing would create duplicate jobs (and burn credits).
        video_generation_status = 'generating';
      } else {
        // Kick off video generation via manageTrainingVideos (action: 'start').
        // That path is non-blocking: it CREATES the HeyGen jobs, stamps each
        // module video_status='processing' + video_job_id, and returns — the
        // jobs then finalize asynchronously (Video Studio polling +
        // syncTrainingVideoStatuses). We AWAIT here so the jobs are reliably
        // created before this request ends (a detached fire-and-forget could
        // be killed before HeyGen is ever called); we do NOT wait for renders.
        const videoFnUrl = new URL(req.url);
        videoFnUrl.pathname = videoFnUrl.pathname.replace('generateTrainingCourse', 'manageTrainingVideos');

        const videoReq = new Request(videoFnUrl.toString(), {
          method: 'POST',
          headers: req.headers,
          body: JSON.stringify({
            action: 'start',
            course_id,
            avatar_id: video_avatar_id || undefined,
            voice_id: video_voice_id || undefined,
          }),
        });

        // Treat a non-2xx response, non-JSON body, or an { error } payload as a
        // failure instead of silently reporting 'generating'.
        const videoResult = await fetch(videoReq)
          .then(async (r) => (r.ok ? await r.json().catch(() => null) : null))
          .catch(() => null);
        video_generation_status = videoResult && !videoResult.error ? 'generating' : 'error';
      }
    } catch {
      video_generation_status = 'error';
    }
  }

  return Response.json({
    success: true,
    course_id,
    title: course.title,
    status: course.status,
    needs_sme_review: true,
    modules_generated: modules.length,
    questions_generated: questions.length,
    video_generation_status,
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized - admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const phase = body?.phase;

    if (phase === 'outline') return await runOutlinePhase(base44, user, body);
    if (phase === 'module') return await runModulePhase(base44, body);
    if (phase === 'assessment') return await runAssessmentPhase(base44, body);
    if (phase === 'finalize') return await runFinalizePhase(base44, user, body, req);

    // Callers without a phase are running the retired single-shot protocol
    // (which exceeded the platform's execution window — the original 500 bug).
    return Response.json(
      { error: 'This app version is out of date. Refresh your browser and try generating the course again.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('generateTrainingCourse failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
