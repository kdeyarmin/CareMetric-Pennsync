// content-user.mjs — the end-user (clinical staff) manual.
//
// Each entry is a numbered section. This same array is reused verbatim as Part I
// of the Facility Administrator Manual, so it is written for every clinical role
// (nurse, social worker, spiritual care/chaplain, therapist, aide).

import {
  navpath, callout, steps, glance, table, faq, glossary, roleLine, grid2, kbd,
  figure, legend, flow, mockWorkspace, mockSmartNote, mockOasisTabs,
} from './theme.mjs';

export const userBlocks = [
  /* 1 ── Welcome ──────────────────────────────────────────────────────────── */
  {
    id: 'welcome',
    title: 'Welcome to PennSync',
    sub: [
      { id: 'welcome-what', title: 'What PennSync is' },
      { id: 'welcome-who', title: 'Who this manual is for' },
      { id: 'welcome-how', title: 'How to use this manual' },
    ],
    html: `
      <p class="lead">PennSync by CareMetric is an intelligent, AI-powered documentation and analytics platform built specifically for home health and hospice agencies. It brings your patients, visits, clinical notes, communication, compliance, and learning into one place — so you can spend less time on paperwork and more time on care.</p>

      <h3 id="welcome-what"><span class="h3-eyebrow">Overview</span>What PennSync is</h3>
      <p>PennSync combines everyday clinical workflows with AI assistance that helps you write faster, more compliant documentation. Behind the scenes it keeps your notes aligned with Medicare requirements, watches for patients at risk, and keeps your whole team in sync.</p>
      ${grid2([
        { h: 'AI-assisted documentation', p: 'Turn a few observations — typed or spoken — into a complete, skilled, Medicare-compliant note.' },
        { h: 'One connected record', p: 'Patients, visits, vitals, documents, OASIS, and messages all live on a single Patient 360 record.' },
        { h: 'Built-in compliance', p: 'Real-time checks flag documentation gaps before they become audit findings.' },
        { h: 'Work anywhere', p: 'Mobile-friendly screens and an Offline Mode let you document a visit even without a signal.' },
      ])}

      <h3 id="welcome-who"><span class="h3-eyebrow">Audience</span>Who this manual is for</h3>
      <p>This guide is for everyone who delivers or supports patient care in PennSync — both <strong>clinical</strong> and <strong>non-clinical (office)</strong> team members:</p>
      <ul class="feat">
        <li><strong>Clinical staff</strong> — registered nurses and LPNs, social workers, spiritual care providers and chaplains, and therapists (PT / OT / ST).</li>
        <li><strong>Field &amp; support staff</strong> — home health aides and CNAs.</li>
        <li><strong>Office &amp; administrative staff</strong> — schedulers, intake and referral coordinators, records and documentation clerks, billing/office coordinators, and front-office team members.</li>
      </ul>
      <p>Wherever a feature is used differently for Home Health versus Hospice, we call it out.</p>
      ${callout('note', 'A note on roles', '<p>Some back-office and administrative screens (Referrals, Documents &amp; E-Signing, Incident Review, Admin Console, Reports &amp; Analytics, Compliance Center) require administrator access. If you do not see a feature in your sidebar, your role may not include it — that is expected, not an error. Office staff who need these tools should ask their facility administrator about access.</p>')}

      <h3 id="welcome-how"><span class="h3-eyebrow">Getting the most from it</span>How to use this manual</h3>
      <ul class="feat">
        <li>Use the <strong>Contents</strong> page to jump straight to a task.</li>
        <li>Look for <strong>“Go to”</strong> chips like the one below — they show the exact path through the app.</li>
        <li>Watch for the callout boxes: <strong>Tips</strong> save you time, <strong>Important</strong> notes prevent mistakes, and <strong>Best practice</strong> boxes reflect how top-performing clinicians work.</li>
        <li><strong>Figures</strong> are simplified, labeled illustrations of the PennSync interface used to walk you through a screen; your live screens show real patient data and full detail.</li>
      </ul>
      ${navpath(['Sidebar', 'Overview', 'Dashboard'])}
    `,
  },

  /* 2 ── Feature Overview ─────────────────────────────────────────────────── */
  {
    id: 'features',
    title: 'Feature Overview',
    sub: [
      { id: 'feat-care', title: 'Patient care' },
      { id: 'feat-doc', title: 'Documentation' },
      { id: 'feat-comm', title: 'Communication' },
      { id: 'feat-learn', title: 'Learning & resources' },
      { id: 'feat-tools', title: 'Personal tools' },
    ],
    html: `
      <p class="sec-intro">A quick map of everything PennSync does. Each feature below is covered step by step later in this manual.</p>

      <h3 id="feat-care"><span class="h3-eyebrow">Patient care</span>Care &amp; assessments</h3>
      ${table(['Feature', 'What it does', 'Find it under'], [
        ['<strong>Dashboard</strong>', 'Your daily home base — today’s visits, AI-note and time-saved stats, real-time patient alerts, high-risk and hospitalization-risk monitors, pending referrals, announcements, and one-tap quick actions. A Smart Route Optimizer sequences your day’s visits.', 'Overview'],
        ['<strong>Patients</strong>', 'Your census with fuzzy search (name, MRN, phone, diagnosis) and filters for status, diagnosis, age, last visit, and insurance. Add patients, sort, favorite, and act in bulk.', 'Patient Care ▸ Patients'],
        ['<strong>Patient 360 record</strong>', 'One connected record per patient: overview and health history, vitals-trend charts, visits, documents, proactive tasks, and AI tools (risk, deterioration, history summary, compliance).', 'Patients ▸ (select) ▸ Patient Details'],
        ['<strong>Patient Alerts</strong>', 'A dedicated view of every clinical, risk, and deterioration alert for your patients — review, prioritize, and acknowledge.', 'Patient Care ▸ Patients ▸ Patient Alerts'],
        ['<strong>OASIS Center</strong>', 'Complete OASIS-E with AI pre-fill and compliance hints, then analyze, review/approve, and validate — all as tabs of one hub.', 'Patient Care ▸ OASIS Center'],
        ['<strong>Incidents</strong>', 'Report safety events (falls, medication errors, injuries) with event type, severity, and AI severity scoring; automatic state-reportable detection; track each report to resolution.', 'Patient Care ▸ Incidents'],
        ['<strong>Patient Education</strong>', 'Generate personalized, plain-language handouts for common conditions, tuned to the patient’s history and reading level; email or print; document teach-back.', 'Patient Care ▸ Patient Education'],
      ])}

      <h3 id="feat-doc"><span class="h3-eyebrow">Documentation</span>Charting a visit</h3>
      ${table(['Feature', 'What it does', 'Find it under'], [
        ['<strong>Clinical Notes</strong>', 'The documentation hub for every visit — a clear choice between Smart Note and Visit Scribe, with structured vitals capture and automatic visit + compliance records.', 'Documentation ▸ Clinical Notes'],
        ['<strong>Smart Note</strong>', 'Type a few rough observations; AI checks Home Health / Hospice compliance and rewrites them into a complete, skilled note with medical-necessity and homebound language.', 'Clinical Notes ▸ Smart Note'],
        ['<strong>Visit Scribe</strong>', 'Document by voice — record or upload audio, or dictate live. AI transcribes and runs the same compliance review and polishing as a typed note.', 'Clinical Notes ▸ Visit Scribe'],
        ['<strong>Offline Mode</strong>', 'Document a visit with no signal — notes and audio are saved on your device and sync automatically when you reconnect.', 'Tools ▸ Offline Mode'],
      ])}

      <h3 id="feat-comm"><span class="h3-eyebrow">Communication</span>Reaching your team &amp; patients</h3>
      ${table(['Feature', 'What it does', 'Find it under'], [
        ['<strong>Messages</strong>', 'Secure internal messaging with Urgent / High / Normal priorities, threading, and patient context for clean handoffs.', 'Communication ▸ Messages'],
        ['<strong>Phone Center</strong>', 'Calls and texts through a masked work number (your personal cell stays private): Texts, Recents, Callbacks queue, Scheduled texts, and Duty Status.', 'Communication ▸ Phone Center'],
        ['<strong>Fax</strong>', 'Send a fax from your camera, an uploaded file, or a template — with an AI cover page, batch sending, contacts, and delivery tracking.', 'Communication ▸ Fax'],
        ['<strong>Providers</strong>', 'A searchable directory of physicians and provider offices with phone, fax, email, address, and specialty.', 'Communication ▸ Providers'],
        ['<strong>Telehealth</strong>', 'Schedule and run secure video visits; text the patient a one-tap join link; view vitals live and document from the session.', 'Communication ▸ Telehealth'],
      ])}

      <h3 id="feat-learn"><span class="h3-eyebrow">Learning &amp; resources</span>Growing &amp; referencing</h3>
      ${table(['Feature', 'What it does', 'Find it under'], [
        ['<strong>Learning Center</strong>', 'Courses, learning plans, competencies, certificates, renewals (with calendar export), in-services, annual education, and transcripts.', 'Learning &amp; Resources ▸ Learning Center'],
        ['<strong>Nurse Training Hub</strong>', 'Role-specific, AI-personalized nursing training and documentation practice.', 'Learning Center ▸ Nurse Training Hub'],
        ['<strong>Reference Libraries</strong>', 'Resource Library (agency guidelines &amp; policies), Clinical Library (disease/medication references), and Medicare Guidelines on demand.', 'Learning &amp; Resources ▸ Library'],
      ])}

      <h3 id="feat-tools"><span class="h3-eyebrow">Personal tools</span>Settings &amp; day-to-day</h3>
      ${table(['Feature', 'What it does', 'Find it under'], [
        ['<strong>Settings</strong>', 'Your profile, care scope (Home Health / Hospice / Both), credentials with expiration reminders, and AI preferences.', 'Tools ▸ Settings'],
        ['<strong>Notifications</strong>', 'Choose which alerts you receive (messages, SMS, clinical alerts, approvals) and set quiet hours.', 'Settings ▸ Notification Settings'],
        ['<strong>Time Off</strong>', 'Request PTO/sick/vacation and track approvals; managers approve and view a team calendar.', 'Tools ▸ Time Off'],
        ['<strong>On-Call Schedule</strong>', 'View holiday and overnight coverage so you always know who’s on (admins edit it).', 'Tools ▸ On-Call'],
        ['<strong>Help &amp; User Guides</strong>', 'Quick-start help, searchable FAQs, and downloadable manuals (including this one).', 'Tools ▸ Help'],
      ])}

      ${callout('note', 'For office &amp; administrative staff', '<p>Office staff also use back-office tools — <strong>Referrals</strong> (intake with AI extraction), <strong>Documents &amp; E-Signing</strong>, <strong>Incident Review</strong>, and <strong>Template Management</strong>. These require administrator access; ask your facility administrator, and see the <em>Facility Administrator Manual</em> for how they work.</p>')}
    `,
  },

  /* 3 ── Getting Started ──────────────────────────────────────────────────── */
  {
    id: 'getting-started',
    title: 'Getting Started',
    sub: [
      { id: 'gs-signin', title: 'Signing in' },
      { id: 'gs-workspace', title: 'Finding your way around' },
      { id: 'gs-profile', title: 'Your profile & care scope' },
      { id: 'gs-5min', title: 'Your first 5 minutes' },
    ],
    html: `
      <p class="sec-intro">A quick tour of how to sign in, move around the app, and set yourself up so PennSync works the way you do.</p>

      <h3 id="gs-signin"><span class="h3-eyebrow">Access</span>Signing in</h3>
      ${steps([
        ['Open PennSync', 'Go to your agency’s PennSync web address in any modern browser (Chrome, Safari, Edge) on a computer, tablet, or phone.'],
        ['Enter your credentials', 'Sign in with the email and password from your welcome invitation. First time in, you may be asked to set a new password.'],
        ['Land on your Dashboard', 'After sign-in you arrive on your Dashboard — your personalized home base for the day.'],
      ])}
      ${callout('tip', 'Add PennSync to your home screen', '<p>On a phone or tablet, use your browser’s <strong>Add to Home Screen</strong> option. PennSync installs like an app, opens full-screen, and keeps you signed in.</p>')}
      ${callout('important', 'Forgot your password?', '<p>Use the <strong>Forgot password</strong> link on the sign-in screen, or ask your facility administrator to send a reset. Never share your password — every action in PennSync is recorded under your name for HIPAA accountability.</p>')}

      <h3 id="gs-workspace"><span class="h3-eyebrow">Navigation</span>Finding your way around</h3>
      <p>Every screen shares the same layout. The illustration below maps the four things you’ll use most to move around PennSync.</p>
      ${figure('The PennSync workspace — the numbered elements are explained in the key below.', mockWorkspace())}
      ${legend([
        `<strong>Sidebar</strong> — your features, grouped into Overview, Patient Care, Documentation, Communication, Learning &amp; Resources, and Tools. Tap any item to open it.`,
        `<strong>Breadcrumbs</strong> — show where you are (e.g. Patients ▸ Patient Details); click any crumb to step back.`,
        `<strong>Command palette</strong> — press ${kbd('Cmd')} / ${kbd('Ctrl')} + ${kbd('K')} to jump to any page or patient by name.`,
        `<strong>Notifications</strong> — the bell shows new alerts, messages, and approvals.`,
      ])}
      ${callout('tip', 'Search beats scrolling', '<p>Don’t hunt through the sidebar — press <strong>Cmd / Ctrl + K</strong> and type “fax”, “oasis”, a patient’s name, or a task. The command palette only ever shows pages you’re allowed to open.</p>')}
      ${callout('note', 'On a phone', '<p>On phones the sidebar collapses to a menu and the most-used shortcuts (including Notes) move to a bottom navigation bar. Pull down on the Dashboard to refresh your visits and alerts.</p>')}

      <h3 id="gs-profile"><span class="h3-eyebrow">Set up</span>Your profile & care scope</h3>
      <p>Before your first visit, complete your profile so PennSync tailors itself to you.</p>
      ${navpath(['Sidebar', 'Tools', 'Settings'])}
      ${steps([
        ['Open Settings', 'From the Tools section of the sidebar, choose Settings.'],
        ['Complete your profile', 'Add your full name, work phone, and credential type (RN, LPN, MSW, chaplain, PT, etc.).'],
        ['Choose your care scope', 'Select Home Health, Hospice, or Both. Your care scope tailors dashboards, templates, and compliance checks to the right setting.'],
        ['Add your credentials', 'Record your licenses and certifications with expiration dates so renewal reminders reach you in time.'],
        ['Review AI preferences', 'On the AI Configuration tab, set how much help you want from AI when writing notes.'],
      ])}
      ${callout('note', 'Profile completeness', '<p>If key details are missing, PennSync shows a gentle prompt on your Dashboard. Completing your profile improves AI personalization and keeps your credential records audit-ready.</p>')}

      <h3 id="gs-5min"><span class="h3-eyebrow">Quick start</span>Your first 5 minutes</h3>
      ${steps([
        ['Check your Dashboard', 'Review today’s visits, alerts, and pending tasks.'],
        ['Find or add a patient', 'Open Patients to search for someone or add a new patient.'],
        ['Document a visit', 'Use Clinical Notes — Smart Note (type) or Visit Scribe (speak).'],
        ['Let AI help', 'Review the compliant note PennSync drafts from your input.'],
        ['Save & finish', 'Save the note, glance at the compliance score, and you’re done.'],
      ])}
    `,
  },

  /* 3 ── Dashboard ────────────────────────────────────────────────────────── */
  {
    id: 'dashboard',
    title: 'Your Dashboard',
    sub: [
      { id: 'dash-widgets', title: 'What’s on your Dashboard' },
      { id: 'dash-actions', title: 'Quick actions & route planning' },
    ],
    html: `
      <p class="sec-intro">The Dashboard is your daily command center. It greets you by name, shows what needs attention, and puts your most common tasks one tap away.</p>
      ${navpath(['Sidebar', 'Overview', 'Dashboard'])}

      <h3 id="dash-widgets"><span class="h3-eyebrow">At a glance</span>What’s on your Dashboard</h3>
      ${table(['Widget', 'What it shows'], [
        ['<strong>Today’s snapshot</strong>', 'Scheduled visits (and how many you’ve completed), AI-assisted notes created, and the time you’ve saved over the last 30 days.'],
        ['<strong>Real-time patient alerts</strong>', 'New incidents, clinical changes, and risk alerts for your patients as they happen.'],
        ['<strong>High-risk patients</strong>', 'Patients flagged for possible deterioration or hospitalization so you can prioritize outreach.'],
        ['<strong>Hospitalization risk monitor</strong>', 'AI prediction of which patients are most at risk of an avoidable hospitalization.'],
        ['<strong>Proactive clinical support</strong>', 'AI clinical guidance for the patients you’re scheduled to see.'],
        ['<strong>Upcoming telehealth</strong>', 'Your scheduled virtual visits, with quick join links.'],
        ['<strong>Pending referrals</strong>', 'New admissions awaiting action (where your role allows).'],
        ['<strong>Announcements</strong>', 'Messages and updates posted by your administrator.'],
      ])}

      <h3 id="dash-actions"><span class="h3-eyebrow">Do it faster</span>Quick actions & route planning</h3>
      <p>Quick-action shortcuts jump you straight into the tasks you do most — <strong>Smart Notes, Send Fax, Patient Education, Visit Scribe,</strong> and <strong>Incidents</strong>.</p>
      ${callout('tip', 'Plan your day with the Route Optimizer', '<p>The <strong>Smart Route Optimizer</strong> sequences today’s visits into an efficient driving order, helping you spend less time on the road and more with patients.</p>')}
      ${callout('note', 'Pull to refresh', '<p>On a phone, pull down on the Dashboard to refresh your visits, alerts, and announcements.</p>')}
    `,
  },

  /* 4 ── Patients ─────────────────────────────────────────────────────────── */
  {
    id: 'patients',
    title: 'Patients & the Patient Record',
    sub: [
      { id: 'pat-roster', title: 'The patient roster' },
      { id: 'pat-add', title: 'Adding a patient' },
      { id: 'pat-360', title: 'The Patient 360 record' },
      { id: 'pat-alerts', title: 'Patient alerts & risk' },
    ],
    html: `
      <p class="sec-intro">Everything about a patient — demographics, visits, vitals, documents, OASIS, alerts, and AI insights — lives on one connected record.</p>
      ${roleLine('Nurse', 'Facility Admin')}

      <h3 id="pat-roster"><span class="h3-eyebrow">Find anyone fast</span>The patient roster</h3>
      ${navpath(['Sidebar', 'Patient Care', 'Patients'])}
      <p>The Patients page lists your census with summary cards (total active, recently admitted, active count) at the top. To find someone:</p>
      ${grid2([
        { h: 'Search', p: 'Type a name, MRN, phone number, or diagnosis — results filter as you type.' },
        { h: 'Filter', p: 'Narrow by status (active / inactive / discharged), diagnosis, age range, last-visit dates, or insurance type.' },
        { h: 'Sort', p: 'Order by newest, oldest, last visit, or name (A–Z / Z–A).' },
        { h: 'Swipe (mobile)', p: 'Swipe a patient card to reveal quick actions like view or add a visit.' },
      ])}
      ${callout('tip', 'Open a patient in one step', '<p>Skip the list — press <strong>Cmd / Ctrl + K</strong> and type the patient’s name to jump straight to their record.</p>')}

      <h3 id="pat-add"><span class="h3-eyebrow">New patient</span>Adding a patient</h3>
      ${steps([
        ['Start a new patient', 'On the Patients page, choose Add Patient.'],
        ['Enter demographics', 'Name, date of birth, contact details, address, and insurance.'],
        ['Add clinical basics', 'Primary diagnosis, referring provider, and care scope (Home Health or Hospice).'],
        ['Save', 'The patient is added to your roster and ready for scheduling and documentation.'],
      ])}
      ${callout('note', 'Referrals often create the patient for you', '<p>When a patient arrives through the Referral Intake workflow, PennSync can create the record automatically from the referral document — no manual entry needed. See your administrator or the Referrals section.</p>')}

      <h3 id="pat-360"><span class="h3-eyebrow">One complete record</span>The Patient 360 record</h3>
      ${navpath(['Patients', 'Select a patient', 'Patient Details'])}
      <p>Opening a patient shows their full record, organized into tabs:</p>
      ${table(['Tab', 'What you’ll find'], [
        ['<strong>Overview</strong>', 'Snapshot, quick actions (call, email, refill, discharge), care-team messaging, health history, clinical-events timeline, documents, and an AI-generated patient summary.'],
        ['<strong>AI Tools</strong>', 'Risk stratification, deterioration prediction, history summary, compliance auditor, and proactive OASIS suggestions.'],
        ['<strong>Documents</strong>', 'View, upload, and download the patient’s documents and referral paperwork.'],
        ['<strong>Visits</strong>', 'Every past and scheduled visit; start a new visit here.'],
        ['<strong>Tasks</strong>', 'Proactive, AI-generated clinical tasks you can assign and track.'],
      ])}
      <p>A <strong>vitals trend dashboard</strong> charts vital signs over time, and contact actions let you call the patient through your secure work number, send email, request a refill, start a telehealth visit, or begin a discharge.</p>
      ${callout('best', 'Best practice: work from the record', '<p>Start documentation, education, and communication from inside the patient’s record. PennSync then carries their diagnoses, medications, and history into every AI tool — giving you sharper, more personalized results.</p>')}

      <h3 id="pat-alerts"><span class="h3-eyebrow">Stay ahead of problems</span>Patient alerts & risk</h3>
      ${navpath(['Sidebar', 'Patient Care', 'Patients', 'Patient Alerts'])}
      <p>PennSync continuously watches for clinical changes and flags patients at risk. On the Patient Alerts screen you can review every alert, see its severity, and acknowledge it once addressed. High-severity alerts also surface on your Dashboard and inside the patient’s record.</p>
    `,
  },

  /* 5 ── OASIS ────────────────────────────────────────────────────────────── */
  {
    id: 'oasis',
    title: 'OASIS Assessments',
    sub: [
      { id: 'oasis-assess', title: 'Completing an assessment' },
      { id: 'oasis-tabs', title: 'The OASIS Center' },
    ],
    html: `
      <p class="sec-intro">The OASIS Center is your single home for OASIS-E — completing assessments with AI guidance, then reviewing and validating them for accuracy and compliance.</p>
      ${roleLine('Nurse', 'Facility Admin')}
      ${navpath(['Sidebar', 'Patient Care', 'OASIS Center'])}

      <h3 id="oasis-assess"><span class="h3-eyebrow">Guided & AI-assisted</span>Completing an assessment</h3>
      ${steps([
        ['Open the Assessment tab', 'The OASIS Center opens on Assessment (Smart OASIS) by default.'],
        ['Select the patient & visit', 'The assessment links to a specific visit so it lands on the right episode.'],
        ['Work through the guided form', 'Items branch intelligently based on your answers. AI pre-fills likely responses from the patient’s history and offers compliance hints as you go.'],
        ['Review AI suggestions', 'PennSync highlights clinical pathway suggestions and flags responses that may create compliance or coding risk.'],
        ['Save as draft or submit', 'Save to finish later, or submit to send the assessment for review and sign-off.'],
      ])}
      ${callout('important', 'Always confirm AI answers', '<p>AI suggestions accelerate OASIS but never replace your clinical judgment. Review every item — especially those that drive the patient’s functional score and case mix — before submitting.</p>')}

      <h3 id="oasis-tabs"><span class="h3-eyebrow">Everything in one place</span>The OASIS Center</h3>
      <p>Beyond the assessment itself, the OASIS Center gathers related tools as tabs:</p>
      ${figure('The OASIS Center — the Assessment tab is open; the other tabs analyze, review, and validate the same assessment.', mockOasisTabs())}
      ${table(['Tab', 'Purpose'], [
        ['<strong>Assessment</strong>', 'Complete the OASIS-E with AI guidance (the default view).'],
        ['<strong>Analyze</strong>', 'Deep-dive accuracy scoring, compliance gaps, and clinical-pathway recommendations.'],
        ['<strong>Review & Approve</strong>', 'Queue of completed assessments awaiting clinician sign-off.'],
        ['<strong>Clinical</strong>', 'Clinician quality check — validates answers against documented diagnoses and symptoms.'],
        ['<strong>Quality & Documentation</strong>', 'Compliance validation, missing fields, and documentation gaps.'],
      ])}
      ${callout('note', 'Some tabs are for administrators', '<p>Revenue, Analytics, and Audit tabs present financial and agency-wide data and appear for facility administrators. Clinicians work primarily in Assessment, Analyze, Review, Clinical, and Quality.</p>')}
    `,
  },

  /* 6 ── Incidents ────────────────────────────────────────────────────────── */
  {
    id: 'incidents',
    title: 'Incident Reporting',
    sub: [{ id: 'inc-report', title: 'Reporting a safety event' }],
    html: `
      <p class="sec-intro">When a safety event happens — a fall, a medication error, an injury — report it in PennSync so it reaches the right people and any required state filing is handled.</p>
      ${roleLine('Nurse', 'Facility Admin')}
      ${navpath(['Sidebar', 'Patient Care', 'Incidents'])}

      <h3 id="inc-report"><span class="h3-eyebrow">Report it right away</span>Reporting a safety event</h3>
      ${steps([
        ['Open Incidents', 'Choose Incidents from the Patient Care section, then the Report tab.'],
        ['Select the patient', 'Pick the involved patient from your active list.'],
        ['Classify the event', 'Choose the event type and severity, then describe what happened.'],
        ['Submit', 'PennSync time-stamps the report, applies AI severity scoring, and automatically flags events that may be state-reportable.'],
      ])}
      <p>The <strong>Recent Reports</strong> tab lists what you’ve submitted with status badges (new, pending review, resolved, state-reported) so you can track each one to closure.</p>
      ${callout('important', 'Report promptly and factually', '<p>Document objective facts (what, when, where, who was present) as soon as it’s safe to do so. Your administrator reviews and, where required, files the incident with the state.</p>')}
    `,
  },

  /* 7 ── Patient Education ────────────────────────────────────────────────── */
  {
    id: 'education',
    title: 'Patient Education',
    sub: [
      { id: 'edu-create', title: 'Creating a handout' },
      { id: 'edu-teachback', title: 'Teach-back & tracking' },
    ],
    html: `
      <p class="sec-intro">Generate personalized, easy-to-understand education for your patients — then confirm understanding with teach-back and track what you’ve sent.</p>
      ${roleLine('Nurse', 'Facility Admin')}
      ${navpath(['Sidebar', 'Patient Care', 'Patient Education'])}

      <h3 id="edu-create"><span class="h3-eyebrow">Personalized in seconds</span>Creating a handout</h3>
      ${steps([
        ['Choose a topic', 'Pick from common conditions — CHF, COPD, oxygen therapy, diabetes, hypertension, stroke recovery, wound care, infection prevention, medication management, fall prevention, palliative care, pain management, and more.'],
        ['Personalize with AI', 'PennSync tailors the handout to the patient’s history and adjusts the reading level for clear comprehension.'],
        ['Style it', 'Set font size and colors, choose which sections to include, and add the patient’s name and any custom notes.'],
        ['Preview & deliver', 'Preview, then download as a PDF to print or email it directly to the patient or family.'],
      ])}

      <h3 id="edu-teachback"><span class="h3-eyebrow">Confirm understanding</span>Teach-back & tracking</h3>
      <p>Use the <strong>Teach-Back</strong> tab to document a teach-back session and verify the patient understood their instructions. The <strong>Tracking</strong> tab shows which handouts you’ve sent, delivery confirmation, and engagement.</p>
      ${callout('best', 'Best practice: pair education with teach-back', '<p>Teaching plus a documented teach-back is strong evidence of skilled care and supports Medicare compliance. Generate the handout, teach from it, then record the teach-back in the same place.</p>')}
    `,
  },

  /* 8 ── Documenting a Visit ──────────────────────────────────────────────── */
  {
    id: 'documentation',
    title: 'Documenting a Visit',
    sub: [
      { id: 'doc-choose', title: 'Two ways to document' },
      { id: 'doc-smart', title: 'Smart Note (typed)' },
      { id: 'doc-scribe', title: 'Visit Scribe (spoken)' },
      { id: 'doc-visit', title: 'Vitals & closing a scheduled visit' },
      { id: 'doc-offline', title: 'Documenting offline' },
    ],
    html: `
      <p class="sec-intro">Documentation is where PennSync saves you the most time. Everything lives in the Clinical Notes hub, where you choose the approach that fits the moment.</p>
      ${roleLine('Nurse', 'Facility Admin')}
      ${navpath(['Sidebar', 'Documentation', 'Clinical Notes'])}

      <h3 id="doc-choose"><span class="h3-eyebrow">Pick your style</span>Two ways to document</h3>
      ${grid2([
        { h: 'Smart Note — type', p: 'Jot a few rough observations and let AI expand them into a complete, compliant, skilled note.' },
        { h: 'Visit Scribe — speak', p: 'Record or dictate the visit out loud; PennSync transcribes it and turns it into a compliant note.' },
      ])}

      <h3 id="doc-smart"><span class="h3-eyebrow">Fastest for typing</span>Smart Note (typed)</h3>
      <p>Smart Note turns a few quick observations into a complete, compliant note in five steps:</p>
      ${flow([
        { h: 'Select patient', p: 'AI personalizes to their diagnoses, meds, and history.' },
        { h: 'Enter vitals', p: 'Structured vitals flow to the chart and trends.' },
        { h: 'Write observations', p: 'Plain language and bullet points are fine.' },
        { h: 'AI checks &amp; polishes', p: 'Compliance is verified; skilled language is added.' },
        { h: 'Review &amp; save', p: 'Edit if needed; the visit and audit are created.' },
      ])}
      ${figure('The Smart Note screen — the numbered areas match the walkthrough below.', mockSmartNote())}
      ${legend([
        'Select the patient — AI uses their record to personalize the note.',
        'Enter vital signs in the structured form.',
        'Type your observations in plain language.',
        'AI flags any compliance issues and rewrites your text into a skilled note.',
        'Review and Save — the visit and compliance audit are created automatically.',
      ])}
      <h4>Step by step</h4>
      ${steps([
        ['Choose Smart Note', 'In Clinical Notes, select Smart Note. Always select the patient first.'],
        ['Capture vitals', 'Enter vital signs (temperature, blood pressure, heart rate, respiratory rate, O₂, pain) in the structured form so they reach the chart and trends.'],
        ['Write your observations', 'Type rough notes in plain language — bullet points are fine.'],
        ['Let AI check & polish', 'PennSync flags compliance issues (Home Health or Hospice rules) and rewrites your notes into professional, skilled documentation with medical-necessity and homebound language.'],
        ['Review, edit & save', 'Confirm the note reads accurately, make any edits, and save. The visit record and compliance audit are created automatically.'],
      ])}
      ${callout('tip', 'Always select the patient first', '<p>Selecting the patient lets AI personalize the note using their diagnoses, medications, and history. The more you document for a patient, the better the suggestions get.</p>')}

      <h3 id="doc-scribe"><span class="h3-eyebrow">Hands-free</span>Visit Scribe (spoken)</h3>
      <p>Visit Scribe offers two ways to capture a visit by voice:</p>
      ${table(['Mode', 'How it works'], [
        ['<strong>Record / Upload</strong>', 'Record the visit audio in your browser or upload a recording. Play it back, then transcribe it to text.'],
        ['<strong>Live Dictation</strong>', 'Dictate in real time and watch the transcription appear as you speak; pause, resume, and edit.'],
      ])}
      <p>Either way, PennSync selects the patient and visit type, captures vitals, transcribes your words, and runs the result through the same compliance review and polishing as a typed Smart Note before saving to the chart.</p>
      ${callout('tip', 'Save 10–15 minutes per visit', '<p>Speaking your note in Visit Scribe is often much faster than typing. Narrate the visit naturally — PennSync handles structure and skilled language for you.</p>')}

      <h3 id="doc-visit"><span class="h3-eyebrow">Close the loop</span>Vitals & closing a scheduled visit</h3>
      <p>When you document from a scheduled or overdue visit (for example, via a “Document this visit” link on the patient record or a compliance alert), PennSync loads that visit, pre-selects the patient and visit type, and <strong>completes the existing visit on save</strong> — so you’re not left with a duplicate and any related alert clears.</p>
      ${callout('note', 'Vitals travel with the note', '<p>Vitals you enter on a note are saved to the visit, so they appear on the chart, in the vitals trend, and in critical-vitals escalation. They reset when you switch patients, so one patient’s readings never land on another’s chart.</p>')}

      <h3 id="doc-offline"><span class="h3-eyebrow">No signal, no problem</span>Documenting offline</h3>
      ${navpath(['Sidebar', 'Tools', 'Offline Mode'])}
      <p>In a basement or a rural home with no connection, switch to Offline Mode to keep documenting. Your notes and recordings are saved on the device and sync automatically the moment you’re back online. See <em>Personal Tools & Settings → Offline Mode</em> for details.</p>
    `,
  },

  /* 9 ── Communication ───────────────────────────────────────────────────── */
  {
    id: 'communication',
    title: 'Communication',
    sub: [
      { id: 'com-messages', title: 'Messages' },
      { id: 'com-phone', title: 'Phone Center (calls & texts)' },
      { id: 'com-fax', title: 'Fax' },
      { id: 'com-providers', title: 'Providers directory' },
      { id: 'com-telehealth', title: 'Telehealth' },
    ],
    html: `
      <p class="sec-intro">PennSync keeps every conversation — with teammates, patients, and physician offices — inside the platform, and protects your personal number while doing it.</p>
      ${roleLine('Nurse', 'Facility Admin')}

      <h3 id="com-messages"><span class="h3-eyebrow">Team messaging</span>Messages</h3>
      ${navpath(['Sidebar', 'Communication', 'Messages'])}
      <p>Send secure internal messages to teammates, set a priority (Urgent, High, or Normal), and link a message to a specific patient for clean care coordination and handoffs. Filter your inbox by priority or read status; a badge shows unread messages.</p>

      <h3 id="com-phone"><span class="h3-eyebrow">Calls & texts, protected</span>Phone Center</h3>
      ${navpath(['Sidebar', 'Communication', 'Phone Center'])}
      <p>The Phone Center works like a phone app, with tabs for:</p>
      ${table(['Tab', 'What it does'], [
        ['<strong>Texts</strong>', 'SMS conversations with patients, threaded by person with patient context (name, MRN, diagnosis).'],
        ['<strong>Recents</strong>', 'Inbound and outbound call history with duration, time, and recordings where available.'],
        ['<strong>Callbacks</strong>', 'A queue of patients waiting to hear back, with one-tap calling.'],
        ['<strong>Scheduled</strong>', 'Text messages queued to send later; edit or cancel any time.'],
        ['<strong>Duty Status</strong>', 'Toggle on/off duty; off-duty callers get an away message.'],
      ])}
      ${callout('important', 'Your personal number stays private', '<p>All calls and texts route through a masked work number. Patients never see your personal cell, and your communication history stays in PennSync.</p>')}

      <h3 id="com-fax"><span class="h3-eyebrow">Still essential in healthcare</span>Fax</h3>
      ${navpath(['Sidebar', 'Communication', 'Fax'])}
      <p>Send a fax straight from your phone or computer:</p>
      ${steps([
        ['Choose a source', 'Snap a photo with your camera, upload a file, or select a patient document or template.'],
        ['Add the recipient', 'Enter a fax number or pick from your fax contacts (physician offices, facilities).'],
        ['Send & track', 'PennSync can add a professional cover page, sends securely, and tracks delivery status.'],
      ])}
      <p>Use <strong>Batch</strong> to send to several recipients at once, and the <strong>Contacts, History,</strong> and <strong>Logs</strong> tabs to manage your address book and confirm delivery.</p>

      <h3 id="com-providers"><span class="h3-eyebrow">Your referral network</span>Providers directory</h3>
      ${navpath(['Sidebar', 'Communication', 'Providers'])}
      <p>Look up physicians and provider offices with their phone, fax, email, address, and specialty. Add or update entries so contact details stay current for the whole team.</p>

      <h3 id="com-telehealth"><span class="h3-eyebrow">Virtual visits</span>Telehealth</h3>
      ${navpath(['Sidebar', 'Communication', 'Telehealth'])}
      ${steps([
        ['Schedule a session', 'Choose the patient, visit type, and date/time.'],
        ['Send the join link', 'Text the patient a secure link — they join from any browser, no app or login required.'],
        ['Run the visit', 'Use standard controls (mute, camera on/off) and view vitals live during the call.'],
        ['Document', 'Capture findings and generate a note right from the session.'],
      ])}
      ${callout('tip', 'Telehealth for quick check-ins', '<p>Virtual visits are ideal for medication reviews, symptom checks, and follow-ups — saving a drive while keeping eyes on your patient.</p>')}
    `,
  },

  /* 10 ── Learning & Resources ────────────────────────────────────────────── */
  {
    id: 'learning',
    title: 'Learning & Resources',
    sub: [
      { id: 'learn-center', title: 'The Learning Center' },
      { id: 'learn-libraries', title: 'Reference libraries' },
    ],
    html: `
      <p class="sec-intro">Grow your skills and keep certifications current — and reach trusted clinical and Medicare references whenever you need them.</p>
      ${roleLine('Nurse', 'Facility Admin')}

      <h3 id="learn-center"><span class="h3-eyebrow">Your training home</span>The Learning Center</h3>
      ${navpath(['Sidebar', 'Learning & Resources', 'Learning Center'])}
      <p>The Learning Center brings your training together as tabs:</p>
      ${table(['Area', 'What it’s for'], [
        ['<strong>Active Courses & Catalog</strong>', 'Browse, enroll in, and resume courses; track progress on each.'],
        ['<strong>Learning Plans</strong>', 'Assigned learning paths with due dates and completion badges.'],
        ['<strong>Competencies & Skill Gaps</strong>', 'See your competencies by role and where to focus next.'],
        ['<strong>Certificates & Renewals</strong>', 'Download certificates and stay ahead of expirations (export renewals to your calendar).'],
        ['<strong>In-Services & Annual Education</strong>', 'Attend in-services and complete annual mandatory education.'],
        ['<strong>Transcripts</strong>', 'Your complete learning record and CEUs, exportable as a PDF.'],
      ])}
      <p>Open a course in the <strong>Course Player</strong> for video lessons, quizzes, and a certificate on completion. Nurses can also use the <strong>Nurse Training Hub</strong> for role-specific, AI-personalized training.</p>
      ${callout('tip', 'Never miss a renewal', '<p>Check the Renewals tab monthly and export it to your calendar so licenses and certifications never lapse.</p>')}

      <h3 id="learn-libraries"><span class="h3-eyebrow">Answers on demand</span>Reference libraries</h3>
      ${navpath(['Sidebar', 'Learning & Resources', 'Library'])}
      ${grid2([
        { h: 'Resource Library', p: 'Agency reference materials, guidelines, procedures, and policies.' },
        { h: 'Clinical Library', p: 'Disease-state information, treatment protocols, medication and lab references.' },
        { h: 'Medicare Guidelines', p: 'CMS / Medicare home-health policy, OASIS guidance, and documentation requirements.' },
      ])}
    `,
  },

  /* 11 ── Personal Tools & Settings ───────────────────────────────────────── */
  {
    id: 'tools',
    title: 'Personal Tools & Settings',
    sub: [
      { id: 'tool-settings', title: 'Settings & notifications' },
      { id: 'tool-timeoff', title: 'Time Off' },
      { id: 'tool-oncall', title: 'On-Call Schedule' },
      { id: 'tool-offline', title: 'Offline Mode' },
    ],
    html: `
      <p class="sec-intro">Tune PennSync to you: control notifications, request time off, check on-call coverage, and prepare for working offline.</p>
      ${roleLine('Nurse', 'Facility Admin')}

      <h3 id="tool-settings"><span class="h3-eyebrow">Make it yours</span>Settings & notifications</h3>
      ${navpath(['Sidebar', 'Tools', 'Settings'])}
      <p>In Settings, update your profile and care scope, manage your credentials, and set AI preferences. From <strong>Notification Settings</strong>, choose which alerts you receive (messages, SMS, clinical alerts, approvals), set a quiet/do-not-disturb window, and pick email-digest options.</p>

      <h3 id="tool-timeoff"><span class="h3-eyebrow">Plan ahead</span>Time Off</h3>
      ${navpath(['Sidebar', 'Tools', 'Time Off'])}
      ${steps([
        ['Create a request', 'Choose your dates and request type (vacation, sick, PTO), add a note, and submit.'],
        ['Track it', 'See pending and approved requests, and cancel a request if plans change.'],
      ])}
      ${callout('note', 'Managers get more', '<p>If you manage a team, additional tabs let you approve requests and view a team calendar and coverage — see the administrator manual.</p>')}

      <h3 id="tool-oncall"><span class="h3-eyebrow">Know who’s covering</span>On-Call Schedule</h3>
      ${navpath(['Sidebar', 'Tools', 'On-Call'])}
      <p>View the on-call calendar for holiday and overnight coverage so you always know who’s on. Editing the schedule is reserved for administrators.</p>

      <h3 id="tool-offline"><span class="h3-eyebrow">Work anywhere</span>Offline Mode</h3>
      ${navpath(['Sidebar', 'Tools', 'Offline Mode'])}
      ${table(['Tab', 'What it does'], [
        ['<strong>Status & Sync</strong>', 'Shows online/offline status and pending changes; sync manually any time.'],
        ['<strong>Document Visit</strong>', 'Write a Smart Note or capture audio offline, saved on your device.'],
        ['<strong>Pending Changes</strong>', 'Lists items queued to sync; retry any that failed once you’re back online.'],
      ])}
      ${callout('best', 'Best practice: prep before rural visits', '<p>Before heading somewhere with poor signal, open Offline Mode so your patients are cached. Document as usual; PennSync syncs everything automatically when you reconnect.</p>')}
    `,
  },

  /* 12 ── Tips & Best Practices ───────────────────────────────────────────── */
  {
    id: 'tips',
    title: 'Tips & Best Practices',
    sub: [],
    html: `
      <p class="sec-intro">A handful of habits used by PennSync’s most efficient clinicians.</p>
      ${callout('tip', 'Always select your patient in Smart Notes', '<p>AI personalizes documentation from the patient’s history — selecting them first makes every suggestion sharper.</p>')}
      ${callout('tip', 'Use voice for long visits', '<p>Visit Scribe can save 10–15 minutes per visit versus typing. Narrate naturally and let AI structure the note.</p>')}
      ${callout('tip', 'Favorite your frequent patients', '<p>Star the patients you see most for instant access from your roster.</p>')}
      ${callout('tip', 'Build a template library', '<p>Create quick phrases in the Clinical Library for common documentation (wound care, diabetic teaching) and reuse them everywhere.</p>')}
      ${callout('best', 'Review your compliance weekly', '<p>Glance at your documentation quality regularly and clear any flagged notes to keep your compliance rate high.</p>')}
      ${callout('important', 'Always review AI output', '<p>AI drafts documentation — you own it. Read every note before saving; edit anything that isn’t exactly right. PennSync learns from your corrections.</p>')}
    `,
  },

  /* 13 ── FAQ ─────────────────────────────────────────────────────────────── */
  {
    id: 'faq',
    title: 'Frequently Asked Questions',
    sub: [],
    html: `
      <p class="sec-intro">Quick answers to the questions clinicians ask most.</p>
      ${faq([
        { q: 'How do I document a visit using my voice?', a: 'Open Clinical Notes, choose Visit Scribe, and either record/upload audio or use Live Dictation. PennSync transcribes your words and generates a Medicare-compliant note for you to review and save.' },
        { q: 'Why should I always select a patient in Smart Notes?', a: 'Selecting a patient lets AI personalize documentation using their specific diagnoses, medications, and history. The more you document for a patient, the better the AI recommendations become.' },
        { q: 'How does AI enhance my clinical notes?', a: 'It expands your observations into skilled nursing language, adds medical-necessity justification, includes homebound documentation, and checks Medicare compliance — all while preserving your clinical intent.' },
        { q: 'What if AI generates something incorrect?', a: 'Always review AI-generated content. Edit it directly, regenerate, or add your own text. PennSync learns from your corrections over time.' },
        { q: 'How do I send a fax from my phone?', a: 'In Fax, use the camera to capture your document, add the recipient number, and send. PennSync can generate a professional cover page automatically.' },
        { q: 'Can I create custom documentation templates?', a: 'Yes. Use the Clinical Library to create quick phrases that expand into full documentation, including patient-specific variables.' },
        { q: 'How do OASIS suggestions work?', a: 'AI analyzes patient history, recent notes, and diagnoses to suggest appropriate OASIS responses, highlight compliance risks, and optimize for PDGM case mix. You confirm every answer.' },
        { q: 'What happens to a flagged compliance issue?', a: 'Flagged notes appear where you can review them, apply AI suggestions to fix the issue, and re-save. PennSync tracks your improvement over time.' },
        { q: 'A feature in this manual isn’t in my sidebar — why?', a: 'Some tools are limited to facility administrators. If you don’t see it, your role doesn’t include it. Contact your administrator if you believe you need access.' },
      ])}
    `,
  },

  /* 14 ── Glossary ────────────────────────────────────────────────────────── */
  {
    id: 'glossary',
    title: 'Glossary',
    sub: [],
    html: `
      <p class="sec-intro">Common terms you’ll see throughout PennSync.</p>
      ${glossary([
        { term: 'Care scope', def: 'Whether you (or a patient) are set to Home Health, Hospice, or Both. It tailors dashboards, templates, and compliance checks.' },
        { term: 'OASIS / OASIS-E', def: 'The standardized CMS assessment (Outcome and Assessment Information Set) completed at key points in a home-health episode. OASIS-E is the current version.' },
        { term: 'PDGM', def: 'Patient-Driven Groupings Model — how Medicare determines home-health payment from diagnoses, timing, and functional status (the “case mix”).' },
        { term: 'Case mix', def: 'The weighting that reflects a patient’s clinical and functional complexity, which drives PDGM reimbursement.' },
        { term: 'HHA', def: 'Home Health Agency.' },
        { term: 'Homebound', def: 'A Medicare eligibility criterion: leaving home requires considerable effort. Documentation must support homebound status for skilled home-health coverage.' },
        { term: 'Skilled documentation', def: 'Notes written in professional clinical language that show medical necessity and the skilled nature of the care provided.' },
        { term: 'Smart Note', def: 'PennSync’s typed documentation tool that turns brief observations into a complete, compliant note with AI.' },
        { term: 'Visit Scribe', def: 'PennSync’s voice documentation tool that records or dictates a visit and transcribes it into a compliant note.' },
        { term: 'Teach-back', def: 'A method of confirming patient understanding by having them restate instructions in their own words.' },
        { term: 'Telehealth', def: 'A secure video visit with a patient conducted through PennSync.' },
      ])}
    `,
  },

  /* 15 ── Support ─────────────────────────────────────────────────────────── */
  {
    id: 'support',
    title: 'Getting Help & Support',
    sub: [],
    html: `
      <p class="sec-intro">Help is always close by — inside the app and from your team.</p>
      ${grid2([
        { h: 'In-app Help', p: 'Open Help (Tools → Help) for quick-start guidance, feature overviews, a searchable FAQ, and this manual as a PDF download.' },
        { h: 'User Guides', p: 'Tools → Help → User Guides offers focused, downloadable guides for specific workflows.' },
        { h: 'Your administrator', p: 'For access, account, or agency-specific questions, contact your facility administrator.' },
        { h: 'Announcements', p: 'Watch your Dashboard for announcements about new features and training.' },
      ])}
      ${callout('tip', 'Print this manual for the workstation', '<p>Download the PDF from Help and keep a printed copy at shared workstations for quick reference during daily workflows.</p>')}
      ${navpath(['Sidebar', 'Tools', 'Help'])}
    `,
  },
];
