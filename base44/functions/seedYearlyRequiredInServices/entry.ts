import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Seed the full set of YEARLY REQUIRED IN-SERVICES for Home Health and Hospice
// staff and nurses. Each in-service is created as a published TrainingCourse
// (training_type: annual_mandatory) with lesson modules and a graded quiz, then
// grouped into role-based annual learning plans so they surface in My Learning.
//
// The function is idempotent: courses and plans are matched by title for the
// current annual cycle year and reused instead of duplicated.
// ───────────────────────────────────────────────────────────────────────────

const isAdminUser = (user) =>
  user?.role === 'admin' ||
  user?.account_type === 'agency_admin' ||
  user?.account_type === 'super_admin';

// Shared quiz building blocks ------------------------------------------------
const tf = (prompt, answer, rationale, difficulty = 'easy') => ({
  type: 'true_false',
  prompt,
  options_json: [{ value: true, label: 'True' }, { value: false, label: 'False' }],
  correct_answer_json: { answer },
  rationale,
  difficulty,
  points: 1,
});

const mcq = (prompt, options, correct, rationale, difficulty = 'easy') => ({
  type: 'mcq',
  prompt,
  options_json: options.map((label, i) => ({ value: 'ABCDE'[i], label })),
  correct_answer_json: { answer: 'ABCDE'[correct] },
  rationale,
  difficulty,
  points: 1,
});

const multi = (prompt, options, correctIdx, rationale, difficulty = 'medium') => ({
  type: 'multi_select',
  prompt,
  options_json: options.map((label, i) => ({ value: 'ABCDE'[i], label })),
  correct_answer_json: { answer: correctIdx.map((i) => 'ABCDE'[i]) },
  rationale,
  difficulty,
  points: 1,
});

const scenario = (prompt, rationale, rubric) => ({
  type: 'scenario_based',
  prompt,
  options_json: [],
  correct_answer_json: { answer: '' },
  rationale,
  rubric,
  difficulty: 'medium',
  points: 1,
});

// ───────────────────────────────────────────────────────────────────────────
// IN-SERVICE LIBRARY
// ───────────────────────────────────────────────────────────────────────────
const COMMON = 'all';
const HH = 'home_health';
const HOSPICE = 'hospice';

