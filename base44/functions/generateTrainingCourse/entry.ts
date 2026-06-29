import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    const isAdmin = user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized - admin access required' }, { status: 403 });
    }

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
      custom_instructions = '',
      status = 'draft',
      training_type = 'in_service',
      annual_cycle_year = null,
      skill_level = 'intermediate',
      num_modules = 0,
      generate_videos = false,
      video_avatar_id = '',
      video_voice_id = '',
    } = await req.json();

    if (!topic) {
      return Response.json({ error: 'Topic is required' }, { status: 400 });
    }

    const audienceLabel = audience_roles.length > 0 ? audience_roles.join(', ') : 'all employees';
    const questionTypeLabel = question_types.join(', ');
    const moduleCount = num_modules > 0 ? num_modules : (lesson_length >= 60 ? 3 : lesson_length >= 40 ? 2 : 1);

    // ──────────────────────────────────────────────────────
    // PHASE 1: Generate course outline for structural quality
    // ──────────────────────────────────────────────────────
    const outlinePrompt = `You are a senior instructional designer specializing in healthcare workforce education. Design a course outline for the following training.

Topic: ${topic}
Category: ${training_category}
Business line: ${business_line}
Target audience: ${audienceLabel}
Skill level: ${skill_level}
Purpose: ${purpose_of_training || 'Ensure staff competency and regulatory compliance'}
Lesson duration: ${lesson_length} minutes across ${moduleCount} module(s)
Question count: ${question_count} assessment questions

Return JSON only:
{
  "title": "Clear, professional course title",
  "short_description": "1-2 sentence summary for catalog display",
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
  "real_world_relevance": "Why this training matters RIGHT NOW for this audience"
}

Design principles:
- Each module should have a clear, distinct purpose — no overlap
- Scaffold from foundational knowledge to complex application
- Assessment blueprint must cover EVERY learning objective at least once
- Distribute question types: ${questionTypeLabel}
- Distribute difficulty: 30% easy, 40% medium, 30% hard
- Make the "real_world_relevance" compelling — connect to actual incidents, regulatory changes, or common audit findings in ${business_line === 'all' ? 'home health and hospice' : business_line}`;

    // Route AI generation through Base44's InvokeLLM (handles auth + model
    // resolution). We ask for JSON in-prompt and parse the text result rather
    // than passing response_json_schema: the provider's strict structured-output
    // mode rejects deeply-nested free-form objects (it requires an explicit
    // `required` array on every nested object), which this rich shape can't meet.
    let outline;
    try {
      const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "claude_opus_4_8",
        prompt: `You are a senior healthcare instructional designer with expertise in ADDIE methodology, Bloom's Taxonomy, and CMS regulatory compliance for home health and hospice. Return ONLY valid JSON, no prose or code fences.\n\n${outlinePrompt}`
      });
      outline = parseLLMJson(raw);
    } catch {
      outline = null;
    }
    if (!outline || typeof outline !== 'object') {
      outline = { title: topic, learning_objectives: [], modules: [{ title: topic, focus: topic, key_topics: [topic], estimated_minutes: lesson_length }], assessment_blueprint: [] };
    }

    // ──────────────────────────────────────────────────────
    // PHASE 2: Generate full course content using outline
    // ──────────────────────────────────────────────────────
    const contentPrompt = `You are building a complete healthcare training course. Use the approved outline below to generate rich, engaging content.

APPROVED OUTLINE:
${JSON.stringify(outline, null, 2)}

PARAMETERS:
- Skill level: ${skill_level}
- Reading level: ${reading_level}
- Include case scenarios: ${include_case_scenarios}
- Include key takeaways: ${include_key_takeaways}
- Include policy/regulatory content: ${include_policy_section}
- Include references: ${include_references}
- Include acknowledgement: ${include_acknowledgement}
- Assessment question count: ${question_count}
- Question types: ${questionTypeLabel}
- Custom instructions: ${custom_instructions || 'none'}

Generate the complete course as strict JSON with this EXACT structure.
This follows a Relias-style learning model: pre-assessment to identify gaps, focused micro-segments, inline knowledge checks, regulatory crosswalks, post-assessment, and spaced retention questions.

{
  "course": {
    "title": "${outline.title || topic}",
    "short_description": "${outline.short_description || ''}",
    "description": "Comprehensive 3-4 sentence description including who should take this, what they will learn, and why it matters",
    "learning_objectives": ${JSON.stringify(outline.learning_objectives || [])},
    "recommended_passing_score": 80,
    "certificate_wording": "This certifies that the above-named employee has successfully completed [course title] and demonstrated competency in the covered material.",
    "attestation_text": "I confirm that I have carefully reviewed all course materials, understand the content presented, and commit to applying these practices in my daily work.",
    "warnings": ["This course was generated with AI assistance and should be reviewed by a subject matter expert before publishing."],
    "prerequisite_knowledge": ${JSON.stringify(outline.prerequisite_knowledge || [])},
    "real_world_relevance": "${outline.real_world_relevance || ''}",
    "regulatory_crosswalk": [
      {
        "regulation": "The specific regulation code (e.g., 42 CFR 484.60, OSHA 1910.1030, HIPAA 164.502)",
        "title": "Plain-language name of the regulation",
        "how_this_course_addresses_it": "Brief explanation of how this course satisfies or relates to this requirement"
      }
    ],
    "competency_skills": [
      {
        "skill": "Observable, measurable skill that a supervisor could validate after course completion",
        "validation_method": "return_demonstration|verbal_attestation|documentation_review|direct_observation",
        "criteria": "Specific criteria for demonstrating competency in this skill"
      }
    ]
  },
  "pre_assessment": [
    {
      "type": "mcq|true_false",
      "prompt": "A screening question testing baseline knowledge of this topic. If the learner can answer all pre-assessment questions correctly, they may already have competency.",
      "options": [{"value":"A","label":"Option text"}],
      "correct_answer": {},
      "mapped_objective_index": 0,
      "difficulty": "medium"
    }
  ],
  "modules": [
    {
      "title": "Module title from outline",
      "type": "lesson",
      "estimated_minutes": 10,
      "content": {
        "intro": "A compelling opening hook — start with a brief real-world scenario, a startling statistic, or a question that makes the reader think. Connect to their daily work immediately.",
        "sections": [
          {
            "heading": "Clear, descriptive heading",
            "body": "Core teaching content — concise paragraphs explaining the concept. Every paragraph must answer: what should staff DO with this information?",
            "bullets": ["Action-oriented bullet points for key facts, steps, or requirements"],
            "example": "A specific, realistic workplace example showing this concept in practice. Use a named individual: 'Maria, a home health aide visiting a 82-year-old patient with diabetes...'",
            "pro_tip": "An insider tip from experienced practitioners — something you'd tell a colleague, not write in a policy manual",
            "warning": "A critical safety or compliance warning if applicable (omit if not relevant to this section)",
            "steps": ["Step-by-step procedure if this section involves a process (omit if not applicable)"],
            "do_dont": {
              "do": ["Correct practices"],
              "dont": ["Common mistakes to avoid"]
            },
            "mnemonic": "A memory aid if helpful for this concept (omit if forced)",
            "regulation_ref": "If this section relates to a specific regulation, cite it here (e.g., 'CMS CoP §484.60(a)') — omit if not applicable"
          }
        ],
        "case_scenarios": [
          {
            "title": "Scenario title",
            "patient_context": "Brief patient background — age, diagnosis, relevant history (for clinical topics) or workplace context (for admin topics)",
            "situation": "Detailed situation description — what is happening, what the employee observes, what decision they face",
            "challenge": "The specific question or decision point the learner must consider",
            "guidance": "The correct approach with explanation of WHY, referencing specific policies or best practices",
            "what_could_go_wrong": "Consequences of the wrong approach — make it concrete and relatable",
            "discussion_questions": ["Thought-provoking questions that extend learning beyond the scenario"]
          }
        ],
        "key_takeaways": ["Actionable, memorable takeaways — each should be something staff can immediately apply"],
        "check_your_understanding": ["Quick self-check questions (not graded) that help learners verify their comprehension before moving on"],
        "clinical_pearl": "One memorable clinical or compliance insight that experienced practitioners wish they had learned earlier (optional — omit if not applicable)",
        "summary": "2-3 sentence recap of the module's most important points — what to remember above all else"
      }
    }
  ],
  "questions": [
    {
      "type": "mcq|multi_select|true_false|short_answer|matching|scenario_based",
      "prompt": "Clear, unambiguous question stem. For scenario-based: include a detailed clinical/workplace situation first.",
      "options": [{"value":"A","label":"Option text"}],
      "correct_answer": {},
      "rationale": "MUST explain: (1) why the correct answer is right, (2) why each wrong answer is wrong, (3) the real-world consequence of choosing incorrectly",
      "rubric": "For short_answer/scenario_based: specific criteria for full credit (3 points), partial credit (1-2 points), and zero credit",
      "difficulty": "easy|medium|hard",
      "bloom_level": "remember|understand|apply|analyze|evaluate",
      "mapped_objective_index": 0,
      "clinical_context": "Brief context connecting this question to real practice (shown after answering)"
    }
  ],
  "brain_sparks": [
    {
      "prompt": "A concise multiple-choice retention question sent AFTER course completion to reinforce key knowledge. Focus on the most critical, safety-relevant, or commonly forgotten concept from the course.",
      "options": [{"value":"A","label":"Option text"}],
      "correct_answer": "A",
      "rationale": "Brief explanation of why this is correct and why remembering it matters",
      "day_offset": 2,
      "linked_module_index": 0
    }
  ],
  "references": [
    {"title":"Source title","url":"","note":"How this source relates to the training content"}
  ]
}

RELIAS-STYLE COURSE DESIGN PRINCIPLES:

A. PRE-ASSESSMENT (test-out capability):
   - Generate ${Math.max(3, Math.round(question_count * 0.4))} pre-assessment questions covering the core learning objectives
   - Use only MCQ and true/false for pre-assessment (quick to complete)
   - Each question maps to a learning objective so the system can identify which modules to skip
   - If a learner scores 100% on pre-assessment, they can test out of the content and proceed directly to the post-test

B. MICROLEARNING SEGMENTS:
   - Each section should be a self-contained micro-segment completable in 3-5 minutes
   - Include a clear "estimated_minutes" per module
   - Break complex topics into bite-sized chunks — each section covers ONE concept
   - Staff should be able to pause after any section and resume later without losing context

C. REGULATORY CROSSWALK:
   - Map the course to specific CMS Conditions of Participation, OSHA standards, HIPAA requirements, or state regulations as applicable
   - Include the regulation code AND a plain-language explanation
   - The "regulation_ref" field in sections links specific content to specific regulations

D. COMPETENCY SKILLS:
   - Define 2-4 observable, measurable skills that a supervisor can validate after course completion
   - Each skill needs a validation method (direct observation, documentation review, verbal attestation, or return demonstration)
   - Skills should be specific enough that a supervisor knows exactly what to look for

E. BRAIN SPARKS (spaced retention):
   - Generate 6 retention questions to be delivered post-course at spaced intervals
   - Schedule: days 2, 4, 6 (first batch) and days 30, 32, 34 (second batch) — use day_offset field
   - Each BrainSpark focuses on the single most important concept from its linked module
   - Questions should be quick (MCQ only) and focused on safety-critical or commonly forgotten material
   - Include a brief rationale that reinforces the key concept

CONTENT CREATION RULES:

1. SECTIONS — Make every section rich and multi-dimensional:
   - "body": Core teaching content. Write as if explaining to a competent colleague who is new to this specific topic. Be concrete, not abstract.
   - "bullets": Reserve for lists of requirements, steps, or facts that benefit from scannable format.
   - "example": ALWAYS include a specific, named example. Not "a patient" but "Mrs. Johnson, a 78-year-old with CHF who lives alone." Make examples feel real.
   - "pro_tip": Include when you have genuine practical wisdom to share. These should feel like advice from a mentor.
   - "warning": Include ONLY for genuine safety/compliance risks. When included, be specific about what can go wrong.
   - "steps": Include when the section teaches a procedure or process. Number each step clearly.
   - "do_dont": Include when there are common mistakes worth contrasting. Keep to 2-4 items per side.
   - "mnemonic": Include only when genuinely helpful for recall. Don't force mnemonics.

2. CASE SCENARIOS — These are the most valuable learning tool:
   - Include "patient_context" with enough detail to feel like a real clinical encounter
   - The "challenge" should present a genuine dilemma, not an obvious choice
   - "what_could_go_wrong" should be specific and sobering — connect to real consequences (denied claims, patient harm, survey deficiencies)
   - "discussion_questions" should push higher-order thinking: "What would you do differently if..." or "How would this change if the patient also had..."

3. ASSESSMENT — Quality over quantity:
   - Scenario-based questions should present complete clinical vignettes (3-5 sentences of context)
   - MCQ distractors must be plausible — each wrong answer should represent a real mistake someone might make
   - "clinical_context" after each question connects the assessment back to why this matters in practice
   - Short answer rubrics must be specific: "Full credit requires mentioning X, Y, and Z. Partial credit if..."
   - At least ${Math.max(2, Math.round(question_count * 0.3))} questions should be at Apply/Analyze/Evaluate level

4. WRITING QUALITY:
   - Write for ${audienceLabel} in ${business_line === 'all' ? 'home health and hospice' : business_line} settings
   - Reading level: ${reading_level} (8th-10th grade)
   - Use "you" and "your" to address the learner directly
   - Prefer active voice and concrete language
   - When referencing regulations, explain what they mean in plain language
   - Avoid: jargon without definition, passive constructions, filler phrases, academic tone
   - Every section must pass the "So what?" test — the learner should understand why this matters to THEM`;

    let generated;
    try {
      const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "claude_opus_4_8",
        prompt: `You are an award-winning healthcare education designer known for creating courses that are simultaneously rigorous, engaging, and immediately practical. You combine clinical accuracy with compelling storytelling. You have deep expertise in CMS Conditions of Participation, OSHA standards, and state healthcare regulations. Return ONLY valid JSON, no prose or code fences.\n\n${contentPrompt}`
      });
      generated = parseLLMJson(raw);
    } catch {
      generated = null;
    }
    if (!generated || typeof generated !== 'object') {
      generated = {};
    }

    const course = await base44.asServiceRole.entities.TrainingCourse.create({
      title: generated.course?.title || outline.title || topic,
      short_description: generated.course?.short_description || outline.short_description || '',
      description: generated.course?.description || '',
      training_type,
      annual_cycle_year: annual_cycle_year || undefined,
      category: normalizeCategory(training_category),
      business_line_scope: normalizeBusinessLine(business_line),
      employee_audience: audience_roles.join(', '),
      purpose: purpose_of_training,
      reading_level,
      role_targets: audience_roles,
      estimated_minutes: Number(lesson_length) || 30,
      status,
      created_by: user.email,
      learning_objectives: generated.course?.learning_objectives || outline.learning_objectives || [],
      passing_score: generated.course?.recommended_passing_score || 80,
      ai_generated: true,
      needs_sme_review: true,
      enable_certificate: true,
      requires_attestation: include_acknowledgement,
      attestation_text: generated.course?.attestation_text || 'I have reviewed and understand this training and agree to follow agency policy.',
      certificate_wording: generated.course?.certificate_wording || 'This certifies successful completion of the assigned compliance in-service.',
      include_case_scenarios,
      include_key_takeaways,
      references_json: generated.references || [],
      pre_assessment_json: generated.pre_assessment || [],
      brain_sparks_json: generated.brain_sparks || [],
      competency_skills_json: generated.course?.competency_skills || [],
      regulatory_crosswalk_json: generated.course?.regulatory_crosswalk || [],
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
        custom_instructions,
        skill_level,
        num_modules: moduleCount,
        generation_method: 'two_pass',
      },
      retake_settings_json: {
        passing_threshold: generated.course?.recommended_passing_score || 80,
        unlimited_retakes: true,
        waiting_period_hours: 0,
        regenerate_test_on_retake: true
      },
      test_settings_json: {
        randomize_questions: true,
        randomize_answers: true,
        show_correct_answers_after_completion: false
      }
    });

    for (const [index, module] of (generated.modules || []).entries()) {
      await base44.asServiceRole.entities.TrainingModule.create({
        course_id: course.id,
        title: module.title || `Module ${index + 1}`,
        type: module.type || 'lesson',
        content_json: module.content || {},
        order_index: index,
        estimated_minutes: Math.max(5, Math.floor((Number(lesson_length) || 30) / Math.max((generated.modules || []).length, 1))),
        is_required: true
      });
    }

    for (const [index, question] of (generated.questions || []).entries()) {
      await base44.asServiceRole.entities.TrainingQuestion.create({
        course_id: course.id,
        type: question.type || 'mcq',
        prompt: question.prompt || `Question ${index + 1}`,
        options_json: question.options || [],
        correct_answer_json: { answer: question.correct_answer },
        rationale: question.rationale || '',
        rubric: question.rubric || '',
        difficulty: question.difficulty || 'medium',
        order_index: index,
        points: question.type === 'scenario_based' || question.type === 'short_answer' ? 2 : 1
      });
    }

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'course_created',
      entity_type: 'TrainingCourse',
      entity_id: course.id,
      after_json: {
        title: course.title,
        training_type,
        annual_cycle_year: annual_cycle_year || null,
        status: course.status,
        ai_generated: true,
        generation_method: 'two_pass',
        outline_modules: outline.modules?.length || 0,
        questions_generated: (generated.questions || []).length
      },
      severity: 'info'
    });

    // ──────────────────────────────────────────────────────
    // PHASE 3 (optional): Generate presenter videos via HeyGen
    // ──────────────────────────────────────────────────────
    let video_generation_status = 'skipped';
    if (generate_videos) {
      try {
        const HEYGEN_API_KEY = Deno.env.get('HEYGEN_API_KEY') || '';
        if (!HEYGEN_API_KEY) {
          video_generation_status = 'skipped_no_api_key';
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
              course_id: course.id,
              avatar_id: video_avatar_id || undefined,
              voice_id: video_voice_id || undefined,
            }),
          });

          // Treat a non-2xx response, non-JSON body, or an { error } payload as a
          // failure instead of silently reporting 'generating'.
          const videoResult = await fetch(videoReq)
            .then(async (r) => (r.ok ? await r.json().catch(() => null) : null))
            .catch(() => null);
          video_generation_status = (videoResult && !videoResult.error) ? 'generating' : 'error';
        }
      } catch {
        video_generation_status = 'error';
      }
    }

    return Response.json({ success: true, course_id: course.id, title: course.title, status: course.status, video_generation_status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});