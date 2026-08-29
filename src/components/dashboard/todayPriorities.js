import { parseLocalDate } from '../../lib/dateLocal.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5;

// Whole calendar days from `now` to `value` (negative in the past).
//
// parseLocalDate returns the SAME Date instance when it is handed one, so
// calling setHours on its result mutated the caller's object: `now` (and any
// Date stored on a record) was silently rewound to local midnight. Normalize on
// copies so this stays a pure read.
function startOfDay(value) {
  const d = parseLocalDate(value);
  if (!d) return null;
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysUntil(value, now = new Date()) {
  const due = startOfDay(value);
  const today = startOfDay(now);
  if (!due || !today) return null;
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
}

function isToday(value, now = new Date()) {
  return daysUntil(value, now) === 0;
}

function patientName(patient) {
  const name = [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim();
  return name || patient?.full_name || patient?.name || 'Patient';
}

function visitTimeLabel(visit) {
  const time = visit?.visit_time || visit?.scheduled_time || visit?.start_time;
  return time ? ` at ${time}` : '';
}

function countOpenMessages(messages = [], user) {
  return messages.filter((message) => !message?.read_by?.includes(user?.email)).length;
}

function priorityScore(priority) {
  const severity = { critical: 0, high: 1, medium: 2, low: 3 }[priority.severity] ?? 4;
  return severity * 100 + (priority.sortOrder ?? 50);
}

function createPriority({ id, title, description, actionLabel, to, severity = 'medium', role = 'all', sortOrder = 50 }) {
  return { id, title, description, actionLabel, to, severity, role, sortOrder };
}

export function buildTodayPriorities({
  currentUser,
  visits = [],
  patients = [],
  incidents = [],
  noteConversions = [],
  messages = [],
  dashboardError = null,
  now = new Date(),
  limit = DEFAULT_LIMIT,
} = {}) {
  const superAdminEmail = (import.meta.env?.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const isOwnerSuperAdmin = superAdminEmail && String(currentUser?.email || '').trim().toLowerCase() === superAdminEmail;
  const isAdmin = currentUser?.role === 'admin' || ['agency_admin', 'super_admin'].includes(currentUser?.account_type) || isOwnerSuperAdmin;
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const priorities = [];

  if (dashboardError) {
    priorities.push(createPriority({
      id: 'dashboard-data-error',
      title: 'Dashboard data needs a retry',
      description: 'Some priority data could not load. Refresh before making scheduling or clinical decisions.',
      actionLabel: 'Refresh dashboard',
      to: '/Dashboard',
      severity: 'critical',
      sortOrder: 0,
    }));
  }

  const todayScheduledVisits = visits.filter((visit) => visit?.status === 'scheduled' && isToday(visit.visit_date || visit.scheduled_date, now));
  if (todayScheduledVisits.length > 0) {
    const firstVisit = todayScheduledVisits[0];
    const firstPatient = patientById.get(firstVisit.patient_id);
    priorities.push(createPriority({
      id: 'todays-scheduled-visits',
      title: `${todayScheduledVisits.length} visit${todayScheduledVisits.length === 1 ? '' : 's'} scheduled today`,
      description: `Start with ${patientName(firstPatient)}${visitTimeLabel(firstVisit)} and keep documentation current as you go.`,
      actionLabel: 'Open clinical notes',
      to: '/ClinicalDocumentation',
      severity: 'high',
      role: 'clinician',
      sortOrder: 10,
    }));
  }

  const completedWithoutNotes = visits.filter((visit) => visit?.status === 'completed' && !visit?.note_id && isToday(visit.visit_date || visit.completed_date, now));
  if (completedWithoutNotes.length > 0) {
    priorities.push(createPriority({
      id: 'completed-visits-missing-notes',
      title: `${completedWithoutNotes.length} completed visit${completedWithoutNotes.length === 1 ? '' : 's'} need notes`,
      description: 'Complete same-day documentation while details are fresh and before QA or billing review.',
      actionLabel: 'Finish notes',
      to: '/SmartNoteAssistant',
      severity: 'critical',
      role: 'clinician',
      sortOrder: 5,
    }));
  }

  const highRiskPatients = patients.filter((patient) => {
    const risk = String(patient?.risk_level || patient?.riskLevel || '').toLowerCase();
    return risk === 'high' || risk === 'critical' || patient?.hospitalization_risk === 'high';
  });
  if (highRiskPatients.length > 0) {
    priorities.push(createPriority({
      id: 'high-risk-patients',
      title: `${highRiskPatients.length} high-risk patient${highRiskPatients.length === 1 ? '' : 's'} to review`,
      description: `Prioritize ${patientName(highRiskPatients[0])} and confirm follow-up, education, and escalation plans.`,
      actionLabel: 'Review patients',
      to: '/Patients',
      severity: 'high',
      role: 'clinician',
      sortOrder: 20,
    }));
  }

  const activeIncidents = incidents.filter((incident) => !['resolved', 'closed', 'dismissed'].includes(String(incident?.status || '').toLowerCase()));
  if (activeIncidents.length > 0) {
    priorities.push(createPriority({
      id: 'open-incidents',
      title: `${activeIncidents.length} incident${activeIncidents.length === 1 ? '' : 's'} need follow-up`,
      description: 'Review safety events, document actions taken, and escalate reportable items promptly.',
      actionLabel: isAdmin ? 'Open incident review' : 'Open incidents',
      to: isAdmin ? '/IncidentReview' : '/Incidents',
      severity: 'high',
      role: isAdmin ? 'manager' : 'clinician',
      sortOrder: 25,
    }));
  }

  const openMessages = countOpenMessages(messages, currentUser);
  if (openMessages > 0) {
    priorities.push(createPriority({
      id: 'unread-messages',
      title: `${openMessages} unread message${openMessages === 1 ? '' : 's'}`,
      description: 'Check patient, provider, and team messages before starting field work.',
      actionLabel: 'Open messages',
      to: '/Messages',
      severity: 'medium',
      sortOrder: 30,
    }));
  }

  const recentAiNotes = noteConversions.filter((note) => daysUntil(note?.created_date, now) !== null && daysUntil(note.created_date, now) >= -7).length;
  if (recentAiNotes === 0 && todayScheduledVisits.length > 0) {
    priorities.push(createPriority({
      id: 'smart-note-reminder',
      title: 'Use Smart Notes to reduce after-hours charting',
      description: 'Capture visit details during the day and review AI-assisted drafts before submitting.',
      actionLabel: 'Start Smart Note',
      to: '/SmartNoteAssistant',
      severity: 'low',
      role: 'clinician',
      sortOrder: 80,
    }));
  }

  if (isAdmin) {
    const pendingApprovals = patients.filter((patient) => String(patient?.status || '').toLowerCase() === 'pending').length;
    if (pendingApprovals > 0) {
      priorities.push(createPriority({
        id: 'pending-patient-approvals',
        title: `${pendingApprovals} patient record${pendingApprovals === 1 ? '' : 's'} pending review`,
        description: 'Approve or correct records so the care team can schedule and document without delays.',
        actionLabel: 'Open patient roster',
        to: '/Patients',
        severity: 'medium',
        role: 'admin',
        sortOrder: 35,
      }));
    }

    priorities.push(createPriority({
      id: 'admin-console-check',
      title: 'Review admin operations health',
      description: 'Check approvals, integration status, reports, and agency configuration before daily operations peak.',
      actionLabel: 'Open admin console',
      to: '/AdminOperations',
      severity: 'low',
      role: 'admin',
      sortOrder: 90,
    }));
  }

  if (priorities.length === 0) {
    priorities.push(createPriority({
      id: 'all-clear',
      title: 'No urgent priorities right now',
      description: 'Your dashboard has no urgent items. Use quick actions below to start charting, send a fax, or review patients.',
      actionLabel: 'View patients',
      to: '/Patients',
      severity: 'low',
      sortOrder: 100,
    }));
  }

  return priorities.sort((a, b) => priorityScore(a) - priorityScore(b)).slice(0, limit);
}