const courses = [
  // 1. Infection Prevention & Control ---------------------------------------
  {
    key: 'infection_control',
    title: 'Annual Infection Prevention & Control',
    short_description: 'Standard precautions, hand hygiene, and PPE for the home setting.',
    description:
      'Required annual infection prevention and control education for home health and hospice staff, mapped to CMS Conditions of Participation (42 CFR §484.70 / §418.60) and CDC standard precautions.',
    category: 'safety',
    business_line_scope: COMMON,
    employee_audience: 'All clinical and direct-care staff',
    purpose: 'Reinforce safe, repeatable infection prevention practices in patient homes.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'PT', 'OT', 'SLP', 'MSW'],
    estimated_minutes: 30,
    learning_objectives: [
      'Apply standard precautions correctly during every home visit.',
      'Select and use PPE appropriately for the task and exposure risk.',
      'Recognize and escalate infection risks that cannot be safely controlled.',
    ],
    modules: [
      {
        title: 'Standard precautions in the home',
        content_json: {
          intro:
            'Home care environments are unpredictable, so infection prevention must stay simple, consistent, and practical on every visit.',
          sections: [
            {
              heading: 'The basics every visit',
              body: 'Clean your hands, protect your equipment, and treat all blood and body fluids as potentially infectious.',
              bullets: [
                'Perform hand hygiene before entering the care space and again before you leave.',
                'Clean frequently touched equipment (stethoscope, BP cuff, glucometer) between patients.',
                'Wear gloves whenever contact with blood, drainage, or body fluids is possible.',
              ],
              example:
                'Before wound care, clean your hands, set up a clean work surface, and keep clean supplies separate from used items.',
            },
            {
              heading: 'Recognize and escalate high-risk situations',
              body: 'Watch for fever, new cough, fresh drainage, poor sanitation, pests, or missing supplies that make safe care harder.',
              bullets: [
                'Reorganize and re-establish a clean field if the area becomes contaminated.',
                'Notify the office/provider when infection risk cannot be managed safely.',
                'Teach patients and caregivers simple steps they can repeat every day.',
              ],
              example:
                'A patient has a new productive cough and fever — document objective findings and notify the office/provider per agency policy.',
            },
          ],
          key_takeaways: [
            'Keep infection-prevention steps simple and repeatable.',
            'Protect the patient, yourself, and your equipment every visit.',
            'Report risks you cannot safely control.',
          ],
        },
      },
      {
        title: 'PPE, hand hygiene, and teaching',
        content_json: {
          intro: 'PPE only works when staff know when to use it and how to remove it without self-contamination.',
          sections: [
            {
              heading: 'Choosing and removing PPE',
              body: 'Match PPE to the task. Gloves alone are not enough when splashing or spraying is likely.',
              bullets: [
                'Add a gown and face/eye protection when splash risk is present.',
                'Remove PPE carefully — outermost and dirtiest first — to avoid contaminating yourself.',
                'Dispose of used PPE and perform hand hygiene immediately afterward.',
              ],
              example: 'During heavy wound irrigation, use gloves, a gown, and eye protection rather than gloves alone.',
            },
          ],
          key_takeaways: [
            'Use the right PPE for the task, not just gloves.',
            'Doff PPE carefully and perform hand hygiene right away.',
            'Teach precautions to caregivers in plain language.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'What is the best first step when you find a cluttered, contaminated care area before wound care?',
        ['Start care quickly to stay on schedule', 'Create a clean field and move supplies away from contamination', 'Skip hand hygiene and double-glove instead'],
        1,
        'Establishing a clean field reduces contamination risk before care begins.',
      ),
      tf('Hand hygiene should be performed both before and after patient care.', true, 'Hand hygiene protects both the patient and the clinician.'),
      multi(
        'Which actions support safe infection prevention in the home? Select all that apply.',
        ['Clean reusable equipment between patients', 'Store clean supplies next to used trash', 'Report infection risks you cannot control', 'Teach caregivers simple prevention steps'],
        [0, 2, 3],
        'Safe practice includes equipment cleaning, escalation of uncontrolled risk, and caregiver education.',
      ),
      scenario(
        'You arrive for wound care and find pets, food, and unclean surfaces near your supplies. What do you do and how do you document it?',
        'Responses should reflect establishing a clean field, protecting supplies, teaching the caregiver, and objective documentation.',
        'Full credit when the learner creates a clean field, separates clean/dirty items, teaches the caregiver, and documents findings objectively.',
      ),
    ],
  },

  // 2. HIPAA Privacy & Security ---------------------------------------------
  {
    key: 'hipaa',
    title: 'Annual HIPAA Privacy & Security',
    short_description: 'Protecting PHI, minimum necessary, and breach reporting in the field.',
    description:
      'Required annual HIPAA Privacy and Security training (45 CFR §164.530(b)) covering PHI handling, the minimum-necessary standard, mobile device security, and breach reporting for home health and hospice.',
    category: 'compliance',
    business_line_scope: COMMON,
    employee_audience: 'All workforce members',
    purpose: 'Keep protected health information secure across home visits, devices, and communications.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'office staff', 'leadership'],
    estimated_minutes: 30,
    learning_objectives: [
      'Apply the minimum-necessary standard when accessing or sharing PHI.',
      'Protect PHI on mobile devices and during field communication.',
      'Recognize a potential breach and report it promptly.',
    ],
    modules: [
      {
        title: 'Protecting PHI in the field',
        content_json: {
          intro: 'Home care moves PHI out of the office and into cars, homes, phones, and texts — so privacy habits matter every day.',
          sections: [
            {
              heading: 'Minimum necessary and patient rights',
              body: 'Access and share only the PHI needed to do your job. Patients have rights to their records, privacy, and to file complaints.',
              bullets: [
                'Look at only the charts of patients you are caring for.',
                'Verify identity before discussing PHI with family or other providers.',
                'Never post patient information or photos on social media.',
              ],
              example: 'A coworker asks about a patient who is not on your caseload — politely decline; you have no work reason to share.',
            },
            {
              heading: 'Device security and breaches',
              body: 'Lost devices, misdirected faxes, and overheard conversations are common breach sources in home care.',
              bullets: [
                'Use a passcode and keep devices encrypted and locked when unattended.',
                'Confirm fax numbers and recipient identity before sending PHI.',
                'Report a suspected breach to your privacy officer immediately — do not wait.',
              ],
              example: 'You realize a fax with PHI went to the wrong number — report it right away so the agency can act within required timelines.',
            },
          ],
          key_takeaways: [
            'Access only the minimum PHI you need.',
            'Lock and protect every device that touches PHI.',
            'Report suspected breaches immediately.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'What does the "minimum necessary" standard require?',
        ['Share all available PHI to be thorough', 'Access and disclose only the PHI needed for the task', 'Only applies to billing staff'],
        1,
        'Minimum necessary limits PHI use and disclosure to what is required for the job.',
      ),
      tf('Posting a patient story or photo on social media is acceptable if no name is used.', false, 'Even de-identified-looking posts can disclose PHI and violate policy; do not post patient information.'),
      multi(
        'Which are good ways to protect PHI on a work phone or tablet? Select all that apply.',
        ['Use a passcode and auto-lock', 'Leave it unlocked in the car', 'Keep the device encrypted', 'Report it immediately if lost'],
        [0, 2, 3],
        'Passcodes, encryption, and prompt loss reporting all protect PHI.',
      ),
      mcq(
        'You faxed PHI to the wrong number. What should you do?',
        ['Wait to see if anyone complains', 'Report it to the privacy officer immediately', 'Delete the record of the fax'],
        1,
        'Suspected breaches must be reported promptly so the agency can meet notification requirements.',
      ),
    ],
  },

  // 3. Abuse, Neglect & Exploitation ----------------------------------------
  {
    key: 'abuse_neglect',
    title: 'Annual Abuse, Neglect & Exploitation: Recognizing & Reporting',
    short_description: 'Spotting and reporting abuse, neglect, and financial exploitation.',
    description:
      'Required annual training on identifying and reporting patient abuse, neglect, mistreatment, and exploitation, including mandated-reporter duties under PA law (Older Adults Protective Services Act) and CMS CoP (§484.50 / §418.52).',
    category: 'compliance',
    business_line_scope: COMMON,
    employee_audience: 'All staff',
    purpose: 'Ensure every staff member can recognize and report mistreatment without delay.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'PT', 'OT', 'SLP', 'MSW', 'office staff'],
    estimated_minutes: 25,
    learning_objectives: [
      'Recognize signs of physical, emotional, and financial mistreatment.',
      'Understand mandated-reporter duties and timelines.',
      'Document objectively and report through the correct channel.',
    ],
    modules: [
      {
        title: 'Recognize, report, document',
        content_json: {
          intro: 'Home care staff often see warning signs first. Knowing what to look for — and reporting it — protects vulnerable patients.',
          sections: [
            {
              heading: 'Warning signs',
              body: 'Abuse and neglect can be physical, emotional, sexual, or financial, and can come from caregivers, family, or others.',
              bullets: [
                'Unexplained injuries, pressure injuries, dehydration, or poor hygiene.',
                'Fearfulness, withdrawal, or a caregiver who controls all communication.',
                'Missing funds, sudden changes to finances, or unpaid bills despite resources.',
              ],
              example: 'A patient flinches when their caregiver enters and has unexplained bruising — these are red flags to document and report.',
            },
            {
              heading: 'Your duty to report',
              body: 'Staff are mandated reporters. You report reasonable suspicion — you do not have to prove abuse occurred.',
              bullets: [
                'Report to your supervisor and the required agency/state line without delay.',
                'Document objective observations and patient statements in quotes.',
                'Reporting in good faith is protected; failing to report can carry penalties.',
              ],
              example: 'You suspect financial exploitation — report it; investigation is not your job, but reporting is.',
            },
          ],
          key_takeaways: [
            'Report reasonable suspicion — you do not need proof.',
            'Document objectively and use the patient’s own words.',
            'Good-faith reporting is protected by law.',
          ],
        },
      },
    ],
    questions: [
      tf('A mandated reporter must have proof of abuse before reporting.', false, 'Reasonable suspicion is enough; reporters do not need to prove abuse occurred.'),
      mcq(
        'Which is a sign of possible financial exploitation?',
        ['Patient eats three meals a day', 'Unpaid bills and missing funds despite adequate resources', 'Patient has a current advance directive'],
        1,
        'Sudden financial changes and missing funds can indicate exploitation.',
      ),
      multi(
        'What should you do when you suspect mistreatment? Select all that apply.',
        ['Report to your supervisor without delay', 'Investigate and confront the caregiver yourself', 'Document objective findings and patient quotes', 'Notify the required reporting line'],
        [0, 2, 3],
        'Report and document objectively; investigation is not the reporter’s role.',
      ),
      scenario(
        'A homebound patient has new bruises, seems fearful, and the caregiver insists on answering every question. What do you do?',
        'Responses should include objective documentation, reporting suspicion promptly, and avoiding confrontation/investigation.',
        'Full credit when the learner documents objective findings/quotes, reports suspicion to supervisor and required line without delay, and does not investigate or confront.',
      ),
    ],
  },

  // 4. Emergency Preparedness -----------------------------------------------
  {
    key: 'emergency_prep',
    title: 'Annual Emergency Preparedness & Disaster Response',
    short_description: 'Your role in the agency emergency plan and patient prioritization.',
    description:
      'Required annual emergency preparedness education (42 CFR §484.102 / §418.113) covering the agency all-hazards plan, communication, continuity of operations, and patient prioritization in the home.',
    category: 'safety',
    business_line_scope: COMMON,
    employee_audience: 'All staff',
    purpose: 'Ensure staff know their role before, during, and after an emergency.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'office staff', 'leadership'],
    estimated_minutes: 20,
    learning_objectives: [
      'Describe your role in the agency all-hazards emergency plan.',
      'Explain how patients are prioritized and contacted during emergencies.',
      'Use the agency communication plan to report status and needs.',
    ],
    modules: [
      {
        title: 'Be ready before it happens',
        content_json: {
          intro: 'Emergencies — storms, outages, pandemics — affect homebound patients first. Preparation keeps care continuous and safe.',
          sections: [
            {
              heading: 'Plan, prioritize, communicate',
              body: 'The agency uses an all-hazards plan, a patient acuity/priority system, and a communication plan to keep care going.',
              bullets: [
                'Know how patients are triaged by acuity (e.g., ventilator/oxygen-dependent first).',
                'Keep your contact info current and follow the call-down/communication plan.',
                'Help patients have an emergency kit and a backup plan for power and medications.',
              ],
              example: 'A regional power outage is forecast — high-acuity, oxygen-dependent patients are contacted and checked first.',
            },
          ],
          key_takeaways: [
            'Know your role in the all-hazards plan.',
            'High-acuity patients are prioritized during emergencies.',
            'Follow the communication plan to report status and needs.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'During a forecasted power outage, which patients are generally contacted first?',
        ['Patients closest to the office', 'High-acuity patients such as those dependent on oxygen or a ventilator', 'Patients with the most recent admission'],
        1,
        'Patient prioritization is based on acuity and risk, not convenience.',
      ),
      tf('Keeping your contact information current helps the agency reach you during the emergency communication plan.', true, 'Current contact info is essential for call-down/communication during emergencies.'),
      multi(
        'What belongs in helping a patient prepare for emergencies? Select all that apply.',
        ['A backup plan for power-dependent equipment', 'A medication and supply reserve', 'Ignoring the agency plan and improvising', 'Knowing who to call for help'],
        [0, 1, 3],
        'Preparation includes power backup, medication reserves, and clear contacts — not improvising.',
      ),
    ],
  },

  // 5. OSHA / Bloodborne Pathogens ------------------------------------------
  {
    key: 'osha_bbp',
    title: 'Annual Workplace Safety, Hazard Communication & Bloodborne Pathogens',
    short_description: 'OSHA HazCom, exposure control, and TB/HIV/Hepatitis basics.',
    description:
      'Required annual OSHA training covering Hazard Communication (29 CFR §1910.1200), the Bloodborne Pathogen Standard (29 CFR §1910.1030), sharps safety, and TB/HIV/Hepatitis exposure follow-up.',
    category: 'safety',
    business_line_scope: COMMON,
    employee_audience: 'All staff with occupational exposure risk',
    purpose: 'Reduce exposure and injury risk and ensure proper post-exposure follow-up.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'PT', 'OT', 'SLP'],
    estimated_minutes: 30,
    learning_objectives: [
      'Apply the exposure control plan and safe sharps handling.',
      'Know the steps to take after a bloodborne pathogen exposure.',
      'Locate and use Safety Data Sheets and hazard labels.',
    ],
    modules: [
      {
        title: 'Exposure control and hazard communication',
        content_json: {
          intro: 'Field staff face sharps, chemicals, and infectious exposures without a hospital safety team nearby — so the plan must be second nature.',
          sections: [
            {
              heading: 'Bloodborne pathogens and sharps',
              body: 'Treat all blood/body fluids as infectious. Use safe sharps devices and never recap needles by hand.',
              bullets: [
                'Activate the sharps safety feature and dispose in an approved container.',
                'Use standard precautions and PPE based on exposure risk.',
                'After an exposure: wash/flush the area, report immediately, and follow the post-exposure protocol.',
              ],
              example: 'After a needlestick, wash the site, report it right away, and begin the post-exposure evaluation per policy.',
            },
            {
              heading: 'Hazard communication (HazCom)',
              body: 'Chemicals like cleaners and disinfectants have hazards. Labels and Safety Data Sheets tell you how to use them safely.',
              bullets: [
                'Read the label and SDS before using a chemical.',
                'Store and use chemicals as directed; keep them away from patients and children.',
                'Know where to find SDS information for products you use.',
              ],
              example: 'Before using a strong disinfectant, check the SDS for ventilation and PPE requirements.',
            },
          ],
          key_takeaways: [
            'Use safe sharps devices and never hand-recap needles.',
            'After exposure: wash, report immediately, follow the protocol.',
            'Read labels and SDS before using any chemical.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'What is the correct sequence after a needlestick injury?',
        ['Finish the visit, then mention it next week', 'Wash/flush the area, report immediately, follow the post-exposure protocol', 'Recap the needle and continue'],
        1,
        'Immediate washing, prompt reporting, and following the protocol allow timely post-exposure care.',
      ),
      tf('You should read the label and Safety Data Sheet before using a new disinfectant.', true, 'SDS and labels describe hazards, PPE, and safe use.'),
      multi(
        'Which are safe sharps practices? Select all that apply.',
        ['Activate the safety feature on the device', 'Recap needles by hand to be tidy', 'Dispose in an approved sharps container', 'Treat all blood as potentially infectious'],
        [0, 2, 3],
        'Safe sharps handling avoids hand-recapping and uses approved containers and standard precautions.',
      ),
    ],
  },

  // 6. Patient Rights & Advance Directives ----------------------------------
  {
    key: 'patient_rights',
    title: 'Annual Patient Rights & Advance Directives',
    short_description: 'Patient rights, informed consent, and advance directives.',
    description:
      'Required annual education on the patient Bill of Rights, informed consent, advance directives (living wills, healthcare POA, POLST), and the grievance process (42 CFR §484.50 / §418.52).',
    category: 'compliance',
    business_line_scope: COMMON,
    employee_audience: 'All patient-facing staff',
    purpose: 'Protect patient autonomy, dignity, and the right to make care decisions.',
    role_targets: ['RN', 'LPN', 'MSW', 'intake staff', 'PT', 'OT', 'SLP'],
    estimated_minutes: 25,
    learning_objectives: [
      'Describe core patient rights and the grievance process.',
      'Explain advance directives and how to honor them.',
      'Support informed consent and the right to refuse care.',
    ],
    modules: [
      {
        title: 'Honoring rights and choices',
        content_json: {
          intro: 'Patients keep their rights at home: to be informed, to choose, to refuse, and to be treated with dignity.',
          sections: [
            {
              heading: 'Rights and grievances',
              body: 'Patients must be informed of their rights and given a way to voice concerns without fear of retaliation.',
              bullets: [
                'Provide rights information and the grievance/complaint process at admission.',
                'Respect privacy, dignity, and the right to participate in care planning.',
                'Never retaliate against a patient who files a complaint.',
              ],
              example: 'A patient wants to file a complaint — give them the grievance process and reassure them care will not be affected.',
            },
            {
              heading: 'Advance directives and consent',
              body: 'Advance directives (living will, healthcare POA, POLST/DNR) state a patient’s wishes. Staff must know and follow them.',
              bullets: [
                'Confirm whether an advance directive or code status exists and is in the record.',
                'Support informed consent — patients may accept or refuse care.',
                'Escalate questions about directives to the RN/provider; do not assume.',
              ],
              example: 'A patient with a DNR experiences a cardiac event — staff follow the documented wishes and agency protocol.',
            },
          ],
          key_takeaways: [
            'Patients have the right to be informed, choose, and refuse.',
            'Know and honor advance directives and code status.',
            'Never retaliate for a complaint or grievance.',
          ],
        },
      },
    ],
    questions: [
      tf('A patient has the right to refuse a treatment even if staff disagree.', true, 'Competent patients may accept or refuse care as part of their rights.'),
      mcq(
        'What should you do when a patient wants to file a grievance?',
        ['Discourage it to avoid paperwork', 'Provide the grievance process and reassure them care will not be affected', 'Tell them complaints are not allowed'],
        1,
        'Patients must be able to voice concerns without retaliation.',
      ),
      mcq(
        'Which document states a patient’s wishes about life-sustaining treatment?',
        ['A visit note', 'An advance directive such as a living will or POLST/DNR', 'A supply order'],
        1,
        'Advance directives document the patient’s wishes and must be honored.',
      ),
    ],
  },

  // 7. Corporate Compliance / Fraud & Abuse ---------------------------------
  {
    key: 'compliance_fraud',
    title: 'Annual Corporate Compliance, Fraud & Abuse Prevention',
    short_description: 'False Claims Act, anti-kickback, and your duty to report.',
    description:
      'Required annual corporate compliance training covering the False Claims Act (31 USC §3729), Anti-Kickback Statute, OIG guidance, documentation that supports claims, and whistleblower protections.',
    category: 'compliance',
    business_line_scope: COMMON,
    employee_audience: 'All staff',
    purpose: 'Prevent fraud and billing errors and protect those who report concerns.',
    role_targets: ['RN', 'LPN', 'office staff', 'billing', 'leadership', 'home health aide', 'hospice aide'],
    estimated_minutes: 25,
    learning_objectives: [
      'Recognize common fraud and billing-compliance risks in home care.',
      'Explain how accurate documentation supports honest claims.',
      'Use compliance reporting channels and whistleblower protections.',
    ],
    modules: [
      {
        title: 'Doing it right, and speaking up',
        content_json: {
          intro: 'Honest care and honest billing go hand in hand. Accurate documentation is the foundation of a compliant claim.',
          sections: [
            {
              heading: 'Fraud and abuse basics',
              body: 'The False Claims Act, Anti-Kickback Statute, and Stark Law prohibit false billing and improper inducements.',
              bullets: [
                'Bill only for visits and services that actually occurred and were medically necessary.',
                'Do not accept or offer anything of value for referrals.',
                'Documentation must match the services billed.',
              ],
              example: 'A visit was scheduled but not completed — it must not be documented or billed as done.',
            },
            {
              heading: 'Your duty to report',
              body: 'If you see something wrong, report it through the compliance line. Good-faith reporting is protected.',
              bullets: [
                'Use the agency compliance hotline or compliance officer.',
                'Whistleblowers are protected from retaliation.',
                'Ask questions when unsure — mistakes corrected early prevent bigger problems.',
              ],
              example: 'You notice notes that do not match the care given — report it through the compliance channel.',
            },
          ],
          key_takeaways: [
            'Bill only for services actually provided and medically necessary.',
            'Documentation must support the claim.',
            'Report concerns; whistleblowers are protected.',
          ],
        },
      },
    ],
    questions: [
      tf('Documentation must accurately reflect the services that were actually provided.', true, 'Claims must be supported by accurate documentation.'),
      mcq(
        'What should you do if you notice possible billing fraud?',
        ['Ignore it — it is not your job', 'Report it through the agency compliance channel', 'Confront the billing department alone'],
        1,
        'Reporting through the compliance channel is the correct, protected path.',
      ),
      multi(
        'Which are compliance risks to avoid? Select all that apply.',
        ['Billing for a visit that did not happen', 'Accepting gifts in exchange for referrals', 'Documenting care accurately', 'Notes that do not match services billed'],
        [0, 1, 3],
        'Accurate documentation is good; false billing, kickbacks, and mismatched notes are violations.',
      ),
    ],
  },

  // 8. Workplace Violence Prevention ----------------------------------------
  {
    key: 'workplace_violence',
    title: 'Annual Workplace Violence Prevention & Personal Safety',
    short_description: 'Staying safe on home visits: de-escalation and exit strategies.',
    description:
      'Required annual training on workplace violence risk in the home setting, de-escalation, lone-worker safety, and incident reporting (OSHA General Duty Clause; TJC standards).',
    category: 'safety',
    business_line_scope: COMMON,
    employee_audience: 'All staff, especially field clinicians',
    purpose: 'Protect staff during home visits through awareness, de-escalation, and safe exits.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'PT', 'OT', 'SLP', 'MSW'],
    estimated_minutes: 25,
    learning_objectives: [
      'Recognize warning signs of escalating behavior in the home.',
      'Use basic de-escalation and safe-exit strategies.',
      'Apply lone-worker safety practices and report incidents.',
    ],
    modules: [
      {
        title: 'Personal safety in the field',
        content_json: {
          intro: 'Field staff work alone in homes and neighborhoods. Awareness and a plan keep you safe.',
          sections: [
            {
              heading: 'Recognize and de-escalate',
              body: 'Watch for raised voices, agitation, weapons, intoxication, or aggressive pets. Stay calm and keep a clear path out.',
              bullets: [
                'Position yourself near an exit; do not let anyone block your path.',
                'Use a calm voice, simple words, and avoid arguing.',
                'Leave immediately if you feel unsafe — your safety comes first.',
              ],
              example: 'A family member becomes aggressive and blocks the door — de-escalate, then leave and call for help if needed.',
            },
            {
              heading: 'Lone-worker safety',
              body: 'Plan visits, share your schedule, and trust your instincts in unfamiliar areas.',
              bullets: [
                'Keep your phone charged and let the office know your route when needed.',
                'Park for a quick exit and stay aware of your surroundings.',
                'Report all threats and incidents so the agency can act.',
              ],
              example: 'You feel unsafe approaching a home — leave the area and contact the office before proceeding.',
            },
          ],
          key_takeaways: [
            'Keep a clear exit and never let it be blocked.',
            'Your safety comes first — leave if you feel unsafe.',
            'Report every threat and incident.',
          ],
        },
      },
    ],
    questions: [
      tf('If you feel unsafe during a visit, it is appropriate to leave and seek help.', true, 'Staff safety comes first; leaving an unsafe situation is appropriate.'),
      mcq(
        'Where should you position yourself when behavior begins to escalate?',
        ['Deep inside the home away from doors', 'Near an exit with a clear path out', 'Between two agitated people'],
        1,
        'Maintaining a clear exit path is a core personal-safety strategy.',
      ),
      multi(
        'Which are good lone-worker safety practices? Select all that apply.',
        ['Keep your phone charged', 'Park for a quick exit', 'Ignore your instincts about a situation', 'Report threats and incidents'],
        [0, 1, 3],
        'Preparation, situational awareness, and reporting all support lone-worker safety.',
      ),
    ],
  },

  // 9. Body Mechanics / Safe Patient Handling -------------------------------
  {
    key: 'body_mechanics',
    title: 'Annual Body Mechanics & Safe Patient Handling',
    short_description: 'Protecting your back and your patient during transfers.',
    description:
      'Required annual training on body mechanics, safe transfers and repositioning in the home, use of gait belts and assistive devices, and injury prevention without hospital equipment.',
    category: 'safety',
    business_line_scope: COMMON,
    employee_audience: 'All staff performing patient care activities',
    purpose: 'Prevent staff injury and keep patients safe during movement and transfers.',
    role_targets: ['RN', 'LPN', 'home health aide', 'hospice aide', 'PT', 'OT'],
    estimated_minutes: 20,
    learning_objectives: [
      'Apply proper body mechanics during lifts and transfers.',
      'Use gait belts and assistive devices appropriately.',
      'Know when to stop and get help or equipment.',
    ],
    modules: [
      {
        title: 'Move safely, every time',
        content_json: {
          intro: 'Without hospital lifts, home care relies on good technique, the right devices, and knowing your limits.',
          sections: [
            {
              heading: 'Core body mechanics',
              body: 'Use your legs, keep loads close, and avoid twisting. Plan the move before you start.',
              bullets: [
                'Bend at the knees and hips, not the back; keep the patient close to your body.',
                'Use a gait belt and assistive devices for transfers; never lift more than you safely can.',
                'Tell the patient the plan and move on a count to coordinate.',
              ],
              example: 'Before a bed-to-chair transfer, clear the path, lock the wheelchair, apply the gait belt, and lift with your legs.',
            },
            {
              heading: 'Know your limits',
              body: 'If a transfer is unsafe, stop and get help or equipment rather than risking injury.',
              bullets: [
                'Request additional help or equipment for heavy or difficult transfers.',
                'Report any strain or injury promptly.',
                'Reassess the home setup for safer future transfers.',
              ],
              example: 'A patient is heavier than expected and the move feels unsafe — stop, reposition, and arrange help or a device.',
            },
          ],
          key_takeaways: [
            'Lift with your legs and keep the load close.',
            'Use gait belts and assistive devices.',
            'Stop and get help when a transfer is unsafe.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'What is correct body mechanics for a transfer?',
        ['Bend at the waist and twist to move the patient', 'Bend at the knees and hips, keep the patient close, avoid twisting', 'Lift quickly with your back to save time'],
        1,
        'Using the legs and keeping loads close prevents back injury.',
      ),
      tf('If a transfer feels unsafe, it is appropriate to stop and get help or equipment.', true, 'Knowing your limits prevents staff and patient injury.'),
      multi(
        'Which support safe patient handling? Select all that apply.',
        ['Use a gait belt', 'Clear and plan the path before moving', 'Twist your spine during the lift', 'Coordinate the move on a count'],
        [0, 1, 3],
        'Devices, planning, and coordinated movement keep transfers safe; twisting causes injury.',
      ),
    ],
  },

  // 10. Aide Annual Competency & In-Service (HH + Hospice aides) -------------
  {
    key: 'aide_inservice',
    title: 'Annual Home Health & Hospice Aide Competency & In-Service',
    short_description: 'Aide scope, the 12-hour annual in-service, and supervision.',
    description:
      'Required annual aide education covering scope of services, the 12-hour annual in-service requirement, competency evaluation, care-plan tasks, and supervisory visit expectations (42 CFR §484.80 / §418.76).',
    category: 'home_health',
    business_line_scope: COMMON,
    employee_audience: 'Home health and hospice aides',
    purpose: 'Keep aides competent, in-scope, and supported under required supervision.',
    role_targets: ['home health aide', 'hospice aide', 'CNA'],
    estimated_minutes: 30,
    learning_objectives: [
      'Describe the aide scope of services and the care plan/assignment sheet.',
      'Explain the 12-hour annual in-service and competency requirements.',
      'Recognize supervisory visit expectations and when to report changes.',
    ],
    modules: [
      {
        title: 'Aide role, scope, and supervision',
        content_json: {
          intro: 'Aides provide vital hands-on care. Staying in scope, competent, and communicating changes protects patients and the agency.',
          sections: [
            {
              heading: 'Scope and the care plan',
              body: 'Aides follow the written aide care plan/assignment sheet and stay within their trained scope.',
              bullets: [
                'Perform only the tasks listed on the aide care plan.',
                'Never change medications or perform tasks outside your scope.',
                'Report changes in the patient’s condition to the nurse promptly.',
              ],
              example: 'A patient asks the aide to adjust a medication — the aide declines (out of scope) and notifies the nurse.',
            },
            {
              heading: 'In-service hours and supervision',
              body: 'Aides must complete 12 hours of in-service per year and have periodic supervisory visits and competency checks.',
              bullets: [
                'Complete the required 12 annual in-service hours.',
                'Participate in supervisory visits (e.g., every 14 days for hospice/HH aides per policy).',
                'Demonstrate competencies when evaluated.',
              ],
              example: 'During a supervisory visit, the RN observes the aide’s technique and confirms competency.',
            },
          ],
          key_takeaways: [
            'Follow the aide care plan and stay in scope.',
            'Complete 12 in-service hours each year.',
            'Report condition changes to the nurse right away.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'How many hours of in-service are aides required to complete each year?',
        ['4 hours', '12 hours', 'None'],
        1,
        'CMS requires 12 hours of aide in-service per year.',
      ),
      tf('An aide may adjust a patient’s medication if the family asks.', false, 'Medication changes are outside the aide scope; the aide should notify the nurse.'),
      multi(
        'What is part of the aide role? Select all that apply.',
        ['Follow the aide care plan', 'Report condition changes to the nurse', 'Perform tasks outside your trained scope', 'Participate in supervisory visits'],
        [0, 1, 3],
        'Aides work within scope, communicate changes, and take part in supervision.',
      ),
    ],
  },

  // 11. OASIS & Homebound Documentation (HH nurses/clinicians) --------------
  {
    key: 'oasis_homebound',
    title: 'Annual OASIS Accuracy & Homebound Documentation (Home Health)',
    short_description: 'OASIS accuracy and defensible homebound documentation.',
    description:
      'Required annual home health clinician education on OASIS-E assessment accuracy, comprehensive assessment timing, and documenting Medicare homebound status (42 CFR §484.55 / §409.42).',
    category: 'documentation',
    business_line_scope: HH,
    employee_audience: 'Home health clinicians completing OASIS and visit documentation',
    purpose: 'Improve OASIS accuracy and defensible homebound documentation to support quality and payment.',
    role_targets: ['RN', 'PT', 'OT', 'SLP'],
    estimated_minutes: 35,
    learning_objectives: [
      'Apply OASIS scoring conventions for accurate, supportable answers.',
      'Document homebound status clearly at the appropriate visits.',
      'Connect documentation to quality measures and claim defensibility.',
    ],
    modules: [
      {
        title: 'OASIS accuracy and homebound status',
        content_json: {
          intro: 'OASIS drives quality scores and payment, and homebound status supports eligibility. Both depend on clear, consistent documentation.',
          sections: [
            {
              heading: 'Accurate OASIS',
              body: 'Score what you assess using OASIS conventions, and make sure the clinical record supports each response.',
              bullets: [
                'Assess the patient’s usual status during the assessment time frame, per item guidance.',
                'Ensure visit notes support OASIS responses (no contradictions).',
                'Complete the comprehensive assessment within required timeframes (e.g., SOC within 5 days).',
              ],
              example: 'If you score a patient as needing assistance with transfers, the visit note should reflect that same level of assistance.',
            },
            {
              heading: 'Homebound documentation',
              body: 'Medicare requires documenting why leaving home requires considerable and taxing effort, at each visit.',
              bullets: [
                'Describe the specific reason and effort, not just the phrase "homebound."',
                'Note assistive devices, assistance needed, and limits on absences.',
                'Weak homebound documentation is a common cause of claim denials.',
              ],
              example: 'Instead of "homebound," document "requires a walker and the assistance of one person; becomes short of breath after 20 feet."',
            },
          ],
          key_takeaways: [
            'OASIS answers must be supported by the visit record.',
            'Document homebound status specifically at each visit.',
            'Accurate documentation protects quality scores and payment.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'Which is the strongest homebound documentation?',
        ['Patient is homebound.', 'Patient requires a walker and assistance of one; becomes short of breath after 20 feet.', 'Patient stays home most days.'],
        1,
        'Specific, objective effort and assistance support homebound status; the bare term does not.',
      ),
      tf('Visit notes should support the OASIS responses without contradicting them.', true, 'OASIS accuracy requires consistency between the assessment and the clinical record.'),
      scenario(
        'Your OASIS scores the patient as needing maximal transfer assistance, but the prior visit note says the patient transfers independently. What is the concern and how do you resolve it?',
        'Responses should identify the contradiction, the need to reassess/clarify, and align documentation with actual status.',
        'Full credit when the learner identifies the inconsistency, reassesses or clarifies the patient’s true status, and aligns OASIS and the note so they support each other.',
      ),
    ],
  },

  // 12. Hospice Philosophy & Levels of Care ---------------------------------
  {
    key: 'hospice_philosophy',
    title: 'Annual Hospice Philosophy, Levels of Care & Eligibility',
    short_description: 'Comfort-focused care, the four levels, and eligibility basics.',
    description:
      'Required annual hospice education on the interdisciplinary philosophy, four levels of care, eligibility and the six-month prognosis, and goals-of-care communication (42 CFR §418.22 / §418.52).',
    category: 'hospice',
    business_line_scope: HOSPICE,
    employee_audience: 'All hospice staff',
    purpose: 'Align the team around comfort-focused, goal-directed hospice care.',
    role_targets: ['RN', 'LPN', 'hospice aide', 'MSW', 'chaplain', 'volunteer coordinator'],
    estimated_minutes: 30,
    learning_objectives: [
      'Explain hospice philosophy and the interdisciplinary team approach.',
      'Identify the four levels of hospice care.',
      'Describe eligibility and goals-of-care communication.',
    ],
    modules: [
      {
        title: 'What hospice is, in practice',
        content_json: {
          intro: 'Hospice focuses on comfort, dignity, and the goals that matter most to the patient and family.',
          sections: [
            {
              heading: 'Philosophy and levels of care',
              body: 'An interdisciplinary team supports the patient and family. There are four levels of hospice care.',
              bullets: [
                'Routine home care, continuous home care, inpatient respite, and general inpatient.',
                'Care is comfort-focused, not curative, and aligned to patient goals.',
                'The interdisciplinary team includes nursing, aide, social work, chaplaincy, and volunteers.',
              ],
              example: 'When symptoms cannot be managed at home, general inpatient care may be appropriate until they are controlled.',
            },
            {
              heading: 'Eligibility and communication',
              body: 'Eligibility rests on a prognosis of six months or less if the illness runs its usual course, with recertification over time.',
              bullets: [
                'Support certification/recertification by documenting decline.',
                'Communicate goals of care with compassion and clarity.',
                'Involve the RN/provider when families request changes in approach.',
              ],
              example: 'A family asks about hospital transfer for every symptom — explain the comfort-focused approach and address symptoms first.',
            },
          ],
          key_takeaways: [
            'Hospice is comfort-focused and goal-directed.',
            'There are four levels of hospice care.',
            'Eligibility is based on a six-month prognosis with recertification.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'Which best reflects hospice philosophy?',
        ['Aggressive curative treatment is the main goal', 'Comfort, dignity, and patient goals of care are the focus', 'Transfer to the hospital for every new symptom'],
        1,
        'Hospice centers on comfort, dignity, and patient goals.',
      ),
      mcq(
        'Which is one of the four levels of hospice care?',
        ['Outpatient surgery', 'General inpatient care', 'Skilled rehab admission'],
        1,
        'The four levels are routine home, continuous home, inpatient respite, and general inpatient.',
      ),
      multi(
        'Who is part of the hospice interdisciplinary team? Select all that apply.',
        ['Nurse', 'Aide', 'Social worker', 'Billing auditor'],
        [0, 1, 2],
        'The IDT includes nursing, aide, social work, chaplaincy, and volunteers.',
      ),
    ],
  },

  // 13. Hospice Pain & Symptom Management (hospice nurses) -------------------
  {
    key: 'hospice_pain',
    title: 'Annual Hospice Pain & Symptom Management at End of Life',
    short_description: 'Assessing pain, managing symptoms, and supporting families.',
    description:
      'Required annual hospice clinical education on comprehensive pain assessment, opioid safety, common end-of-life symptoms, escalation, and compassionate family communication (42 CFR §418.54 / §418.106).',
    category: 'hospice',
    business_line_scope: HOSPICE,
    employee_audience: 'Hospice nursing staff',
    purpose: 'Support consistent, safe symptom management and family communication at end of life.',
    role_targets: ['RN', 'LPN'],
    estimated_minutes: 35,
    learning_objectives: [
      'Perform a comprehensive pain and symptom assessment.',
      'Apply opioid safety and escalation when symptoms are uncontrolled.',
      'Communicate calmly with families about end-of-life changes.',
    ],
    modules: [
      {
        title: 'Assess, treat, escalate, support',
        content_json: {
          intro: 'Hospice nurses lead symptom relief. Clear assessment, safe medication use, and timely escalation keep patients comfortable.',
          sections: [
            {
              heading: 'Pain and symptom assessment',
              body: 'Assess pain and other symptoms (dyspnea, nausea, agitation) and document response to interventions.',
              bullets: [
                'Use a consistent pain scale and reassess after interventions.',
                'Apply opioid safety: right dose, monitor for response and side effects, bowel regimen.',
                'Escalate to the provider when symptoms remain uncontrolled.',
              ],
              example: 'Morphine was given for severe pain; 30 minutes later pain is still severe — document the response and escalate per protocol.',
            },
            {
              heading: 'End-of-life changes and family support',
              body: 'Common changes (noisy breathing, decreased intake, restlessness) frighten families. Calm education helps.',
              bullets: [
                'Explain expected changes in plain language and what to watch for.',
                'Reinforce comfort measures and the care plan.',
                'Escalate distress that appears uncontrolled.',
              ],
              example: 'A family fears the patient is suffering from noisy breathing — provide calm education and adjust comfort measures as ordered.',
            },
          ],
          key_takeaways: [
            'Assess and reassess; document response to interventions.',
            'Use opioid safety and escalate uncontrolled symptoms.',
            'Support families with calm, plain-language education.',
          ],
        },
      },
    ],
    questions: [
      tf('If a symptom remains uncontrolled after an intervention, the nurse should document and escalate per protocol.', true, 'Uncontrolled symptoms require reassessment and escalation.'),
      mcq(
        'Which is part of safe opioid use in hospice?',
        ['Skip reassessment after dosing', 'Monitor response and side effects and maintain a bowel regimen', 'Avoid documenting the dose given'],
        1,
        'Opioid safety includes monitoring, reassessment, and a bowel regimen.',
      ),
      scenario(
        'A patient remains in distress after the ordered comfort measure was given. What are your next steps and how do you document them?',
        'Responses should include reassessment, escalation to the provider, and clear documentation of the medication and patient response.',
        'Full credit when the learner reassesses, escalates to the appropriate clinician/provider, and documents what was given and how the patient responded.',
      ),
    ],
  },

  // 14. Medication Management & Safety (nurses, both lines) ------------------
  {
    key: 'medication_safety',
    title: 'Annual Medication Management & Safety (Nurses)',
    short_description: 'Reconciliation, high-alert meds, and safe home administration.',
    description:
      'Required annual nursing education on medication reconciliation, high-alert and look-alike/sound-alike drugs, controlled-substance handling, and patient/caregiver teaching in the home (42 CFR §484.60 / §418.106).',
    category: 'clinical',
    business_line_scope: COMMON,
    employee_audience: 'Licensed nursing staff',
    purpose: 'Reduce medication errors and adverse events in the home setting.',
    role_targets: ['RN', 'LPN'],
    estimated_minutes: 30,
    learning_objectives: [
      'Perform accurate medication reconciliation.',
      'Apply extra safeguards for high-alert and controlled medications.',
      'Teach patients and caregivers safe medication practices.',
    ],
    modules: [
      {
        title: 'Safe medications at home',
        content_json: {
          intro: 'In the home, the nurse is often the safety net for medication accuracy and teaching.',
          sections: [
            {
              heading: 'Reconciliation and high-alert drugs',
              body: 'Reconcile the full medication list each visit and apply extra checks to high-alert drugs.',
              bullets: [
                'Compare ordered meds to what the patient is actually taking; resolve discrepancies.',
                'Use independent double-checks for high-alert drugs (e.g., insulin, anticoagulants, opioids).',
                'Watch for look-alike/sound-alike errors and duplicate therapy.',
              ],
              example: 'The patient is taking an old and a new blood thinner — identify the duplication and notify the provider immediately.',
            },
            {
              heading: 'Controlled substances and teaching',
              body: 'Handle controlled substances per policy and teach safe storage, use, and disposal.',
              bullets: [
                'Document controlled-substance counts and follow secure storage guidance.',
                'Teach the "five rights" and how to recognize side effects.',
                'Educate on safe storage away from children and proper disposal.',
              ],
              example: 'Teach a caregiver to store opioids securely and how to dispose of unused medication safely.',
            },
          ],
          key_takeaways: [
            'Reconcile medications every visit and resolve discrepancies.',
            'Double-check high-alert medications.',
            'Teach safe storage, use, and disposal.',
          ],
        },
      },
    ],
    questions: [
      mcq(
        'You find the patient is taking two different blood thinners. What is the best action?',
        ['Assume it is intentional and continue', 'Identify the duplication and notify the provider', 'Tell the patient to pick one'],
        1,
        'Duplicate anticoagulation is a high-alert safety risk that requires provider notification.',
      ),
      tf('High-alert medications such as insulin and anticoagulants warrant extra verification.', true, 'High-alert drugs carry higher harm risk and benefit from additional checks.'),
      multi(
        'Which support medication safety in the home? Select all that apply.',
        ['Reconcile the full medication list', 'Teach safe storage and disposal', 'Ignore look-alike/sound-alike risks', 'Resolve discrepancies with the provider'],
        [0, 1, 3],
        'Reconciliation, teaching, and resolving discrepancies reduce errors; ignoring LASA risk does not.',
      ),
    ],
  },
];

// ───────────────────────────────────────────────────────────────────────────
// ROLE-BASED ANNUAL LEARNING PLANS
// ───────────────────────────────────────────────────────────────────────────
const CORE_ALL = [
  'infection_control',
  'hipaa',
  'abuse_neglect',
  'emergency_prep',
  'osha_bbp',
  'patient_rights',
  'compliance_fraud',
  'workplace_violence',
  'body_mechanics',
];

const plans = [
  {
    name: 'Penn Home Health — Annual Required In-Services (All Staff)',
    business_line_scope: HH,
    description: 'Yearly required in-services for all Penn Home Health staff.',
    courseKeys: [...CORE_ALL, 'aide_inservice'],
  },
  {
    name: 'Penn Home Health — Annual Required In-Services (Nurses)',
    business_line_scope: HH,
    description: 'Yearly required in-services for Penn Home Health nurses and clinicians.',
    courseKeys: [...CORE_ALL, 'oasis_homebound', 'medication_safety'],
  },
  {
    name: 'Penn Hospice — Annual Required In-Services (All Staff)',
    business_line_scope: HOSPICE,
    description: 'Yearly required in-services for all Penn Hospice staff.',
    courseKeys: [...CORE_ALL, 'aide_inservice', 'hospice_philosophy'],
  },
  {
    name: 'Penn Hospice — Annual Required In-Services (Nurses)',
    business_line_scope: HOSPICE,
    description: 'Yearly required in-services for Penn Hospice nurses.',
    courseKeys: [...CORE_ALL, 'hospice_philosophy', 'hospice_pain', 'medication_safety'],
  },
];

// ───────────────────────────────────────────────────────────────────────────
// PROFESSIONAL ENRICHMENT (keyed by course key)
// These fields power the course intro screen's "Why this matters", "Regulatory
// Requirements Addressed", and "Skills You Will Demonstrate" sections, so every
// seeded in-service renders with the full professional treatment. They are
// additive: re-running the seed backfills them on previously-seeded courses
// without touching lessons, questions, or any other content.
// ───────────────────────────────────────────────────────────────────────────
const reg = (regulation, title, how) => ({ regulation, title, how_this_course_addresses_it: how });
const skill = (skill, criteria) => ({ skill, criteria });

const ENRICHMENT = {
  infection_control: {
    real_world_relevance:
      'Infection prevention is one of the most frequently cited survey deficiencies in home care, and a single lapse in a patient home can lead to serious, avoidable harm.',
    regulatory_crosswalk: [
      reg('42 CFR §484.70', 'HH Condition of Participation: Infection prevention & control', 'Reinforces standard precautions, hand hygiene, and PPE use on every visit.'),
      reg('42 CFR §418.60', 'Hospice CoP: Infection control', 'Applies the same prevention standards to the hospice setting.'),
    ],
    competency_skills: [
      skill('Perform hand hygiene at the right moments', 'Demonstrates hand hygiene before and after patient contact and after PPE removal.'),
      skill('Select and doff PPE safely', 'Chooses task-appropriate PPE and removes it without self-contamination.'),
    ],
  },
  hipaa: {
    real_world_relevance:
      'Most reportable breaches in home care come from everyday mistakes — a lost device, a misdirected fax, or a conversation overheard in a patient home.',
    regulatory_crosswalk: [
      reg('45 CFR §164.530', 'HIPAA Privacy Rule: Administrative requirements', 'Covers minimum necessary use and safeguarding PHI in the field.'),
      reg('45 CFR §164.312', 'HIPAA Security Rule: Technical safeguards', 'Reinforces device security, access controls, and breach reporting.'),
    ],
    competency_skills: [
      skill('Apply the minimum-necessary standard', 'Accesses and shares only the PHI needed for the task at hand.'),
      skill('Recognize and report a potential breach', 'Identifies a privacy incident and escalates it per agency policy without delay.'),
    ],
  },
  abuse_neglect: {
    real_world_relevance:
      'Home care staff are often the only outside eyes on a vulnerable patient, making prompt recognition and reporting of abuse or neglect a life-safety responsibility.',
    regulatory_crosswalk: [
      reg('42 CFR §484.50', 'HH CoP: Patient rights — freedom from abuse & neglect', 'Defines the duty to recognize and report mistreatment.'),
      reg('State APS law', 'Adult Protective Services mandatory reporting', 'Explains who, what, and when to report under state law.'),
    ],
    competency_skills: [
      skill('Recognize indicators of abuse, neglect, or exploitation', 'Identifies physical, behavioral, and environmental warning signs.'),
      skill('Report a concern correctly and promptly', 'Documents objective findings and notifies the right parties within required timeframes.'),
    ],
  },
  emergency_prep: {
    real_world_relevance:
      'When a disaster hits, the plan you practiced is the plan you keep — knowing patient priority levels and your role ahead of time saves lives during an actual emergency.',
    regulatory_crosswalk: [
      reg('42 CFR §484.102', 'HH Emergency Preparedness Condition', 'Covers the emergency plan, communication, and patient triage roles.'),
      reg('42 CFR §418.113', 'Hospice Emergency Preparedness Condition', 'Applies preparedness requirements to hospice operations.'),
    ],
    competency_skills: [
      skill('Apply the agency emergency plan', 'States their role and the patient-priority tiers during an emergency.'),
      skill('Maintain communication during a disruption', 'Knows backup contact methods and reporting expectations.'),
    ],
  },
  osha_bbp: {
    real_world_relevance:
      'A needlestick or splash exposure in the home can have lifelong consequences; safe handling and a known exposure-response plan protect you on every visit.',
    regulatory_crosswalk: [
      reg('29 CFR §1910.1030', 'OSHA Bloodborne Pathogens Standard', 'Covers exposure control, safe sharps handling, and post-exposure steps.'),
      reg('29 CFR §1910.1200', 'OSHA Hazard Communication Standard', 'Reinforces safe handling and labeling of hazardous chemicals.'),
    ],
    competency_skills: [
      skill('Handle and dispose of sharps safely', 'Uses safe technique and an approved sharps container at point of care.'),
      skill('Respond correctly to an exposure', 'Initiates wash, report, and evaluation steps immediately after an exposure.'),
    ],
  },
  patient_rights: {
    real_world_relevance:
      'Honoring patient rights and advance directives is both an ethical duty and a frequent survey focus — patients must understand their choices and have them respected.',
    regulatory_crosswalk: [
      reg('42 CFR §484.50', 'HH CoP: Patient rights', 'Covers notice of rights, participation in care, and grievances.'),
      reg('42 CFR §489.100', 'Advance directive requirements', 'Explains documenting and honoring advance directives.'),
    ],
    competency_skills: [
      skill('Communicate patient rights clearly', 'Explains rights and the grievance process in plain language.'),
      skill('Honor advance directives', 'Confirms directive status and ensures care reflects the patient’s wishes.'),
    ],
  },
  compliance_fraud: {
    real_world_relevance:
      'Accurate documentation and honest billing protect both patients and the agency — most fraud findings trace back to records that did not match the care delivered.',
    regulatory_crosswalk: [
      reg('42 USC §1320a-7b', 'Anti-Kickback Statute', 'Explains prohibited inducements and referrals.'),
      reg('31 USC §3729', 'False Claims Act', 'Connects accurate documentation to compliant billing.'),
    ],
    competency_skills: [
      skill('Document to support the claim', 'Ensures the record reflects the care actually provided and its medical necessity.'),
      skill('Report a compliance concern', 'Uses the agency’s confidential, non-retaliatory reporting channel.'),
    ],
  },
  workplace_violence: {
    real_world_relevance:
      'Field clinicians enter unpredictable environments alone; reading early warning signs and having a personal-safety plan prevents most incidents before they escalate.',
    regulatory_crosswalk: [
      reg('OSHA General Duty Clause', 'Section 5(a)(1) — safe workplace', 'Supports the duty to protect staff from recognized hazards including violence.'),
      reg('OSHA 3148', 'Guidelines for preventing workplace violence for healthcare', 'Provides de-escalation and personal-safety expectations.'),
    ],
    competency_skills: [
      skill('Recognize escalation warning signs', 'Identifies environmental and behavioral cues that signal rising risk.'),
      skill('Execute a personal-safety plan', 'Uses de-escalation, exit awareness, and check-in procedures appropriately.'),
    ],
  },
  body_mechanics: {
    real_world_relevance:
      'Caregiver injuries from manual lifting are common and career-ending; safe handling technique protects both you and the patient on every transfer.',
    regulatory_crosswalk: [
      reg('OSHA General Duty Clause', 'Section 5(a)(1) — ergonomic hazards', 'Supports safe patient handling to prevent musculoskeletal injury.'),
      reg('CDC/NIOSH safe handling', 'Safe patient handling guidance', 'Reinforces assessment and assistive-device use before transfers.'),
    ],
    competency_skills: [
      skill('Assess before every transfer', 'Evaluates patient ability, equipment, and environment prior to moving a patient.'),
      skill('Apply safe handling technique', 'Uses neutral posture, assistive devices, and team lifts as indicated.'),
    ],
  },
  aide_inservice: {
    real_world_relevance:
      'Aides deliver the majority of hands-on care; the required 12 annual in-service hours keep core competencies sharp and observation-ready.',
    regulatory_crosswalk: [
      reg('42 CFR §484.80', 'HH aide training & competency', 'Covers the 12-hour annual in-service and competency expectations.'),
      reg('42 CFR §418.76', 'Hospice aide training & competency', 'Applies aide competency requirements to hospice.'),
    ],
    competency_skills: [
      skill('Demonstrate core personal-care skills', 'Performs ADL assistance safely and per the care plan.'),
      skill('Report changes in condition', 'Recognizes and reports patient changes to the supervising nurse.'),
    ],
  },
  oasis_homebound: {
    real_world_relevance:
      'OASIS accuracy and a defensible homebound narrative drive both payment and survey outcomes; small documentation gaps create large compliance and reimbursement risk.',
    regulatory_crosswalk: [
      reg('42 CFR §484.55', 'Comprehensive assessment of patients', 'Covers accurate, timely OASIS data collection.'),
      reg('Medicare homebound criteria', 'Eligibility & homebound status', 'Reinforces documenting both prongs of the homebound definition.'),
    ],
    competency_skills: [
      skill('Document a defensible homebound status', 'Captures both the taxing-effort and confinement criteria with specifics.'),
      skill('Score OASIS items accurately', 'Selects responses supported by objective assessment findings.'),
    ],
  },
  hospice_philosophy: {
    real_world_relevance:
      'Understanding the hospice benefit, levels of care, and eligibility keeps the team aligned on goals of care and protects the agency from eligibility-related denials.',
    regulatory_crosswalk: [
      reg('42 CFR §418.22', 'Certification of terminal illness', 'Connects eligibility and the six-month prognosis standard.'),
      reg('42 CFR §418.302', 'Hospice levels of care', 'Explains routine, continuous, respite, and general inpatient care.'),
    ],
    competency_skills: [
      skill('Apply the hospice philosophy of care', 'Frames interventions around comfort and patient/family goals.'),
      skill('Match needs to the right level of care', 'Identifies when a different level of care is indicated.'),
    ],
  },
  hospice_pain: {
    real_world_relevance:
      'Unrelieved pain at end of life is the symptom families remember most; skilled assessment and proactive management are central to quality hospice care.',
    regulatory_crosswalk: [
      reg('42 CFR §418.54', 'Comprehensive hospice assessment', 'Covers thorough symptom and pain assessment.'),
      reg('42 CFR §418.56', 'Interdisciplinary plan of care', 'Connects symptom management to the IDG plan of care.'),
    ],
    competency_skills: [
      skill('Assess pain and symptoms systematically', 'Uses an appropriate tool and documents response to interventions.'),
      skill('Manage symptoms proactively', 'Anticipates and adjusts the plan to prevent crises at end of life.'),
    ],
  },
  medication_safety: {
    real_world_relevance:
      'Medication errors and adverse drug events are a leading cause of avoidable hospitalization in home care; reconciliation and high-alert vigilance prevent harm.',
    regulatory_crosswalk: [
      reg('42 CFR §484.55', 'Drug regimen review', 'Covers identifying and reporting potential medication issues.'),
      reg('ISMP high-alert medications', 'Safe use of high-alert drugs', 'Reinforces extra safeguards for high-risk medications.'),
    ],
    competency_skills: [
      skill('Reconcile the medication list', 'Compares and resolves discrepancies across the patient’s medications.'),
      skill('Flag high-alert and interaction risks', 'Recognizes and escalates potential adverse drug events.'),
    ],
  },
};

// ───────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL CONTENT ENRICHMENT (keyed by course key)
// A realistic case scenario, a clinical pearl, a module summary, and self-check
// questions for each in-service. The lesson viewer renders all of these, so
// adding them turns plain text lessons into the kind of applied, professional
// in-service staff actually engage with. Merged into each course's first module
// and additively backfilled onto existing seeded courses (gaps only).
// ───────────────────────────────────────────────────────────────────────────
const cs = (title, patient_context, situation, challenge, guidance, what_could_go_wrong) =>
  ({ title, patient_context, situation, challenge, guidance, what_could_go_wrong });

const MODULE_ENRICHMENT = {
  infection_control: {
    summary: 'Consistent hand hygiene, task-matched PPE, and a clean field on every visit are the few habits that prevent most home-care infections.',
    clinical_pearl: 'If you change only one thing, make it hand hygiene at the right moments — it prevents more infections than any single piece of PPE.',
    check: ['At minimum, when should you perform hand hygiene during a visit?', 'How would you re-establish a clean field if your work surface became contaminated mid-task?'],
    case_scenario: cs(
      'A contaminated work surface',
      '78-year-old with a stage 3 sacral wound; cluttered home with indoor pets.',
      'You arrive for a scheduled dressing change and the only available surface is a cluttered side table covered in pet hair.',
      'How do you set up safely before starting wound care?',
      'Perform hand hygiene, lay down a clean barrier, organize clean supplies away from used items, and don task-appropriate PPE before opening the dressing kit.',
      'Starting on a contaminated surface to save time can introduce pathogens directly into an open wound.'
    ),
  },
  hipaa: {
    summary: 'Share only the minimum necessary, secure devices and conversations in the field, and report any suspected breach immediately.',
    clinical_pearl: "When unsure about sharing information, ask: does this person need this specific detail to care for this patient right now?",
    check: ['Explain the "minimum necessary" standard in your own words.', 'What is the first thing you should do if you realize a fax went to the wrong office?'],
    case_scenario: cs(
      'A misdirected fax',
      'Discharge summary containing diagnoses and a medication list.',
      'You notice the discharge summary was faxed to a number belonging to a former referral source, not the current physician.',
      'What do you do?',
      "Stop, report the disclosure through your agency's privacy channel right away, and follow breach-assessment procedures — do not try to quietly fix or hide it.",
      'Failing to report can turn a small, manageable disclosure into an unreported breach with regulatory consequences.'
    ),
  },
  abuse_neglect: {
    summary: 'Recognize the physical, behavioral, and environmental signs of mistreatment, document objectively, and report within required timeframes.',
    clinical_pearl: 'You do not have to prove abuse occurred — you are required to report a reasonable suspicion. When unsure, report.',
    check: ['Name two warning signs that should raise suspicion of neglect.', 'Who do you notify, and how quickly, when you suspect abuse?'],
    case_scenario: cs(
      'Unexplained bruising',
      '82-year-old living with an adult child who manages their finances and medications.',
      'You notice patterned bruising on both upper arms, and the patient becomes quiet and withdrawn when the caregiver enters the room.',
      'What is your responsibility?',
      'Document objective findings (location, pattern, patient demeanor) without accusation, ensure immediate safety, and report the suspicion to your supervisor and APS per state timeframes.',
      'Dismissing the signs as accidental without reporting leaves a vulnerable adult at continued risk.'
    ),
  },
  emergency_prep: {
    summary: "Know your role, your patients' priority tiers, and your backup communication plan before an emergency — not during one.",
    clinical_pearl: 'Patient acuity tiers exist so that when resources are stretched, the most vulnerable patients are reached first.',
    check: ['What is your role in the agency emergency plan?', 'If phones and internet are down, how do you reach the office?'],
    case_scenario: cs(
      'A regional power outage',
      'Your census includes an oxygen-dependent patient and an infusion patient.',
      'A storm knocks out power across the service area for an expected 24–48 hours.',
      'Which patients do you prioritize, and why?',
      "Follow the emergency plan's priority tiers — reach life-support-dependent patients (oxygen, infusion) first, confirm backup power and supplies, and report status through the designated channel.",
      'Visiting in routine order can delay help to a patient whose equipment fails without power.'
    ),
  },
  osha_bbp: {
    summary: 'Treat all blood and body fluids as infectious, use safe sharps technique, and know the wash-report-evaluate steps cold before you ever need them.',
    clinical_pearl: 'Activate the sharps safety feature and dispose at the point of care — most needlesticks happen during the walk to find a container.',
    check: ['What are the immediate steps after a needlestick exposure?', 'Where should a used needle be placed, and when?'],
    case_scenario: cs(
      'A needlestick during insulin administration',
      'Diabetic patient; cramped bedroom with poor lighting.',
      'While recapping a used insulin needle by hand, you sustain a needlestick to your finger.',
      'What do you do, in order?',
      'Wash the area with soap and water immediately, report the exposure to the office right away, and follow the post-exposure evaluation/prophylaxis protocol; never recap by hand.',
      'Delaying reporting can push you past the window where post-exposure prophylaxis is most effective.'
    ),
  },
  patient_rights: {
    summary: 'Patients have the right to understand their care, participate in decisions, voice grievances without fear, and have advance directives honored.',
    clinical_pearl: "An advance directive only protects a patient's wishes if the team knows it exists and it's in the record — confirm it on admission.",
    check: ['How would you explain the grievance process to a patient in plain language?', "What do you do if care seems to conflict with a patient's advance directive?"],
    case_scenario: cs(
      'An unhonored preference',
      'Patient with a documented DNR who is hospitalized frequently.',
      'During a visit, the patient says no one explained their right to refuse a recommended treatment.',
      'How do you respond?',
      'Acknowledge the concern, explain their rights and the grievance process, and ensure the care team and the record reflect their informed choices and advance directive.',
      'Proceeding without addressing the concern undermines informed consent and patient autonomy.'
    ),
  },
  compliance_fraud: {
    summary: 'Document the care you actually provided and its medical necessity; honest records are the foundation of compliant billing.',
    clinical_pearl: "If it wasn't documented, it wasn't done — and if it was billed but not documented, that's a compliance problem.",
    check: ['Why must documentation match the services billed?', 'Where do you take a compliance concern, and is it confidential?'],
    case_scenario: cs(
      'Pressure to upcode a visit',
      'Routine follow-up visit with no change in condition.',
      'A colleague suggests documenting a higher-complexity visit than what occurred to capture more reimbursement.',
      'What is the right action?',
      'Document only what was actually performed and medically necessary, decline to alter the record, and report the suggestion through the confidential compliance channel.',
      'Inflating documentation to support a higher claim can create false-claims liability for you and the agency.'
    ),
  },
  workplace_violence: {
    summary: 'Read the environment, recognize escalation early, and use de-escalation, exit awareness, and check-ins to stay safe in the field.',
    clinical_pearl: "Your safest move is often made before you enter — trust early warning signs and don't enter a situation you can't safely exit.",
    check: ['Name two early warning signs of escalating aggression.', 'What is your personal-safety plan if a visit feels unsafe?'],
    case_scenario: cs(
      'An escalating household',
      'Field visit to a home with a history of conflict between household members.',
      'On arrival you hear shouting inside, and a visibly agitated, intoxicated person answers the door.',
      'What do you do?',
      'Do not enter; keep a safe distance and an exit path, calmly disengage and leave, notify the office, and reschedule with a safety plan or escort as needed.',
      "Entering to 'just get the visit done' can place you in a situation with no safe exit."
    ),
  },
  body_mechanics: {
    summary: 'Assess the patient, equipment, and environment before every transfer, and use neutral posture and assistive devices instead of muscling the load.',
    clinical_pearl: 'If a transfer feels unsafe, it is — stop and get a device or a second person rather than risking a fall or a back injury.',
    check: ['What should you assess before initiating a transfer?', 'When is a mechanical lift or a second person indicated?'],
    case_scenario: cs(
      'A heavier-than-expected transfer',
      'Patient post-stroke with left-sided weakness; no caregiver present.',
      'The patient needs to move from bed to wheelchair but cannot bear weight as documented, and no transfer device is set up.',
      'How do you proceed?',
      'Reassess weight-bearing, position and lock the chair, use a gait belt with a device or schedule a two-person assist; never perform an unsafe solo lift.',
      'Attempting a solo manual lift can drop the patient and cause a career-ending back injury.'
    ),
  },
  aide_inservice: {
    summary: "Aides keep core personal-care skills sharp and observation-ready, and promptly report any change in a patient's condition to the supervising nurse.",
    clinical_pearl: 'Aides spend the most time with patients — your report of a small change is often the earliest warning the nurse gets.',
    check: ['Name a change in condition you would report to the nurse right away.', 'Which personal-care task are you most due to have observed for competency?'],
    case_scenario: cs(
      'A subtle change during personal care',
      'Elderly patient you assist with bathing three times weekly.',
      'During a bath you notice new redness over the tailbone and the patient seems more confused than usual.',
      'What do you do?',
      'Complete care safely, avoid pressure on the area, and report the skin change and mental-status change to the supervising nurse promptly with specifics.',
      "Assuming 'it's nothing' can delay treatment of a pressure injury or an acute change such as a UTI."
    ),
  },
  oasis_homebound: {
    summary: 'Accurate OASIS scoring and a specific, defensible homebound narrative protect both reimbursement and survey outcomes.',
    clinical_pearl: 'Homebound has two prongs — a normal inability to leave home AND that leaving requires a taxing effort. Document both, with specifics.',
    check: ['What two criteria must your homebound documentation support?', 'What makes an OASIS response defensible on audit?'],
    case_scenario: cs(
      'A thin homebound narrative',
      'COPD patient who occasionally attends church with family assistance.',
      "Your draft note simply states 'patient is homebound' with no supporting detail.",
      'How do you strengthen it?',
      'Describe the taxing effort to leave (dyspnea on exertion, requires assist and rest), supportive devices, and that absences are infrequent and effortful — tie OASIS items to objective findings.',
      "A conclusory 'homebound' statement without specifics is a common audit denial."
    ),
  },
  hospice_philosophy: {
    summary: 'Frame care around comfort and patient/family goals, and match needs to the right level of care under the hospice benefit.',
    clinical_pearl: "A change in symptoms isn't automatically a hospital trip — the right level of hospice care often meets the need at home.",
    check: ['Name the four hospice levels of care.', 'What triggers a move to a higher level of care?'],
    case_scenario: cs(
      'A symptom crisis at home',
      'Hospice patient with end-stage cancer; family overwhelmed by uncontrolled pain.',
      'The family is considering calling 911 because pain is escalating overnight.',
      'What hospice options apply?',
      'Explain and mobilize the appropriate level of care — continuous home care or general inpatient for a symptom crisis — and coordinate with the IDG rather than defaulting to the ED.',
      'An ED transfer can disrupt goals of care when an in-benefit option would serve the patient better.'
    ),
  },
  hospice_pain: {
    summary: 'Assess pain and symptoms systematically, anticipate end-of-life changes, and adjust the plan proactively to prevent crises.',
    clinical_pearl: "Anticipate, don't chase — having breakthrough orders and a bowel regimen in place before they're needed prevents most pain crises.",
    check: ['What elements belong in a thorough pain assessment?', 'How do you document response to an intervention?'],
    case_scenario: cs(
      'Breakthrough pain',
      'Patient on a long-acting opioid for cancer pain.',
      'The patient reports evening breakthrough pain rated 8/10 despite the scheduled regimen.',
      'What is your approach?',
      'Reassess pain characteristics and the regimen, ensure breakthrough medication and a bowel plan are ordered and used, educate the family, and document response to each intervention with the IDG.',
      'Treating only the scheduled dose without addressing breakthrough pain leaves the patient suffering and erodes family trust.'
    ),
  },
  medication_safety: {
    summary: 'Reconcile the medication list at every opportunity and stay vigilant for high-alert drugs and interactions that drive avoidable harm.',
    clinical_pearl: "The most dangerous medication list is the one that's out of date — reconcile against what the patient is actually taking, not just the chart.",
    check: ['What does medication reconciliation involve?', 'Name two high-alert medication classes that warrant extra checks.'],
    case_scenario: cs(
      'A reconciliation discrepancy',
      'Patient recently discharged from the hospital on a new anticoagulant.',
      'During the home visit you find the patient is still taking the pre-hospital anticoagulant in addition to the newly prescribed one.',
      'What do you do?',
      'Stop, reconcile the full list against what the patient is actually taking, hold and clarify the duplicate with the prescriber immediately, and educate the patient on the corrected regimen.',
      'Missing the duplication can cause a serious bleed from doubled anticoagulation.'
    ),
  },
};

// Returns only the enrichment fields the first module is missing, so backfill
// and creation never overwrite content an author already provided.
const moduleAdditions = (me, content) => {
  const add = {};
  if (me.clinical_pearl && !content.clinical_pearl) add.clinical_pearl = me.clinical_pearl;
  if (me.summary && !content.summary) add.summary = me.summary;
  if (me.check?.length && !(content.check_your_understanding || []).length) add.check_your_understanding = me.check;
  if (me.case_scenario && !(content.case_scenarios || []).length) add.case_scenarios = [me.case_scenario];
  return add;
};

// ───────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const year = new Date().getFullYear();
    const svc = base44.asServiceRole.entities;
    const createdCourses = [];
    const reusedCourses = [];
    const courseIdByKey = {};

    for (const sample of courses) {
      const title = sample.title;
      const enrich = ENRICHMENT[sample.key] || {};
      const me = MODULE_ENRICHMENT[sample.key] || {};
      const existing = await svc.TrainingCourse.filter({ title, annual_cycle_year: year }, '-created_date', 5);
      let course = existing[0];

      if (!course) {
        course = await svc.TrainingCourse.create({
          title,
          short_description: sample.short_description,
          description: sample.description,
          training_type: 'annual_mandatory',
          annual_cycle_year: year,
          category: sample.category,
          business_line_scope: sample.business_line_scope,
          employee_audience: sample.employee_audience,
          purpose: sample.purpose,
          reading_level: 'plain professional',
          role_targets: sample.role_targets || [],
          tags: ['annual', 'in_service', 'required', sample.business_line_scope, sample.category],
          estimated_minutes: sample.estimated_minutes || 30,
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
          attestation_text:
            'I reviewed and understand this annual required in-service and understand I am responsible for following agency policy.',
          include_case_scenarios: true,
          include_key_takeaways: true,
          certificate_wording: 'This certifies successful completion of an annual required in-service.',
          real_world_relevance: enrich.real_world_relevance || '',
          regulatory_crosswalk_json: enrich.regulatory_crosswalk || [],
          competency_skills_json: enrich.competency_skills || [],
          retake_settings_json: {
            passing_threshold: 80,
            unlimited_retakes: false,
            max_attempts: 3,
            waiting_period_hours: 24,
            regenerate_test_on_retake: true,
          },
          test_settings_json: {
            randomize_questions: true,
            randomize_answers: true,
            show_correct_answers_after_completion: false,
          },
          archived_status: false,
        });
        createdCourses.push(title);

        for (const [moduleIndex, module] of sample.modules.entries()) {
          // Enrich the first module with an applied case scenario, clinical
          // pearl, summary, and self-check questions (only fields it lacks).
          const content_json = moduleIndex === 0
            ? { ...module.content_json, ...moduleAdditions(me, module.content_json) }
            : module.content_json;
          await svc.TrainingModule.create({
            course_id: course.id,
            title: module.title,
            type: 'lesson',
            content_json,
            order_index: moduleIndex,
            estimated_minutes: Math.max(10, Math.round((sample.estimated_minutes || 30) / sample.modules.length)),
            is_required: true,
          });
        }

        for (const [questionIndex, question] of sample.questions.entries()) {
          await svc.TrainingQuestion.create({
            course_id: course.id,
            type: question.type,
            prompt: question.prompt,
            options_json: question.options_json || [],
            correct_answer_json: question.correct_answer_json,
            rationale: question.rationale || '',
            rubric: question.rubric || '',
            difficulty: question.difficulty || 'medium',
            order_index: questionIndex,
            points: question.points || 1,
            active: true,
          });
        }

        await svc.TrainingAuditLog.create({
          actor_id: user.email,
          actor_name: user.full_name,
          action: 'course_created',
          entity_type: 'TrainingCourse',
          entity_id: course.id,
          after_json: { title, training_type: 'annual_mandatory', status: 'published', annual_cycle_year: year },
          reason: 'yearly required in-service seed',
          severity: 'info',
        });
      } else {
        reusedCourses.push(title);
        // Additive backfill: fill professional metadata on previously-seeded
        // courses that predate it, without touching lessons or questions.
        const patch = {};
        if (enrich.real_world_relevance && !course.real_world_relevance) {
          patch.real_world_relevance = enrich.real_world_relevance;
        }
        if (enrich.regulatory_crosswalk && (course.regulatory_crosswalk_json || []).length === 0) {
          patch.regulatory_crosswalk_json = enrich.regulatory_crosswalk;
        }
        if (enrich.competency_skills && (course.competency_skills_json || []).length === 0) {
          patch.competency_skills_json = enrich.competency_skills;
        }
        if (Object.keys(patch).length > 0) {
          await svc.TrainingCourse.update(course.id, patch);
        }

        // Backfill the first module's applied content (scenario, pearl, summary,
        // self-checks) on previously-seeded courses — additive, gaps only.
        if (me.clinical_pearl || me.case_scenario || me.summary || me.check) {
          const mods = await svc.TrainingModule.filter({ course_id: course.id }, 'order_index', 1);
          const first = mods[0];
          if (first) {
            const content = first.content_json || {};
            const add = moduleAdditions(me, content);
            if (Object.keys(add).length > 0) {
              await svc.TrainingModule.update(first.id, { content_json: { ...content, ...add } });
            }
          }
        }
      }

      courseIdByKey[sample.key] = { id: course.id, title };
    }

    const createdPlans = [];
    const reusedPlans = [];

    for (const template of plans) {
      let [plan] = await svc.LearningPlan.filter({ name: template.name, year }, '-created_date', 5);
      if (!plan) {
        plan = await svc.LearningPlan.create({
          name: template.name,
          description: template.description,
          business_line_scope: template.business_line_scope,
          year,
          plan_type: 'annual',
          active: true,
          auto_enroll: false,
          auto_enroll_criteria: { business_line: template.business_line_scope },
          created_by: user.email,
          total_courses: template.courseKeys.length,
        });
        createdPlans.push(plan.name);
      } else {
        reusedPlans.push(plan.name);
      }

      // Reconcile plan items: add any missing courses without duplicating
      // existing ones, so a partial or manually edited plan is repaired on
      // re-run rather than skipped.
      const existingItems = await svc.LearningPlanCourse.filter({ plan_id: plan.id }, 'order_index', 200);
      const existingCourseIds = new Set(existingItems.map((item) => item.course_id));
      for (const [index, key] of template.courseKeys.entries()) {
        const ref = courseIdByKey[key];
        if (!ref || existingCourseIds.has(ref.id)) continue;
        await svc.LearningPlanCourse.create({
          plan_id: plan.id,
          course_id: ref.id,
          course_title: ref.title,
          order_index: index,
          is_required: true,
        });
      }
    }

    return Response.json({
      success: true,
      year,
      total_courses: courses.length,
      created_courses: createdCourses,
      reused_courses: reusedCourses,
      created_plans: createdPlans,
      reused_plans: reusedPlans,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});