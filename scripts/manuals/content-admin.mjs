// content-admin.mjs — Part II of the Facility Administrator Manual.
//
// These sections cover the administrator toolset scoped to a FACILITY admin.
// Platform-owner (super-admin) surfaces are intentionally out of scope and are
// summarized in the "Handled by Your Platform Administrator" section.

import {
  navpath, callout, steps, table, faq, roleLine, grid2, glossary,
} from './theme.mjs';

export const adminBlocks = [
  /* Administrator Feature Overview ─────────────────────────────────────────── */
  {
    id: 'admin-features',
    title: 'Administrator Feature Overview',
    sub: [
      { id: 'af-users', title: 'Users & staff' },
      { id: 'af-office', title: 'Office & back-office' },
      { id: 'af-oversight', title: 'Compliance, analytics & data' },
      { id: 'af-config', title: 'Configuration' },
    ],
    html: `
      <p class="sec-intro">A quick map of the facility-administration tools. Each is covered in detail in the sections that follow.</p>

      <h3 id="af-users"><span class="h3-eyebrow">Users &amp; staff</span>Managing your team</h3>
      ${table(['Tool', 'What it does'], [
        ['<strong>Admin Console</strong>', 'Launchpad to every admin tool, plus user activity, data quality, and system health.'],
        ['<strong>User Management</strong>', 'Invite staff, assign roles, edit profiles, revoke access, and export the roster.'],
        ['<strong>Personnel &amp; Credentials</strong>', 'Personnel files, credential approvals, and agency-wide expiration/compliance tracking.'],
        ['<strong>Performance</strong>', 'Nurse-performance and skill-gap dashboards.'],
        ['<strong>Timesheets &amp; Payroll</strong>', 'Approve staff timesheets, configure visit points and payroll profiles, and export per-service-line payroll for the accountant.'],
      ])}

      <h3 id="af-office"><span class="h3-eyebrow">Office &amp; back-office</span>Front-office workflows</h3>
      ${table(['Tool', 'What it does'], [
        ['<strong>Referrals</strong>', 'Upload and process referrals with AI extraction, patient matching, and admission notes.'],
        ['<strong>Incident Review</strong>', 'Triage, acknowledge, flag state-reportable, and resolve reported incidents.'],
        ['<strong>Documents &amp; E-Signing</strong>', 'Signature requests, document storage/intake, discharge, templates, and audit logs.'],
        ['<strong>Template Management</strong>', 'Create and maintain reusable note and PDF templates.'],
      ])}

      <h3 id="af-oversight"><span class="h3-eyebrow">Oversight</span>Compliance, analytics &amp; data</h3>
      ${table(['Tool', 'What it does'], [
        ['<strong>Training Management</strong>', 'Assign courses and learning plans, auto-generate AI in-services, and track completion.'],
        ['<strong>Compliance Center</strong>', 'Real-time monitoring, regulatory tracking, and security/audit logs.'],
        ['<strong>Facility Documentation Rules</strong>', 'Define agency charting requirements (e.g. SpO₂ for oxygen patients) enforced live in every Smart Note.'],
        ['<strong>Reports &amp; Analytics</strong>', 'KPI, performance, OASIS/PDGM, predictive analytics, and documentation-impact ROI.'],
        ['<strong>Data Management</strong>', 'Patient import/export, duplicate merge, and bulk discharge.'],
      ])}

      <h3 id="af-config"><span class="h3-eyebrow">Configuration</span>Agency setup</h3>
      ${table(['Tool', 'What it does'], [
        ['<strong>Agency Settings</strong>', 'Office info, cost calculations, AI/learning, communications (TCPA), phone/fax, billing, and validation rules.'],
        ['<strong>PDGM Rate Settings</strong>', 'Configure Medicare case-mix weights, thresholds, and ICD-10 mappings.'],
        ['<strong>On-Call, Pathways &amp; Announcements</strong>', 'Coverage scheduling, clinical protocols, and staff-wide announcements.'],
      ])}
    `,
  },

  /* A ── Roles & Access ───────────────────────────────────────────────────── */
  {
    id: 'admin-roles',
    title: 'Understanding Roles & Access',
    sub: [
      { id: 'ar-tiers', title: 'The three role tiers' },
      { id: 'ar-scope', title: 'What a facility admin can do' },
    ],
    html: `
      <p class="sec-intro">PennSync uses a simple three-tier role model. As a facility administrator you can see and manage everything scoped to your agency, while a small set of platform-level tools stays with your PennSync platform administrator.</p>

      <h3 id="ar-tiers"><span class="h3-eyebrow">Who sees what</span>The three role tiers</h3>
      ${table(['Role', 'Who they are', 'What they can access'], [
        ['<strong>Clinical user</strong> (nurse)', 'Nurses, social workers, spiritual care, therapists, aides.', 'Clinical work only — patients, documentation, communication, learning. No admin, analytics, or financial data.'],
        ['<strong>Facility administrator</strong>', 'Your agency’s administrators and managers.', 'Everything a clinician sees, plus user & staff management, back-office workflows, training administration, compliance, analytics, and agency configuration.'],
        ['<strong>Platform administrator</strong> (super admin)', 'The PennSync platform owner.', 'All of the above, plus platform-level setup (telephony, background jobs, AI/OCR configuration).'],
      ])}
      ${callout('note', 'Financial data is admin-only', '<p>Dollar amounts — PDGM revenue, reimbursement estimates, and cost figures — are visible to administrators only. Clinicians never see financials, by design.</p>')}

      <h3 id="ar-scope"><span class="h3-eyebrow">Your surface</span>What a facility admin can do</h3>
      <p>Two sidebar sections appear only for administrators:</p>
      ${grid2([
        { h: 'Office', p: 'Back-office workflows: Referrals, Incident Review, and Documents & E-Signing.' },
        { h: 'Administration', p: 'Admin Console, Users, Reports & Analytics, and Compliance Center — plus every other admin tool via the Admin Console launchpad and Cmd/Ctrl + K.' },
      ])}
      ${callout('tip', 'The Admin Console is your launchpad', '<p>Rather than crowd the sidebar, PennSync surfaces the daily-use admin destinations there and keeps every other admin tool one click away inside the Admin Console directory (and Cmd/Ctrl + K search).</p>')}
    `,
  },

  /* B ── Admin Console ─────────────────────────────────────────────────────── */
  {
    id: 'admin-console',
    title: 'The Admin Console',
    sub: [{ id: 'ac-tabs', title: 'The five tabs' }],
    html: `
      <p class="sec-intro">The Admin Console is your operational command center — a launchpad to every admin tool plus live tabs for activity, data quality, and system health.</p>
      ${roleLine('Facility Admin')}
      ${navpath(['Sidebar', 'Administration', 'Admin Console'])}

      <h3 id="ac-tabs"><span class="h3-eyebrow">Everything in one place</span>The five tabs</h3>
      ${table(['Tab', 'What it shows'], [
        ['<strong>Overview</strong>', 'The admin launchpad — every administrative tool grouped by function (Users & Staff, Clinical Oversight, Training, Data & Documents, System & Configuration), plus a status summary.'],
        ['<strong>User Activity</strong>', 'A real-time audit of who did what — logins, page visits, and record changes — filterable by user, and exportable.'],
        ['<strong>Data Quality</strong>', 'Completeness scoring, missing required fields, and validation issues you can act on.'],
        ['<strong>System Health</strong>', 'Live status indicators for the platform (sync status, service availability, storage).'],
        ['<strong>Settings</strong>', 'Quick access to facility configuration and preferences.'],
      ])}
      ${callout('tip', 'Deep-link straight to a tab', '<p>Any tab is directly reachable, e.g. Admin Console → User Activity. Use Cmd / Ctrl + K and type “activity”, “data quality”, or “system health” to jump there.</p>')}
    `,
  },

  /* C ── Users & Staff ────────────────────────────────────────────────────── */
  {
    id: 'admin-users',
    title: 'Users & Staff',
    sub: [
      { id: 'us-manage', title: 'User Management' },
      { id: 'us-invite', title: 'Inviting & onboarding users' },
      { id: 'us-personnel', title: 'Personnel files & credentials' },
      { id: 'us-performance', title: 'Performance & skill gaps' },
    ],
    html: `
      <p class="sec-intro">Add and manage your team, control access, and keep everyone’s licenses and certifications current and audit-ready.</p>
      ${roleLine('Facility Admin')}

      <h3 id="us-manage"><span class="h3-eyebrow">Access control</span>User Management</h3>
      ${navpath(['Sidebar', 'Administration', 'Users'])}
      <p>The Users screen is your staff directory. For each person you can:</p>
      ${grid2([
        { h: 'Assign a role', p: 'Administrator or clinical user — this controls everything they can see.' },
        { h: 'Edit their profile', p: 'Name, phone, credential type, license number, care scope, manager, and approval status.' },
        { h: 'Revoke or restore access', p: 'Disable an account when someone leaves and re-enable it if they return.' },
        { h: 'Export the roster', p: 'Download the full staff list as a PDF for records or audits.' },
      ])}

      <h3 id="us-invite"><span class="h3-eyebrow">Bring people on</span>Inviting & onboarding users</h3>
      ${steps([
        ['Send an invitation', 'From Users (or User Setup), enter the new person’s email and full name and choose their role.'],
        ['They accept', 'The invitee gets an email and sets their password. Invited users are auto-approved on sign-up — no extra approval step.'],
        ['Track & resend', 'Pending invitations are listed with their status. Invitations expire after 7 days; resend one in a click if it lapses.'],
      ])}
      ${callout('note', 'Resetting a password', '<p>If a team member is locked out, you can trigger a password reset for them from Users — no need to involve the platform administrator.</p>')}

      <h3 id="us-personnel"><span class="h3-eyebrow">Stay audit-ready</span>Personnel files & credentials</h3>
      ${navpath(['Admin Console', 'Users & Staff', 'Personnel File'])}
      <p>Personnel files hold each staff member’s licenses, certifications, and insurance. As an administrator you can:</p>
      ${table(['Task', 'Where'], [
        ['Approve or reject credential uploads', 'Personnel File → Approvals'],
        ['Track expirations across the whole agency', 'Personnel File → Expiration Tracking'],
        ['Run an agency-wide compliance audit', 'Credential Compliance'],
        ['Send renewal reminders', 'Automatic, with manual follow-up available'],
      ])}
      ${callout('important', 'Never let a credential lapse', '<p>The <strong>Credential Compliance</strong> dashboard flags expired and soon-to-expire licenses agency-wide and exports an audit-ready report. Review it on a regular cadence so no clinician works on an expired credential.</p>')}

      <h3 id="us-performance"><span class="h3-eyebrow">Coach your team</span>Performance & skill gaps</h3>
      ${grid2([
        { h: 'Nurse Performance', p: 'Documentation quality, visit completion, compliance adherence, and productivity per clinician — with drill-down.' },
        { h: 'Skill Gap Dashboard', p: 'Competency gaps by role, with recommended training paths to close them.' },
      ])}
    `,
  },

  /* D ── Office / Back-office ──────────────────────────────────────────────── */
  {
    id: 'admin-office',
    title: 'Office & Back-Office Workflows',
    sub: [
      { id: 'of-referrals', title: 'Referral intake & triage' },
      { id: 'of-incidents', title: 'Incident review' },
      { id: 'of-documents', title: 'Documents & e-signing' },
      { id: 'of-templates', title: 'Template management' },
    ],
    html: `
      <p class="sec-intro">The Office section holds the back-office workflows that keep patients flowing in and paperwork moving — kept out of the clinical view so nurses stay focused.</p>
      ${roleLine('Facility Admin')}

      <h3 id="of-referrals"><span class="h3-eyebrow">Admissions</span>Referral intake & triage</h3>
      ${navpath(['Sidebar', 'Office', 'Referrals'])}
      ${steps([
        ['Upload the referral', 'Drop in the referral PDF or document.'],
        ['Review AI-extracted data', 'PennSync pulls demographics, diagnoses, medications, orders, and insurance — and flags anything missing.'],
        ['Match the patient', 'Link to an existing patient or create a new record from the extracted data.'],
        ['Generate the admission note', 'Move through Processor and Admission Note steps to complete the intake.'],
      ])}
      <p>Use <strong>Referral Triage</strong> to prioritize incoming referrals by urgency and route them to the right team.</p>
      ${callout('note', 'Face-to-Face compliance is checked automatically', '<p>When a referral includes a Face-to-Face encounter, the analyzer shows a <strong>Face-to-Face Encounter</strong> badge — <strong>Compliant</strong>, <strong>Non-compliant</strong>, or <strong>Needs review</strong> (per 42 CFR 424.22) — with the specific reasons: encounter present, eligible certifying practitioner, the 90-days-before / 30-days-after-SOC timing window, and diagnosis linkage. It’s a deterministic check of the extracted referral data, shown only to intake/admin staff.</p>')}

      <h3 id="of-incidents"><span class="h3-eyebrow">Safety follow-through</span>Incident review</h3>
      ${navpath(['Sidebar', 'Office', 'Incident Review'])}
      <p>Staff report incidents from the clinical Incidents screen; you triage and close them here — acknowledge receipt, flag events as state-reportable, generate any required regulatory filing, and track corrective actions to resolution.</p>

      <h3 id="of-documents"><span class="h3-eyebrow">Paperwork, digitized</span>Documents & e-signing</h3>
      ${navpath(['Sidebar', 'Office', 'Documents'])}
      ${table(['Tab', 'What it does'], [
        ['<strong>Signatures</strong>', 'Create single or bulk e-signature requests, track status, resend reminders, and download signed documents.'],
        ['<strong>Documents</strong>', 'Store and organize the document library; scan and mark signature fields on new documents (with OCR).'],
        ['<strong>Discharge</strong>', 'Generate, edit, and send discharge summaries and letters.'],
        ['<strong>Library</strong>', 'Reusable document templates.'],
        ['<strong>Analytics & Audit</strong>', 'Workflow metrics, and a full audit of who accessed, modified, or signed each document.'],
      ])}

      <h3 id="of-templates"><span class="h3-eyebrow">Standardize documentation</span>Template management</h3>
      ${navpath(['Admin Console', 'Data & Documents', 'Template Management'])}
      <p>Create and maintain reusable templates: clinical note/visit/assessment templates and custom PDF forms and letters. Standard templates keep documentation consistent and compliant across your team. (The document-template editor is admin-only; the PDF template library is available to all staff.)</p>
      ${callout('tip', 'Seed and share quick phrases', '<p>In the <strong>Clinical Library</strong>, administrators can one-click <strong>Add starter phrases</strong> — six ready-made, agency-wide quick phrases (diabetic education, fall risk assessment, homebound status, medication reconciliation, wound care provided, pain assessment). It’s safe to click repeatedly; only missing phrases are added. Only administrators can mark a phrase <strong>agency-wide</strong>; any user can create their own and can bind a phrase to a specific patient.</p>')}
    `,
  },

  /* D2 ── Timesheets & Payroll ────────────────────────────────────────────── */
  {
    id: 'admin-timesheets',
    title: 'Timesheets, Approvals & Payroll',
    sub: [
      { id: 'at-approve', title: 'Approving timesheets' },
      { id: 'at-export', title: 'Payroll export & reports' },
      { id: 'at-setup', title: 'Payroll setup' },
    ],
    html: `
      <p class="sec-intro">Staff submit biweekly timesheets from Tools ▸ Timesheets; you review them, export payroll per service line for the accountant, and configure how each employee is paid. PennSync tracks hours, visit points, PTO, miles, and reimbursements — never pay rates or wages.</p>
      ${roleLine('Facility Admin')}
      ${navpath(['Sidebar', 'Tools', 'Timesheets'])}
      <p>As an approver you see extra tabs alongside <strong>My Timesheet</strong>: <strong>Approvals</strong> (admins and managers), plus admin-only <strong>Payroll Export</strong>, <strong>Reports</strong>, and <strong>Payroll Setup</strong>. The Timesheets item in the sidebar shows a badge counting sheets awaiting <em>your</em> review — managers see their direct reports, admins see all submitted sheets.</p>

      <h3 id="at-approve"><span class="h3-eyebrow">Review &amp; sign off</span>Approving timesheets</h3>
      ${steps([
        ['Open Approvals', 'The queue lists submitted timesheets oldest first. Each card shows the employee, service line, period, a full breakdown (Regular / OT / Holiday / On-call / PTO / points or visits), any auto-carried PTO, and the employee’s notes.'],
        ['Approve or return', 'Use <strong>Approve</strong> (optional note) or <strong>Return</strong> for changes (note recommended — it’s shown to the employee). With several pending, <strong>Approve all</strong> handles the batch with one shared note.'],
        ['PennSync notifies the employee', 'Approval and return each trigger an in-app notification and a branded email. Approved sheets lock and flow into the payroll export.'],
      ])}
      ${callout('important', 'Approval guardrails', '<p>Only an administrator or the employee’s assigned manager can review a sheet, and <strong>no one can approve their own timesheet</strong> — not even an admin. Approved sheets can no longer be edited by the employee; if something must change, return it before approving, or have the employee submit a correction through you. Editing or resubmitting a returned sheet clears the prior review and re-notifies the approver.</p>')}

      <h3 id="at-export"><span class="h3-eyebrow">To the accountant</span>Payroll export &amp; reports</h3>
      ${steps([
        ['Pick the pay period', 'Payroll Export shows the period’s due date and payday, and how many approved timesheets it contains. <strong>Only approved timesheets are included.</strong>'],
        ['Check coverage', 'A coverage strip per service line shows who’s <em>approved</em>, who’s <em>awaiting approval</em>, and — in red — active employees who have <em>not submitted</em>, so no one is silently left off payroll.'],
        ['Export the files', 'Home Health and Hospice export as separate files, each as <strong>Excel (CSV)</strong> or <strong>PDF</strong>. Home Health includes point columns (Regular Points, Emerg Visit Pts) plus hours, PTO, miles, and reimbursements; Hospice is hourly with on-call visits. Totals and rate notes (e.g. mileage at $0.45/mile) are included.'],
      ])}
      <p>The <strong>Reports</strong> tab adds a flexible hours-and-points report — group by pay period, employee, or service line; filter by status (approved only, submitted + approved, or all); export to CSV.</p>
      ${callout('note', 'The payroll calendar', '<p>Pay periods are biweekly, Sunday through Saturday. Timesheets are due before <strong>noon on the Monday</strong> after the period ends, and payday is normally the <strong>Friday after the period ends</strong> — moved to the Thursday before when that Friday is a bank holiday (New Year’s Day, Juneteenth, Independence Day, Veterans Day, Christmas). A specific period can also carry a payroll-confirmed one-off payday; whatever the schedule resolves to is what staff see on the timesheet form, which is always the authoritative date.</p>')}

      <h3 id="at-setup"><span class="h3-eyebrow">Configure once</span>Payroll setup</h3>
      ${table(['Card', 'What you configure'], [
        ['<strong>Visit Point Values</strong>', 'The point value credited per visit type — SOC, ROC, Recert, Routine Visit, Discharge. Points are units of work; no dollar amounts.'],
        ['<strong>Employee Payroll Setup</strong>', 'Per employee: company / service line (Home Health or Hospice), <em>Paid by points</em> (home-health field staff only — office and all hospice staff are hourly), a standing phone reimbursement/pay amount, and an Applied (active) toggle.'],
      ])}
      ${callout('best', 'Set the payroll profile at onboarding', '<p>An employee’s service line and points eligibility drive what their timesheet form shows. Set their payroll profile when you create their account so their very first timesheet is right.</p>')}
    `,
  },

  /* E ── Training administration ──────────────────────────────────────────── */
  {
    id: 'admin-training',
    title: 'Training & Education Administration',
    sub: [
      { id: 'tr-manager', title: 'The Training Manager' },
      { id: 'tr-ai', title: 'AI-generated training' },
      { id: 'tr-reports', title: 'Training analytics & reports' },
    ],
    html: `
      <p class="sec-intro">Create, assign, and track staff training — and prove annual and compliance education is complete.</p>
      ${roleLine('Facility Admin')}

      <h3 id="tr-manager"><span class="h3-eyebrow">Assign & track</span>The Training Manager</h3>
      ${navpath(['Admin Console', 'Training & Education', 'Training Manager'])}
      ${table(['Area', 'What you manage'], [
        ['<strong>Courses</strong>', 'Create, edit, and publish training content (with an SME review queue).'],
        ['<strong>Learning Plans</strong>', 'Assign custom learning paths to individuals or groups, with due dates.'],
        ['<strong>Annual Mandatory</strong>', 'Track annual education and compliance completion.'],
        ['<strong>Policies</strong>', 'Require and track policy acknowledgments.'],
        ['<strong>Video Studio</strong>', 'Create or upload training video content.'],
        ['<strong>Compliance Report</strong>', 'Aggregate, org-wide training completion and compliance status.'],
      ])}

      <h3 id="tr-ai"><span class="h3-eyebrow">Content in minutes</span>AI-generated training</h3>
      ${grid2([
        { h: 'AI Training Generator', p: 'Turn a topic or your policies into a ready-to-assign course.' },
        { h: 'AI Compliance In-Services', p: 'Auto-generate compliance in-services from regulatory updates and assign them to staff.' },
      ])}

      <h3 id="tr-reports"><span class="h3-eyebrow">Prove it</span>Training analytics & reports</h3>
      <p>Use <strong>Training Analytics</strong> for completion rates, time-to-completion, and competency mastery, and <strong>Learning Reports</strong> for exportable transcripts, completion summaries, and attestation reports.</p>
      ${callout('best', 'Best practice: automate the annual cycle', '<p>Build a learning plan for annual mandatory education, assign it to everyone with a due date, and watch the Compliance Report — you’ll always know exactly who’s outstanding before survey season.</p>')}
    `,
  },

  /* F ── Compliance & Quality ─────────────────────────────────────────────── */
  {
    id: 'admin-compliance',
    title: 'Compliance & Quality',
    sub: [
      { id: 'cq-center', title: 'The Compliance Center' },
      { id: 'cq-docrules', title: 'Facility Documentation Rules' },
    ],
    html: `
      <p class="sec-intro">Monitor documentation quality, regulatory alignment, and security from a single hub — and stay audit-ready year round.</p>
      ${roleLine('Facility Admin')}
      ${navpath(['Sidebar', 'Administration', 'Compliance Center'])}

      <h3 id="cq-center"><span class="h3-eyebrow">One hub</span>The Compliance Center</h3>
      ${table(['Tab', 'What it covers'], [
        ['<strong>Dashboard</strong>', 'Real-time compliance metrics and monitoring, top issues, and compliance by user or team.'],
        ['<strong>Regulatory</strong>', 'Medicare and state requirements, rule tracking, and audit-readiness scoring.'],
        ['<strong>Security</strong>', 'Access and change audit logs, security policy management, and policy acknowledgment enforcement.'],
      ])}
      ${callout('important', 'Turn flags into fixes', '<p>Compliance flags are only useful if they’re closed. Review the dashboard regularly, work the flagged items with your team, and use corrective-action tracking so nothing slips.</p>')}

      <h3 id="cq-docrules"><span class="h3-eyebrow">Your rules, enforced at the point of care</span>Facility Documentation Rules</h3>
      ${navpath(['Sidebar', 'Administration', 'Facility Doc Rules'])}
      <p>Facility Documentation Rules turn agency policy and state-survey findings into live checklist items inside every Smart Note: <em>if the patient matches condition X, the note must contain Y</em>. Matching clinicians see a <strong>Facility Documentation Requirements</strong> panel that checks itself off as they type.</p>
      ${steps([
        ['Start from a preset or a blank rule', 'Use the one-click <strong>Quick add</strong> presets — “Oxygen patients require SpO2”, “Diabetic patients require blood sugar”, “Wounds require measurements” — or choose <strong>New Rule</strong>.'],
        ['Define who it applies to', 'Pick a condition: every patient, diagnosis contains…, medication contains…, has an active wound, or care type (Home Health / Hospice) — with comma-separated condition keywords where relevant. Optionally limit it to specific visit types (none selected = all visits).'],
        ['Define what the note must contain', 'Write the requirement text the nurse sees, then list the <strong>required-in-the-note keywords</strong>. If <em>any one</em> keyword appears in the note, the requirement is satisfied. Leave the keywords empty to make it an advisory, confirm-manually item.'],
        ['Set severity and provenance', 'Only <strong>critical</strong> rules block saving; high/medium/low are advisory. Use <strong>Source</strong> (e.g. “PA State Survey 2025”) so the team knows why the rule exists, and the <strong>Active</strong> toggle to retire a rule without deleting it.'],
      ])}
      ${callout('important', 'List every synonym', '<p>Keyword matching is literal (case-insensitive). For an SpO₂ rule, list all the ways nurses write it — <em>spo2, o2 sat, oxygen saturation, pulse ox</em> — or compliant notes will be flagged as missing it.</p>')}
      ${callout('note', 'How the save gate works', '<p>Unmet requirements nudge the nurse while drafting; on the final note, an unmet <strong>critical</strong> requirement disables Save until the detail is documented or the nurse explicitly acknowledges saving without it. Every acknowledged override is recorded in the audit log — review them to tune your rules.</p>')}
    `,
  },

  /* G ── Reports & Analytics ──────────────────────────────────────────────── */
  {
    id: 'admin-reports',
    title: 'Reports & Analytics',
    sub: [
      { id: 'ra-hub', title: 'The analytics hub' },
      { id: 'ra-more', title: 'Predictive, agency & impact views' },
    ],
    html: `
      <p class="sec-intro">Understand your agency’s performance — clinical, operational, and financial — and turn documentation quality into measurable value.</p>
      ${roleLine('Facility Admin')}
      ${navpath(['Sidebar', 'Administration', 'Reports & Analytics'])}

      <h3 id="ra-hub"><span class="h3-eyebrow">Your numbers</span>The analytics hub</h3>
      ${table(['Tab', 'What it shows'], [
        ['<strong>KPI Dashboard</strong>', 'Volume, outcomes, on-time visits, and financial KPIs.'],
        ['<strong>Performance Dashboard</strong>', 'Documentation time, AI utilization, and quality scores, with per-clinician drill-down.'],
        ['<strong>Referral Volume</strong>', 'Admissions by source and timing, and referral-to-admission conversion.'],
        ['<strong>Nurse Performance</strong>', 'Individual clinician metrics with benchmarking.'],
        ['<strong>OASIS & PDGM</strong>', 'Assessment compliance/outcomes, case-mix distribution, and reimbursement impact.'],
        ['<strong>Reports Center</strong>', 'Pre-built and custom reports; schedule and email them, exportable to PDF/CSV.'],
      ])}

      <h3 id="ra-more"><span class="h3-eyebrow">Look ahead</span>Predictive, agency & impact views</h3>
      ${grid2([
        { h: 'Predictive Analytics', p: 'AI risk scoring (readmission, deterioration) and population trends. The Rehospitalization tab now leads with a PPH Prevention Worklist — patients ranked by preventable-hospitalization risk (urgent / high / moderate / watch), flagged when inside the 31-day post-discharge window, with recommended interventions. Risk-list rows link straight to the patient chart.' },
        { h: 'Agency Analytics', p: 'Operational KPIs: census, utilization, and outcome benchmarking.' },
        { h: 'Documentation Impact', p: 'How stronger documentation lifts PDGM case-mix weight and estimated reimbursement (before vs. after). Financial figures are admin-only.' },
        { h: 'User Activity Report', p: 'A detailed, exportable audit log of user actions.' },
      ])}
    `,
  },

  /* H ── Data Management ──────────────────────────────────────────────────── */
  {
    id: 'admin-data',
    title: 'Data Management',
    sub: [{ id: 'dm-tools', title: 'Import, merge & bulk operations' }],
    html: `
      <p class="sec-intro">Keep your patient data clean and move it in bulk when you need to.</p>
      ${roleLine('Facility Admin')}

      <h3 id="dm-tools"><span class="h3-eyebrow">Bulk & cleanup</span>Import, merge & bulk operations</h3>
      ${table(['Tool', 'What it does', 'Where'], [
        ['<strong>Data Management</strong>', 'Import and export patient data with validation and column mapping; archive and restore patients.', 'Admin Console → Data & Documents'],
        ['<strong>Duplicate Patients</strong>', 'Find and merge duplicate records — consolidating visits, medications, and history. Detection now also surfaces near-miss dates of birth (off-by-a-day data-entry errors) and lists weakly linked records (e.g. a shared phone number) alongside their duplicate cluster for review — nothing is ever merged automatically.', 'Patients → Duplicate Patients'],
        ['<strong>Bulk Discharge Import</strong>', 'Batch-discharge patients and close episodes from a CSV/Excel file, with validation.', 'Admin Console → Data & Documents'],
      ])}
      ${callout('important', 'Validate before you import', '<p>Bulk operations touch many records at once. Always review the validation results before confirming an import, and merge duplicates deliberately — merges combine visit history and medications.</p>')}
    `,
  },

  /* I ── System Configuration ─────────────────────────────────────────────── */
  {
    id: 'admin-config',
    title: 'System Configuration',
    sub: [
      { id: 'sc-agency', title: 'Agency Settings' },
      { id: 'sc-pdgm', title: 'PDGM Rate Settings' },
      { id: 'sc-oncall', title: 'On-Call Schedule' },
      { id: 'sc-extras', title: 'Pathways & announcements' },
    ],
    html: `
      <p class="sec-intro">Configure how PennSync works for your agency — from office details and communication rules to reimbursement rates and clinical protocols.</p>
      ${roleLine('Facility Admin')}

      <h3 id="sc-agency"><span class="h3-eyebrow">Your agency, your rules</span>Agency Settings</h3>
      ${navpath(['Admin Console', 'System & Configuration', 'Agency Settings'])}
      ${table(['Group', 'What you configure'], [
        ['<strong>General</strong>', 'Office name, address, ZIP, and wage index (used in PDGM calculations).'],
        ['<strong>Cost Calculations</strong>', 'Staff and audit hourly rates, training cost, documentation time per episode, and episodes per year — these power ROI and Documentation Impact figures.'],
        ['<strong>AI & Learning</strong>', 'Enable AI learning and pattern sharing, choose a model preference (fast / balanced / accurate), set a confidence threshold, and add custom prompts or terminology.'],
        ['<strong>Communications (TCPA)</strong>', 'Enable SMS, set quiet hours and a monthly SMS cap, define business hours and after-hours handling, and manage SMS templates.'],
        ['<strong>Phone & Fax</strong>', 'Main office number, fax number, fax receiving, and voicemail settings.'],
        ['<strong>Billing & Subscription</strong>', 'Enterprise status, the agency code providers use to join, and enabled features.'],
        ['<strong>Validation Rules</strong>', 'Create agency-specific data-validation rules with field constraints and messages.'],
      ])}

      <h3 id="sc-pdgm"><span class="h3-eyebrow">Reimbursement</span>PDGM Rate Settings</h3>
      ${navpath(['Admin Console', 'System & Configuration', 'PDGM Rate Settings'])}
      <p>Configure the Medicare PDGM tables that drive payment estimates: the base payment rate, clinical-group case-mix weights, functional-impairment thresholds and multipliers, comorbidity multipliers, and ICD-10-to-clinical-group mappings.</p>
      ${callout('note', 'Keep rates current each year', '<p>CMS updates PDGM rates annually. Review these settings when new rates take effect so revenue estimates and Documentation Impact stay accurate.</p>')}

      <h3 id="sc-oncall"><span class="h3-eyebrow">Coverage</span>On-Call Schedule</h3>
      ${navpath(['Sidebar', 'Tools', 'On-Call'])}
      <p>All staff can view the on-call schedule; only administrators can edit it. Assign staff to holiday and overnight (weeknight) coverage slots, add notes, and spot coverage gaps before they happen.</p>

      <h3 id="sc-extras"><span class="h3-eyebrow">Guide & inform</span>Pathways & announcements</h3>
      ${grid2([
        { h: 'Clinical Pathways', p: 'Create and maintain evidence-based clinical protocols and assign them to patient populations.' },
        { h: 'Announcements', p: 'Post info, warning, or urgent announcements to all staff, with scheduling and expiration — they appear on everyone’s Dashboard.' },
      ])}
    `,
  },

  /* J ── Super-admin boundary ─────────────────────────────────────────────── */
  {
    id: 'admin-superadmin',
    title: 'Handled by Your Platform Administrator',
    sub: [],
    html: `
      <p class="sec-intro">A few platform-level tools are reserved for the PennSync platform administrator (super admin) — not the facility admin. If you need something here, contact your platform administrator.</p>
      ${table(['Area', 'What it covers', 'Owner'], [
        ['<strong>Telephony setup</strong>', 'Telnyx API secrets, provisioning work phone numbers, and A2P 10DLC SMS registration and consent.', 'Platform admin'],
        ['<strong>Communications delivery</strong>', 'Platform-wide SMS / call / fax delivery monitoring and webhook logs.', 'Platform admin'],
        ['<strong>Background jobs</strong>', 'Scheduled platform tasks (nightly jobs, reminders) and their run status.', 'Platform admin'],
        ['<strong>AI & OCR configuration</strong>', 'Platform AI model settings, auto-tagging, and OCR training/feedback.', 'Platform admin'],
      ])}
      ${callout('note', 'This is expected', '<p>Not seeing these pages is normal for a facility administrator. They configure the underlying platform and are intentionally kept out of the agency-level toolset.</p>')}
    `,
  },

  /* K ── Checklists ───────────────────────────────────────────────────────── */
  {
    id: 'admin-checklists',
    title: 'Admin Best Practices & Checklists',
    sub: [
      { id: 'ck-onboard', title: 'Onboarding a new clinician' },
      { id: 'ck-monthly', title: 'Monthly compliance rhythm' },
      { id: 'ck-audit', title: 'Audit / survey preparation' },
    ],
    html: `
      <p class="sec-intro">Repeatable routines that keep your agency compliant, staffed, and audit-ready.</p>

      <h3 id="ck-onboard"><span class="h3-eyebrow">Day one</span>Onboarding a new clinician</h3>
      ${steps([
        ['Invite the user', 'Users → invite with email, name, and the clinical-user role.'],
        ['Set their care scope', 'Confirm Home Health, Hospice, or Both on their profile.'],
        ['Set their payroll profile', 'Timesheets → Payroll Setup: service line (Home Health / Hospice), paid-by-points where applicable, and any standing phone reimbursement — so their first timesheet is right.'],
        ['Record credentials', 'Add licenses/certifications with expiration dates in their personnel file and approve them.'],
        ['Assign onboarding training', 'Assign a learning plan and any annual mandatory education.'],
        ['Add to coverage', 'Place them into the on-call rotation as appropriate.'],
      ])}
      ${callout('note', 'First sign-in includes a recorded sign-off', '<p>Before first use, every user must accept the <strong>AI-Generated Content Responsibility</strong> agreement — an acknowledgment that AI-drafted material must be reviewed before it is used or submitted. Acceptance is recorded automatically (name, date, agreement version) on their account and in the audit log; no admin action is needed.</p>')}

      <h3 id="ck-monthly"><span class="h3-eyebrow">Every month</span>Monthly compliance rhythm</h3>
      ${steps([
        ['Check Credential Compliance', 'Clear anything expired or expiring soon.'],
        ['Review the Compliance Center', 'Work down flagged documentation and open corrective actions.'],
        ['Review training completion', 'Follow up on outstanding annual/compliance training.'],
        ['Scan User Activity', 'Confirm access is appropriate and remove access for anyone who has left.'],
      ])}

      <h3 id="ck-audit"><span class="h3-eyebrow">Before a survey</span>Audit / survey preparation</h3>
      ${steps([
        ['Pull compliance & regulatory reports', 'Export current status from the Compliance Center.'],
        ['Verify credentials & training', 'Confirm every active clinician is current on licenses and mandatory education.'],
        ['Review OASIS quality', 'Check OASIS compliance and documentation completeness.'],
        ['Export the audit trail', 'Generate the User Activity / audit report for the review window.'],
      ])}
      ${callout('best', 'Keep it continuous', '<p>Agencies that treat compliance as a monthly rhythm rather than a pre-survey scramble consistently score better and carry far less last-minute stress.</p>')}
    `,
  },

  /* L ── Admin FAQ ────────────────────────────────────────────────────────── */
  {
    id: 'admin-faq',
    title: 'Administrator FAQ',
    sub: [],
    html: `
      <p class="sec-intro">Answers to the questions facility administrators ask most.</p>
      ${faq([
        { q: 'How do I add a new staff member?', a: 'Go to Users (or User Setup), send an invitation with their email, name, and role. They set their own password from the invite and are auto-approved on sign-up.' },
        { q: 'An invitation expired — what now?', a: 'Invitations expire after 7 days. Open the pending invitations list and resend it in one click.' },
        { q: 'How do I change someone’s role or revoke access?', a: 'Open the person in Users, change their role between administrator and clinical user, or disable the account to revoke access. Re-enable it any time.' },
        { q: 'Why can’t I see Telnyx, background jobs, or AI Tools?', a: 'Those are platform-administrator (super-admin) tools, not facility-admin tools. Contact your PennSync platform administrator for changes there.' },
        { q: 'How do I approve a clinician’s license or certification?', a: 'Open Personnel File → Approvals, review the uploaded credential, and approve or reject it. Expiration Tracking and Credential Compliance then keep it monitored.' },
        { q: 'How do I export a report?', a: 'In Reports & Analytics, open the relevant tab or the Reports Center and export to PDF or CSV; you can also schedule recurring reports by email.' },
        { q: 'Where do I update Medicare PDGM rates?', a: 'Admin Console → System & Configuration → PDGM Rate Settings. Update the base rate, case-mix weights, thresholds, multipliers, and ICD-10 mappings when CMS publishes new rates.' },
        { q: 'How do I post an announcement to all staff?', a: 'Use the Announcements manager to publish an info, warning, or urgent message with optional scheduling and expiration; it appears on every user’s Dashboard.' },
        { q: 'How do I create a facility documentation rule?', a: 'Administration → Facility Doc Rules. Start from a Quick add preset or New Rule: define who it applies to (diagnosis, medication, wound, care type, or everyone), the requirement text nurses see, the required-in-note keywords (list every synonym), and the severity — only critical rules block saving, and acknowledged overrides are audit-logged.' },
        { q: 'How do I approve timesheets and run payroll?', a: 'Tools → Timesheets. The Approvals tab lists submitted sheets — approve or return each (or Approve all). Then in Payroll Export, pick the pay period and export Home Health and Hospice as separate CSV or PDF files. Only approved timesheets are included; the coverage strip flags anyone who hasn’t submitted.' },
        { q: 'Why is an employee missing from the payroll export?', a: 'Their timesheet isn’t approved for that period — it’s still submitted (approve it), returned (they must resubmit), or never submitted. The coverage strip in Payroll Export names anyone expected who hasn’t submitted.' },
        { q: 'Can an approved timesheet be changed?', a: 'No — approval locks the sheet, and the employee can’t submit a second one for the same period. Return a sheet for changes before approving it; the employee can edit only draft and returned sheets.' },
        { q: 'How do I set what a visit is worth in points?', a: 'Tools → Timesheets → Payroll Setup → Visit Point Values: set the points credited per SOC, ROC, Recert, Routine Visit, and Discharge. Points are units of work — PennSync stores no pay rates or wages.' },
      ])}
      ${glossary([
        { term: 'Facility administrator', def: 'An agency-level administrator who can manage users, workflows, compliance, analytics, and configuration — everything scoped to your agency.' },
        { term: 'Platform administrator', def: 'The PennSync platform owner (super admin) who configures platform-level services such as telephony, background jobs, and AI/OCR.' },
        { term: 'A2P 10DLC', def: 'The carrier registration standard for application-to-person business texting. Managed by the platform administrator.' },
        { term: 'TCPA', def: 'Telephone Consumer Protection Act — governs SMS/calling consent and quiet hours, configured in Agency Settings → Communications.' },
      ])}
    `,
  },
];
