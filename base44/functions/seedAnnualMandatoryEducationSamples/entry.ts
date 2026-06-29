import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

const sampleCourses = [
  {
    title: '2026 Home Health Annual: Infection Prevention and Control',
    short_description: 'Frontline infection prevention training for home health staff.',
    description: 'Practical annual education on infection prevention, hand hygiene, PPE, home environment risks, and when to escalate infection concerns.',
    business_line_scope: 'home_health',
    category: 'home_health',
    employee_audience: 'Home health field staff',
    purpose: 'Annual infection prevention review for home health clinicians.',
    learning_objectives: [
      'Use standard precautions correctly in the home setting.',
      'Recognize when PPE is needed and when infection risks require escalation.',
      'Apply hand hygiene and equipment-cleaning steps consistently during visits.'
    ],
    modules: [
      {
        title: 'Preventing infection in the home',
        type: 'lesson',
        content_json: {
          intro: 'Home health staff work in unpredictable environments, so infection prevention must stay simple, consistent, and practical.',
          sections: [
            {
              heading: 'Standard precautions every visit',
              body: 'Clean hands before and after contact, protect your equipment, and assume body fluids can spread infection.',
              bullets: ['Perform hand hygiene before entering the care space and before leaving.', 'Clean frequently touched equipment between patients.', 'Use gloves when contact with blood, drainage, or body fluids is possible.'],
              example: 'Before wound care, clean hands, set up a clean work area, and separate clean supplies from used items.'
            },
            {
              heading: 'Recognize high-risk situations',
              body: 'Watch for coughing, fever, new drainage, poor sanitation, or limited supplies that make safe care harder.',
              bullets: ['Pause and reorganize the care space if it becomes contaminated.', 'Escalate concerns when infection risk cannot be managed safely.', 'Teach patients and caregivers simple steps they can repeat daily.'],
              example: 'If the patient has a new productive cough and fever, document findings clearly and notify the office/provider per policy.'
            }
          ],
          case_scenarios: [
            {
              title: 'Crowded wound-care visit',
              situation: 'You arrive to perform wound care and notice pets, food, and unclean surfaces near the supplies.',
              guidance: 'Create a clean field, move supplies away from contamination, and teach the caregiver how to maintain a safer setup.'
            }
          ],
          key_takeaways: ['Keep infection prevention steps simple and repeatable.', 'Protect the patient, yourself, and your equipment every visit.', 'Report risks you cannot safely control.']
        }
      },
      {
        title: 'PPE, teaching, and reporting',
        type: 'lesson',
        content_json: {
          intro: 'PPE only works when staff know when to use it and how to explain precautions clearly.',
          sections: [
            {
              heading: 'Choosing the right PPE',
              body: 'Match PPE to the task. Gloves alone are not enough when splashing or spraying is likely.',
              bullets: ['Use gowns and face protection when splash risk is present.', 'Remove PPE carefully to avoid self-contamination.', 'Dispose of used PPE and perform hand hygiene right away.'],
              example: 'During heavy wound irrigation, use gloves, gown, and eye protection rather than gloves alone.'
            }
          ],
          case_scenarios: [],
          key_takeaways: ['Use the right PPE for the task.', 'Teach precautions in plain language.', 'Document and report infection concerns promptly.']
        }
      }
    ],
    questions: [
      {
        type: 'mcq',
        prompt: 'What is the best first step when you see a cluttered, contaminated care area before wound care?',
        options_json: [{ value: 'A', label: 'Start care quickly to stay on schedule' }, { value: 'B', label: 'Create a clean field and move supplies away from contamination' }, { value: 'C', label: 'Skip hand hygiene and use extra gloves' }],
        correct_answer_json: { answer: 'B' },
        rationale: 'A clean field helps reduce contamination risk before care begins.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'true_false',
        prompt: 'Hand hygiene should be done both before and after patient care.',
        options_json: [{ value: true, label: 'True' }, { value: false, label: 'False' }],
        correct_answer_json: { answer: true },
        rationale: 'Hand hygiene protects both the patient and the clinician.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'multi_select',
        prompt: 'Which actions support safe infection prevention in the home? Select all that apply.',
        options_json: [{ value: 'A', label: 'Clean equipment between patients' }, { value: 'B', label: 'Store clean supplies near used trash' }, { value: 'C', label: 'Report infection risks you cannot control' }, { value: 'D', label: 'Teach caregivers simple prevention steps' }],
        correct_answer_json: { answer: ['A', 'C', 'D'] },
        rationale: 'Safe infection prevention includes equipment cleaning, education, and escalation of uncontrolled risks.',
        difficulty: 'medium',
        points: 1
      },
      {
        type: 'short_answer',
        prompt: 'Describe one practical way you would teach a caregiver to reduce infection risk during wound care at home.',
        options_json: [],
        correct_answer_json: { answer: '' },
        rationale: 'Responses should reflect practical, patient-friendly teaching.',
        rubric: 'Give full credit when the response describes a clear, realistic caregiver action such as hand hygiene, separating clean and dirty supplies, or surface cleaning.',
        difficulty: 'medium',
        points: 1
      }
    ]
  },
  {
    title: '2026 Home Health Annual: Documentation Standards and Incident Reporting',
    short_description: 'Clear, compliant charting and incident escalation for home health teams.',
    description: 'Annual review of practical documentation standards, late entry basics, incident reporting expectations, and defensible home health charting.',
    business_line_scope: 'home_health',
    category: 'documentation',
    employee_audience: 'Home health clinical and office staff',
    purpose: 'Reinforce annual documentation and reporting expectations.',
    learning_objectives: ['Document objective findings clearly.', 'Identify when an incident must be reported.', 'Use simple, defensible language in the record.'],
    modules: [
      {
        title: 'Defensible documentation',
        type: 'lesson',
        content_json: {
          intro: 'Good documentation explains what you saw, what you did, and what happened next.',
          sections: [
            {
              heading: 'Write what matters',
              body: 'Use objective observations, patient response, and actions taken. Avoid vague wording and unsupported assumptions.',
              bullets: ['Record who was notified and when.', 'Document changes from baseline clearly.', 'Use late-entry language if charting is delayed.'],
              example: 'Instead of “patient seemed worse,” document “patient had increased shortness of breath with ambulation and required rest after 10 feet.”'
            }
          ],
          case_scenarios: [
            {
              title: 'Fall after your visit',
              situation: 'A caregiver calls two hours after your visit to report the patient fell while going to the bathroom.',
              guidance: 'Document the report source, key facts, notifications, and follow agency incident policy immediately.'
            }
          ],
          key_takeaways: ['Be objective, specific, and timely.', 'Document notifications clearly.', 'Report incidents through the proper workflow.']
        }
      }
    ],
    questions: [
      {
        type: 'mcq',
        prompt: 'Which charting example is most defensible?',
        options_json: [{ value: 'A', label: 'Patient looked bad today.' }, { value: 'B', label: 'Patient weak and not doing well.' }, { value: 'C', label: 'Patient required rest after 10 feet due to shortness of breath and oxygen saturation dropped to 89%.' }],
        correct_answer_json: { answer: 'C' },
        rationale: 'Objective, measurable documentation is the most defensible.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'true_false',
        prompt: 'Incident reporting can wait until the next routine documentation day if the patient is stable.',
        options_json: [{ value: true, label: 'True' }, { value: false, label: 'False' }],
        correct_answer_json: { answer: false },
        rationale: 'Incidents should be reported according to agency policy without unnecessary delay.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'scenario_based',
        prompt: 'A patient refuses wound care and becomes verbally upset. What key items must be documented and reported?',
        options_json: [],
        correct_answer_json: { answer: '' },
        rationale: 'Responses should include refusal details, patient condition, teaching provided, and notifications.',
        rubric: 'Full credit when the learner includes the refusal event, patient response, teaching/interventions, safety concerns, and who was notified.',
        difficulty: 'medium',
        points: 1
      }
    ]
  },
  {
    title: '2026 Hospice Annual: Hospice Philosophy and Goals of Care',
    short_description: 'Frontline hospice annual education on comfort-focused care and communication.',
    description: 'Practical annual education on hospice philosophy, comfort-focused goals, family communication, and interdisciplinary alignment.',
    business_line_scope: 'hospice',
    category: 'hospice',
    employee_audience: 'Hospice clinical staff and leadership',
    purpose: 'Refresh annual understanding of hospice philosophy and day-to-day care expectations.',
    learning_objectives: ['Explain hospice goals of care simply.', 'Support comfort-focused decision-making.', 'Communicate clearly with patients and families.'],
    modules: [
      {
        title: 'Comfort-focused hospice care',
        type: 'lesson',
        content_json: {
          intro: 'Hospice care focuses on comfort, dignity, and goals that matter most to the patient and family.',
          sections: [
            {
              heading: 'What hospice philosophy looks like in practice',
              body: 'Staff should align care with comfort, symptom relief, quality of life, and clear communication.',
              bullets: ['Support patient choice and dignity.', 'Watch for unmanaged symptoms and respond promptly.', 'Keep the plan of care aligned across the team.'],
              example: 'If a patient is more comfortable sleeping in a recliner, the team should support safe comfort rather than forcing a standard routine.'
            }
          ],
          case_scenarios: [
            {
              title: 'Family requests aggressive treatment',
              situation: 'A family member asks why the hospice team is not sending the patient to the hospital for every symptom change.',
              guidance: 'Explain hospice goals clearly, address symptom management steps, and involve the RN or provider as needed.'
            }
          ],
          key_takeaways: ['Hospice care is comfort-focused, not curative.', 'Communication must be compassionate and clear.', 'Care decisions should stay aligned with goals of care.']
        }
      }
    ],
    questions: [
      {
        type: 'mcq',
        prompt: 'Which statement best reflects hospice philosophy?',
        options_json: [{ value: 'A', label: 'The main goal is aggressive curative treatment.' }, { value: 'B', label: 'The focus is comfort, dignity, and goals of care.' }, { value: 'C', label: 'Hospital transfer should happen for every new symptom.' }],
        correct_answer_json: { answer: 'B' },
        rationale: 'Hospice care centers on comfort, dignity, and patient goals.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'multi_select',
        prompt: 'Which actions support hospice goals of care? Select all that apply.',
        options_json: [{ value: 'A', label: 'Clarify patient goals with the team' }, { value: 'B', label: 'Ignore family questions to avoid conflict' }, { value: 'C', label: 'Respond quickly to symptom changes' }, { value: 'D', label: 'Support comfort and dignity in daily care' }],
        correct_answer_json: { answer: ['A', 'C', 'D'] },
        rationale: 'Hospice goals require aligned communication, symptom response, and dignity-focused care.',
        difficulty: 'medium',
        points: 1
      },
      {
        type: 'short_answer',
        prompt: 'In plain language, how would you explain hospice goals of care to a worried family member?',
        options_json: [],
        correct_answer_json: { answer: '' },
        rationale: 'Responses should be compassionate, practical, and easy to understand.',
        rubric: 'Full credit when the answer explains comfort-focused care, dignity, symptom relief, and support for patient/family goals in plain language.',
        difficulty: 'medium',
        points: 1
      }
    ]
  },
  {
    title: '2026 Hospice Annual: Pain, Symptom Management, and End-of-Life Communication',
    short_description: 'Practical annual hospice training for symptom response and family communication.',
    description: 'Annual education covering pain and symptom basics, common end-of-life changes, escalation, and supportive communication with families.',
    business_line_scope: 'hospice',
    category: 'clinical',
    employee_audience: 'Hospice field staff',
    purpose: 'Support consistent symptom management and end-of-life communication skills.',
    learning_objectives: ['Recognize common end-of-life symptom concerns.', 'Respond appropriately and escalate when needed.', 'Use calm, supportive communication with families.'],
    modules: [
      {
        title: 'Symptom response and communication',
        type: 'lesson',
        content_json: {
          intro: 'Frontline hospice staff often notice symptom changes first, so clear communication and timely escalation matter.',
          sections: [
            {
              heading: 'Recognize and report changes',
              body: 'Watch for uncontrolled pain, agitation, breathing changes, poor intake, and distress in family or caregivers.',
              bullets: ['Assess what changed and when.', 'Document interventions and response.', 'Notify the nurse/provider per policy when symptoms are not controlled.'],
              example: 'If morphine was given and pain remains severe 30 minutes later, document response and escalate per agency protocol.'
            }
          ],
          case_scenarios: [
            {
              title: 'Family anxiety overnight',
              situation: 'A family member reports noisy breathing and fears the patient is suffering.',
              guidance: 'Provide calm education, explain what to observe, reinforce comfort measures, and escalate concerns when symptoms appear uncontrolled.'
            }
          ],
          key_takeaways: ['Notice changes early.', 'Document interventions and patient response.', 'Use simple, calming communication with families.']
        }
      }
    ],
    questions: [
      {
        type: 'true_false',
        prompt: 'If a symptom remains uncontrolled after intervention, staff should document and escalate according to policy.',
        options_json: [{ value: true, label: 'True' }, { value: false, label: 'False' }],
        correct_answer_json: { answer: true },
        rationale: 'Uncontrolled symptoms require follow-up and escalation.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'mcq',
        prompt: 'What is the best response when a family member is frightened by a new end-of-life symptom?',
        options_json: [{ value: 'A', label: 'Avoid answering until the next visit' }, { value: 'B', label: 'Use calm, simple language and explain what to watch for while escalating if needed' }, { value: 'C', label: 'Tell them not to worry and leave quickly' }],
        correct_answer_json: { answer: 'B' },
        rationale: 'Families need supportive education and clear guidance.',
        difficulty: 'easy',
        points: 1
      },
      {
        type: 'scenario_based',
        prompt: 'A patient remains in distress after the ordered comfort measure was used. What should you do next and how should you document it?',
        options_json: [],
        correct_answer_json: { answer: '' },
        rationale: 'Responses should describe reassessment, escalation, and clear documentation.',
        rubric: 'Full credit when the response includes reassessment, escalation to the appropriate clinician/provider, and documentation of what was given and how the patient responded.',
        difficulty: 'medium',
        points: 1
      }
    ]
  }
];

