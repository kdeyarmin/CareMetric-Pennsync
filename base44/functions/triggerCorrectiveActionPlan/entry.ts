import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const normalizeTag = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60);

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

const deriveTopicLabel = (question) => {
  if (question?.question_bank_tag) {
    return question.question_bank_tag;
  }
  const prompt = String(question?.prompt || 'training remediation');
  return prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
};

const buildMicroLearning = async (base44, { topicLabel, audience, category, businessLine }) => {
  const prompt = `Create a short corrective-action micro-learning lesson for a frontline healthcare employee.

Topic missed: ${topicLabel}
Audience: ${audience}
Category: ${category}
Business line: ${businessLine}

Rules:
- Write in plain, practical language.
- Keep it short and directly useful in daily work.
- Make it appropriate for busy frontline staff.
- Include a realistic example and 3 short questions.`;

  // Use Base44's InvokeLLM (handles auth/model resolution). We ask for JSON
  // in-prompt and parse the text result rather than passing response_json_schema:
  // the provider's strict structured-output mode rejects deeply-nested free-form
  // objects (it requires an explicit `required` array on every nested object).
  let parsed = {};
  try {
    const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `${prompt}\n\nReturn ONLY valid JSON with this shape (no prose or code fences):\n{"course":{"title":"","short_description":"","description":"","learning_objectives":[""],"passing_score":80},"module":{"title":"","content":{"intro":"","sections":[{"heading":"","body":"","bullets":[""],"example":""}],"key_takeaways":[""]}},"questions":[{"type":"mcq","prompt":"","options":[{"value":"A","label":""}],"correct_answer":{},"rationale":""}]}`
    });
    parsed = parseLLMJson(raw) || {};
  } catch (e) {
    console.error('Failed to generate micro-learning for corrective action plan:', e?.message || e);
    parsed = {};
  }
  parsed = parsed || {};
  return {
    title: parsed.course?.title || `Micro-Learning: ${topicLabel}`,
    short_description: parsed.course?.short_description || `Supplemental training for ${topicLabel}`,
    description: parsed.course?.description || `Remediation lesson for ${topicLabel}`,
    learning_objectives: parsed.course?.learning_objectives || [],
    passing_score: parsed.course?.passing_score || 80,
    module: parsed.module || { title: topicLabel, content: { intro: '', sections: [], key_takeaways: [] } },
    questions: parsed.questions || []
  };
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const posted = payload?.data || payload;
    if (!posted?.id) {
      return Response.json({ success: true, skipped: true, reason: 'No attempt id in payload' });
    }

    // Entity-trigger hardening: re-fetch the canonical TrainingAttempt by id and
    // derive ALL privileged state (user_id, answers, pass/fail) from it — never
    // the posted body, which a forged trigger could use to assign mandatory
    // remediation and spam notifications to an arbitrary victim.
    const [attempt] = await base44.asServiceRole.entities.TrainingAttempt
      .filter({ id: posted.id }, '-created_date', 1).catch(() => []);
    if (!attempt) {
      return Response.json({ success: false, error: 'Attempt not found' }, { status: 404 });
    }
    if (!attempt.assignment_id || attempt.pass_fail_result !== 'failed') {
      return Response.json({ success: true, skipped: true, reason: 'No failed attempt to process' });
    }

    // Idempotency: this is a TrainingAttempt entity-trigger and re-fires on
    // retries / later row updates. If a corrective action plan already exists for
    // this attempt, don't create a duplicate plan or re-spam the employee +
    // every admin (the supplemental-assignment reuse guard below only dedups
    // assignments, not the plan/notifications).
    const existingPlans = await base44.asServiceRole.entities.CorrectiveActionPlan
      .filter({ training_attempt_id: attempt.id }, '-created_date', 1).catch(() => []);
    if (existingPlans.length > 0) {
      return Response.json({ success: true, skipped: true, reason: 'Corrective action plan already exists for this attempt' });
    }

    const [assignment] = await base44.asServiceRole.entities.TrainingAssignment.filter({ id: attempt.assignment_id }, '-created_date', 1);
    const [sourceCourse] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: attempt.course_id }, '-created_date', 1);
    if (!assignment || !sourceCourse) {
      return Response.json({ success: false, error: 'Source assignment or course not found' }, { status: 404 });
    }

    const [employee] = await base44.asServiceRole.entities.User.filter({ email: attempt.user_id }, '-created_date', 1);
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 300);
    const agencyAdmins = allUsers.filter((candidate) =>
      candidate.account_type === 'agency_admin' &&
      (!employee?.agency_name || candidate.agency_name === employee.agency_name)
    );

    const failedQuestionIds = (attempt.answers_json || [])
      .filter((answer) => answer.correct === false || (answer.points_earned ?? 0) < (answer.points_possible ?? 1))
      .map((answer) => answer.question_id)
      .filter(Boolean);

    const questionRecords = failedQuestionIds.length > 0
      ? await Promise.all(failedQuestionIds.map((id) => base44.asServiceRole.entities.TrainingQuestion.filter({ id }, '-created_date', 1).then((rows) => rows[0]).catch(() => null)))
      : [];

    const topicLabels = [...new Set(questionRecords.filter(Boolean).map(deriveTopicLabel))].slice(0, 3);
    const publishedCourses = await base44.asServiceRole.entities.TrainingCourse.list('-updated_date', 500);
    const supplementalAssignmentIds = [];
    const actionItems = [];

    for (const topicLabel of topicLabels) {
      const topicTag = normalizeTag(topicLabel);
      let microCourse = publishedCourses.find((course) =>
        course.status === 'published' &&
        Array.isArray(course.tags) &&
        course.tags.includes('micro_learning') &&
        course.tags.includes(topicTag) &&
        (course.business_line_scope === sourceCourse.business_line_scope || course.business_line_scope === 'all')
      );

      if (!microCourse) {
        const microContent = await buildMicroLearning(base44, {
          topicLabel,
          audience: employee?.job_title || employee?.discipline || sourceCourse.employee_audience || 'frontline healthcare staff',
          category: sourceCourse.category || 'compliance',
          businessLine: sourceCourse.business_line_scope || 'all'
        });

        microCourse = await base44.asServiceRole.entities.TrainingCourse.create({
          title: microContent.title,
          short_description: microContent.short_description,
          description: microContent.description,
          training_type: 'course',
          category: sourceCourse.category || 'compliance',
          business_line_scope: sourceCourse.business_line_scope || 'all',
          employee_audience: employee?.job_title || employee?.discipline || sourceCourse.employee_audience || 'frontline healthcare staff',
          purpose: `Corrective action micro-learning for ${topicLabel}`,
          reading_level: 'plain professional',
          role_targets: [employee?.discipline || employee?.credential_type || employee?.job_title || 'employee'],
          tags: ['micro_learning', topicTag],
          estimated_minutes: 10,
          status: 'published',
          version: '1.0',
          created_by: 'system-corrective-action',
          learning_objectives: microContent.learning_objectives,
          passing_score: microContent.passing_score,
          is_mandatory: true,
          ai_generated: true,
          needs_sme_review: false,
          enable_certificate: false,
          include_key_takeaways: true,
          test_settings_json: {
            randomize_questions: true,
            randomize_answers: true,
            show_correct_answers_after_completion: true
          }
        });

        await base44.asServiceRole.entities.TrainingModule.create({
          course_id: microCourse.id,
          title: microContent.module?.title || topicLabel,
          type: 'lesson',
          content_json: microContent.module?.content || {},
          order_index: 0,
          estimated_minutes: 10,
          is_required: true
        });

        const ALLOWED_Q_TYPES = new Set(['mcq', 'multi_select', 'true_false', 'short_answer', 'matching', 'scenario_based']);
        for (const [index, question] of microContent.questions.entries()) {
          await base44.asServiceRole.entities.TrainingQuestion.create({
            course_id: microCourse.id,
            // Coerce the AI-supplied type to the TrainingQuestion enum; an out-of-enum
            // value would be rejected and abort the whole corrective-action build.
            type: ALLOWED_Q_TYPES.has(question.type) ? question.type : 'mcq',
            prompt: question.prompt || `Micro-learning question ${index + 1}`,
            options_json: question.options || [],
            correct_answer_json: { answer: question.correct_answer },
            rationale: question.rationale || '',
            difficulty: 'easy',
            order_index: index,
            points: 1,
            active: true,
            question_bank_tag: topicTag
          });
        }
      }

      const existingAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter({ course_id: microCourse.id, assigned_to_user_id: attempt.user_id }, '-created_date', 10);
      const openAssignment = existingAssignments.find((item) => ['assigned', 'in_progress', 'overdue', 'failed'].includes(item.status));
      if (openAssignment) {
        supplementalAssignmentIds.push(openAssignment.id);
        actionItems.push({ topic: topicLabel, course_title: microCourse.title, action: 'existing assignment reused' });
        continue;
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const supplementalAssignment = await base44.asServiceRole.entities.TrainingAssignment.create({
        course_id: microCourse.id,
        course_title: microCourse.title,
        assigned_to_user_id: attempt.user_id,
        assigned_to_role: employee?.job_title || employee?.credential_type || employee?.role || 'employee',
        assigned_to_department: employee?.department || '',
        assigned_to_location: employee?.location || '',
        assigned_to_business_line: employee?.business_line || sourceCourse.business_line_scope || '',
        assigned_by: 'system-corrective-action',
        assigned_date: new Date().toISOString(),
        due_date: dueDate.toISOString().slice(0, 10),
        priority: 'high',
        status: 'assigned',
        required: true,
        passing_score_required: microCourse.passing_score || 80,
        max_attempts: 3,
        waiting_period_hours: 0,
        regenerate_test_on_retake: true,
        retake_required: false,
        remediation_message: `Complete this supplemental micro-learning for ${topicLabel} before your next retake.`,
        progress_percentage: 0,
        notes: JSON.stringify({ corrective_action: true, source_attempt_id: attempt.id, source_course_id: sourceCourse.id, micro_learning_topic: topicLabel }),
        archived_status: false
      });

      supplementalAssignmentIds.push(supplementalAssignment.id);
      actionItems.push({ topic: topicLabel, course_title: microCourse.title, action: 'new assignment created', due_date: dueDate.toISOString().slice(0, 10) });
    }

    const plan = await base44.asServiceRole.entities.CorrectiveActionPlan.create({
      user_id: attempt.user_id,
      user_name: employee?.full_name || attempt.user_id,
      training_assignment_id: attempt.assignment_id,
      training_attempt_id: attempt.id,
      source_course_id: sourceCourse.id,
      source_course_title: sourceCourse.title,
      source_score: attempt.score,
      status: 'open',
      missed_topics: topicLabels,
      action_items: actionItems,
      supplemental_assignment_ids: supplementalAssignmentIds,
      manager_emails: agencyAdmins.map((manager) => manager.email)
    });

    await base44.asServiceRole.entities.Notification.create({
      user_email: attempt.user_id,
      title: 'Corrective action plan assigned',
      message: `You did not pass "${sourceCourse.title}". Supplemental micro-learning has been assigned to help close the skill gaps before your retake.`,
      type: 'compliance_alert',
      priority: 'high',
      action_url: '/MyTraining',
      action_label: 'Open training',
      metadata: { corrective_action_plan_id: plan.id, source_course_id: sourceCourse.id }
    });

    await Promise.all(agencyAdmins.map((manager) =>
      base44.asServiceRole.entities.Notification.create({
        user_email: manager.email,
        title: 'Corrective action plan triggered',
        message: `${employee?.full_name || attempt.user_id} failed "${sourceCourse.title}" and was assigned supplemental micro-learning.`,
        type: 'critical_alert',
        priority: 'high',
        action_url: '/ManagerSkillGapDashboard',
        action_label: 'Review gaps',
        metadata: { corrective_action_plan_id: plan.id, user_id: attempt.user_id, source_course_id: sourceCourse.id }
      })
    ));

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: attempt.user_id,
      actor_name: employee?.full_name || attempt.user_id,
      action: 'assignment_modified',
      entity_type: 'TrainingAttempt',
      entity_id: attempt.id,
      reason: 'corrective action plan created',
      after_json: { corrective_action_plan_id: plan.id, supplemental_assignment_ids: supplementalAssignmentIds, missed_topics: topicLabels },
      severity: 'warning'
    });

    return Response.json({
      success: true,
      corrective_action_plan_id: plan.id,
      missed_topics: topicLabels,
      supplemental_assignment_ids: supplementalAssignmentIds
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});