const planTemplates = [
  {
    name: '2026 Penn Home Health Annual Mandatory Education',
    business_line_scope: 'home_health',
    description: 'Starter annual plan for Penn Home Health staff.',
    courseTitles: [
      '2026 Home Health Annual: Infection Prevention and Control',
      '2026 Home Health Annual: Documentation Standards and Incident Reporting'
    ]
  },
  {
    name: '2026 Penn Hospice Annual Mandatory Education',
    business_line_scope: 'hospice',
    description: 'Starter annual plan for Penn Hospice staff.',
    courseTitles: [
      '2026 Hospice Annual: Hospice Philosophy and Goals of Care',
      '2026 Hospice Annual: Pain, Symptom Management, and End-of-Life Communication'
    ]
  }
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const year = new Date().getFullYear();
    const createdCourses = [];
    const reusedCourses = [];

    for (const sample of sampleCourses) {
      const existing = await base44.asServiceRole.entities.TrainingCourse.filter({ title: sample.title, annual_cycle_year: year }, '-created_date', 5);
      let course = existing[0];
      if (!course) {
        course = await base44.asServiceRole.entities.TrainingCourse.create({
          title: sample.title,
          short_description: sample.short_description,
          description: sample.description,
          training_type: 'annual_mandatory',
          annual_cycle_year: year,
          category: sample.category,
          business_line_scope: sample.business_line_scope,
          employee_audience: sample.employee_audience,
          purpose: sample.purpose,
          reading_level: 'plain professional',
          role_targets: sample.employee_audience.split(',').map((item) => item.trim()),
          tags: ['annual', sample.business_line_scope, sample.category],
          estimated_minutes: 30,
          status: 'published',
          version: '1.0',
          created_by: user.email,
          published_by: user.email,
          published_date: new Date().toISOString(),
          learning_objectives: sample.learning_objectives,
          passing_score: 80,
          certificate_valid_months: 12,
          is_mandatory: true,
          recurrence_rule: 'annual',
          ai_generated: false,
          needs_sme_review: false,
          enable_certificate: true,
          requires_attestation: true,
          attestation_text: 'I reviewed and understand this annual education and understand I am responsible for following agency policy.',
          include_case_scenarios: true,
          include_key_takeaways: true,
          certificate_wording: 'This certifies successful completion of annual mandatory education.',
          retake_settings_json: { passing_threshold: 80, unlimited_retakes: false, max_attempts: 3, waiting_period_hours: 24, regenerate_test_on_retake: true },
          test_settings_json: { randomize_questions: true, randomize_answers: true, show_correct_answers_after_completion: false },
          archived_status: false
        });
        createdCourses.push(course.title);

        for (const [moduleIndex, module] of sample.modules.entries()) {
          await base44.asServiceRole.entities.TrainingModule.create({
            course_id: course.id,
            title: module.title,
            type: module.type,
            content_json: module.content_json,
            order_index: moduleIndex,
            estimated_minutes: 15,
            is_required: true
          });
        }

        for (const [questionIndex, question] of sample.questions.entries()) {
          await base44.asServiceRole.entities.TrainingQuestion.create({
            course_id: course.id,
            type: question.type,
            prompt: question.prompt,
            options_json: question.options_json,
            correct_answer_json: question.correct_answer_json,
            rationale: question.rationale,
            rubric: question.rubric || '',
            difficulty: question.difficulty,
            order_index: questionIndex,
            points: question.points || 1,
            active: true
          });
        }

        await base44.asServiceRole.entities.TrainingAuditLog.create({
          actor_id: user.email,
          actor_name: user.full_name,
          action: 'course_created',
          entity_type: 'TrainingCourse',
          entity_id: course.id,
          after_json: { title: course.title, training_type: 'annual_mandatory', status: 'published' },
          reason: 'sample preload',
          severity: 'info'
        });
      } else {
        reusedCourses.push(course.title);
      }
    }

    const allCourses = await base44.asServiceRole.entities.TrainingCourse.filter({ annual_cycle_year: year }, '-created_date', 200);
    const createdPlans = [];

    for (const template of planTemplates) {
      let [plan] = await base44.asServiceRole.entities.LearningPlan.filter({ name: template.name }, '-created_date', 5);
      if (!plan) {
        plan = await base44.asServiceRole.entities.LearningPlan.create({
          name: template.name,
          description: template.description,
          business_line_scope: template.business_line_scope,
          year,
          plan_type: 'annual',
          active: true,
          auto_enroll: false,
          auto_enroll_criteria: {},
          total_courses: template.courseTitles.length
        });
        createdPlans.push(plan.name);
      }

      const existingItems = await base44.asServiceRole.entities.LearningPlanCourse.filter({ plan_id: plan.id }, 'order_index', 50);
      if (existingItems.length === 0) {
        for (const [index, title] of template.courseTitles.entries()) {
          const course = allCourses.find((item) => item.title === title);
          if (!course) continue;
          await base44.asServiceRole.entities.LearningPlanCourse.create({
            plan_id: plan.id,
            course_id: course.id,
            course_title: course.title,
            order_index: index,
            is_required: true
          });
        }
      }
    }

    return Response.json({
      success: true,
      created_courses: createdCourses,
      reused_courses: reusedCourses,
      created_plans: createdPlans,
      year
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});