import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

// <<<BEGIN SHARED HELPER: brandedEmail — generated, edit base44/_shared/backendHelpers.mjs>>>
const BRAND_EMAIL = {
  navy: '#213a76', navyDeep: '#1c2f5e', gold: '#c7901f',
  ink: '#111a2b', slate: '#334155', muted: '#5b6a7f', line: '#e4e9f1',
  wash: '#eef3fc', panel: '#f5f8fd',
  logo: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png',
};
// Callout tones. 'info' is on-brand navy; success/warn/urgent reuse the manual
// theme's green/amber/red and are used ONLY for genuine status (never decoration).
const EMAIL_TONES = {
  info:    { bg: '#eef3fc', border: '#88a5e0', text: '#213a76' },
  success: { bg: '#effdf4', border: '#86efac', text: '#15803d' },
  warn:    { bg: '#fff8ec', border: '#fcd68a', text: '#b45309' },
  urgent:  { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
};
function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Allow only absolute http(s)/mailto links in email buttons, then HTML-escape the
// whole attribute value. Rejects dangerous/unusable schemes (javascript:, data:,
// protocol-relative //host, app-relative paths that don't resolve in an inbox) so
// a user-controlled URL can never inject a scheme or break out of the attribute.
// Returns '' for a rejected URL, and the caller then renders no button.
function safeEmailHref(raw) {
  const url = String(raw ?? '').trim();
  const lower = url.toLowerCase();
  const ok = lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:');
  return ok ? escapeEmailHtml(url) : '';
}
function emailParagraph(text) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.62;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(text)}</p>`;
}
function renderEmailSection(section) {
  const s = section || {};
  const parts = [];
  if (s.heading) {
    parts.push(`<h2 style="margin:20px 0 8px;font-size:16px;font-weight:800;color:${BRAND_EMAIL.ink};">${escapeEmailHtml(s.heading)}</h2>`);
  }
  for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) parts.push(emailParagraph(p));
  if (s.pre) {
    parts.push(`<pre style="margin:4px 0 16px;padding:14px 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12.5px;line-height:1.5;color:${BRAND_EMAIL.ink};white-space:pre-wrap;word-break:break-word;">${escapeEmailHtml(s.pre)}</pre>`);
  }
  if (Array.isArray(s.rows) && s.rows.length) {
    const rows = s.rows.map((r) =>
      `<tr><td style="padding:5px 0;font-size:13.5px;color:${BRAND_EMAIL.muted};vertical-align:top;white-space:nowrap;">${escapeEmailHtml(r[0])}</td>` +
      `<td style="padding:5px 0 5px 16px;font-size:14px;color:${BRAND_EMAIL.ink};font-weight:600;vertical-align:top;">${escapeEmailHtml(r[1])}</td></tr>`
    ).join('');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;"><tr><td style="padding:8px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr></table>`);
  }
  if (Array.isArray(s.bullets) && s.bullets.length) {
    const items = s.bullets.map((b) =>
      `<li style="margin:0 0 7px;font-size:14.5px;line-height:1.55;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(b)}</li>`
    ).join('');
    parts.push(`<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`);
  }
  if (s.callout && s.callout.text) {
    const t = EMAIL_TONES[s.callout.tone] || EMAIL_TONES.info;
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="padding:13px 16px;background:${t.bg};border-left:4px solid ${t.border};border-radius:8px;font-size:14px;line-height:1.55;color:${t.text};font-weight:600;">${escapeEmailHtml(s.callout.text)}</td></tr></table>`);
  }
  if (s.button && s.button.href) {
    const href = safeEmailHref(s.button.href);
    if (href) {
      parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
    }
  }
  if (s.note) {
    parts.push(`<p style="margin:0 0 14px;font-size:12.5px;line-height:1.55;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(s.note)}</p>`);
  }
  return parts.join('');
}
/**
 * Build a branded PennSync email. Returns an HTML string for SendEmail's body.
 * opts: { preheader, eyebrow, tone('brand'|'urgent'), title, intro(string|string[]),
 *         sections[{ heading, paragraphs[], pre, rows[[k,v]], bullets[], callout{text,tone},
 *         button{href,label}, note }], signoffName, footerNote }
 */
function renderBrandedEmail(opts) {
  const o = opts || {};
  const rule = o.tone === 'urgent' ? '#dc2626' : BRAND_EMAIL.gold;
  const intro = Array.isArray(o.intro) ? o.intro : (o.intro ? [o.intro] : []);
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const signoff = o.signoffName === null ? '' : (o.signoffName || 'The PennSync by CareMetric Team');
  const preheader = o.preheader ? escapeEmailHtml(o.preheader) : '';
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND_EMAIL.gold};">${escapeEmailHtml(o.eyebrow)}</p>`
    : '';
  const introHtml = intro.map(emailParagraph).join('');
  const sectionsHtml = sections.map(renderEmailSection).join('');
  const signoffHtml = signoff
    ? `<p style="margin:22px 0 2px;font-size:15px;line-height:1.6;color:${BRAND_EMAIL.slate};">Warm regards,<br /><strong style="color:${BRAND_EMAIL.navy};">${escapeEmailHtml(signoff)}</strong></p>`
    : '';
  const footerNote = o.footerNote
    ? `<p style="margin:0 0 8px;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(o.footerNote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="light only" /><title>${escapeEmailHtml(o.title || 'PennSync by CareMetric')}</title></head>
<body style="margin:0;padding:0;background:${BRAND_EMAIL.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND_EMAIL.wash};">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_EMAIL.wash};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND_EMAIL.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:linear-gradient(180deg,#25407e 0%,${BRAND_EMAIL.navyDeep} 100%);padding:28px 28px 24px;text-align:center;">
    <img src="${BRAND_EMAIL.logo}" width="54" height="54" alt="PennSync" style="display:inline-block;width:54px;height:54px;border-radius:13px;border:0;" />
    <div style="margin-top:11px;font-size:23px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span></div>
    <div style="margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:58px;height:4px;border-radius:3px;background:${rule};margin:14px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 32px 6px;">
    ${eyebrow}<h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND_EMAIL.navy};">${escapeEmailHtml(o.title || '')}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 4px;">${introHtml}${sectionsHtml}${signoffHtml}</td></tr>
  <tr><td style="padding:24px 32px 30px;text-align:center;">
    <div style="height:1px;background:${BRAND_EMAIL.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:${BRAND_EMAIL.navy};">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span> <span style="font-weight:600;color:${BRAND_EMAIL.muted};">by CareMetric</span></div>
    ${footerNote}<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">This is an automated message from PennSync by CareMetric — please do not reply to this email.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}
// <<<END SHARED HELPER: brandedEmail>>>

/**
 * AI-Driven Automated Reporting Function
 * Generates customizable reports with AI insights for patient outcomes, compliance, and staff performance
 */

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const {
      report_type,
      date_range_days: rawDateRangeDays = 30,
      recipients = [],
      include_ai_insights = true,
      metrics = ['all']
    } = await req.json();

    if (!report_type) {
      return Response.json({ error: 'report_type is required' }, { status: 400 });
    }

    // Clamp the range to 1..365 days. calculateDailyTrend / the PDF build a
    // per-day bucket, so an unbounded/huge value (e.g. 1e8) would loop for
    // ~100M iterations → timeout/OOM, and a negative value inverts the range
    // into an empty report.
    const date_range_days = Math.min(Math.max(Math.floor(Number(rawDateRangeDays) || 30), 1), 365);

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - date_range_days);

    // Fetch comprehensive data, then agency-scope for non-super_admin callers
    // so an agency_admin cannot pull every tenant's PHI into a PDF/email.
    let [visits, patients, incidents, users, audits, trainings, noteConversions, alerts, tasks] = await Promise.all([
      base44.asServiceRole.entities.Visit.list('-visit_date', 1000),
      base44.asServiceRole.entities.Patient.list('-created_date', 5000),
      base44.asServiceRole.entities.Incident.list('-incident_date', 500),
      base44.asServiceRole.entities.User.list('-created_date', 5000),
      base44.asServiceRole.entities.ComplianceAudit.list('-created_date', 500),
      base44.asServiceRole.entities.TrainingAssignment.list('-created_date', 5000),
      base44.asServiceRole.entities.NoteConversion.list('-created_date', 5000),
      base44.asServiceRole.entities.PatientAlert.list('-created_date', 5000),
      base44.asServiceRole.entities.Task.list('-created_date', 5000)
    ]);

    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
      users = (Array.isArray(users) ? users : []).filter((u) =>
        u.account_type === 'super_admin' || u.agency_name === user.agency_name
      );
      const agencyEmails = new Set(users.map((u) => u?.email).filter(Boolean));
      patients = (Array.isArray(patients) ? patients : []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
      const patientIds = new Set(patients.map((p) => p.id));
      visits = (Array.isArray(visits) ? visits : []).filter((v) => patientIds.has(v.patient_id));
      incidents = (Array.isArray(incidents) ? incidents : []).filter((i) => patientIds.has(i.patient_id));
      audits = (Array.isArray(audits) ? audits : []).filter((a) =>
        !a.patient_id || patientIds.has(a.patient_id)
      );
      trainings = (Array.isArray(trainings) ? trainings : []).filter((t) =>
        !t.assigned_to_user_id || agencyEmails.has(t.assigned_to_user_id)
      );
      noteConversions = (Array.isArray(noteConversions) ? noteConversions : []).filter((n) =>
        !n.patient_id || patientIds.has(n.patient_id)
      );
      alerts = (Array.isArray(alerts) ? alerts : []).filter((a) =>
        !a.patient_id || patientIds.has(a.patient_id)
      );
      tasks = (Array.isArray(tasks) ? tasks : []).filter((t) =>
        !t.patient_id || patientIds.has(t.patient_id)
      );
    }

    // Filter by date range
    const filteredVisits = visits.filter(v => new Date(v.visit_date) >= startDate && new Date(v.visit_date) <= endDate);
    const filteredIncidents = incidents.filter(i => new Date(i.incident_date) >= startDate && new Date(i.incident_date) <= endDate);
    const filteredAudits = audits.filter(a => new Date(a.created_date) >= startDate && new Date(a.created_date) <= endDate);
    const filteredNotes = noteConversions.filter(n => new Date(n.created_date) >= startDate && new Date(n.created_date) <= endDate);

    // Calculate daily enhancement trend
    const dailyEnhancementTrend = calculateDailyTrend(filteredNotes, startDate, endDate);

    // Calculate metrics
    const metricsData = calculateMetrics({
      visits: filteredVisits,
      patients,
      incidents: filteredIncidents,
      audits: filteredAudits,
      trainings,
      noteConversions: filteredNotes,
      alerts,
      tasks,
      users,
      dailyEnhancementTrend
    });

    // Generate AI insights if requested
    let aiInsights = null;
    if (include_ai_insights) {
      aiInsights = await generateAIInsights(base44, metricsData, report_type);
    }

    // Generate PDF report
    const pdfBuffer = await generatePDFReport({
      report_type,
      date_range_days,
      startDate,
      endDate,
      metricsData,
      aiInsights,
      user
    });

    // Send to recipients if specified
    if (recipients.length > 0) {
      const reportLabel = report_type.replace(/_/g, ' ');
      const insightSections = aiInsights
        ? [
            { heading: 'Key insights', paragraphs: [aiInsights.executive_summary] },
            { heading: 'Top priority', paragraphs: [aiInsights.priority_actions?.[0]?.action ?? 'N/A'] },
          ]
        : [];
      const reportBody = renderBrandedEmail({
        preheader: `Your automated ${reportLabel} report for ${startDate.toLocaleDateString()} – ${endDate.toLocaleDateString()} is ready.`,
        eyebrow: 'Report ready',
        title: `Your ${reportLabel} report`,
        intro: `Your automated ${reportLabel} report for the period ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} is ready.`,
        sections: insightSections,
        footerNote: 'This report was generated by PennSync AI.',
      });
      for (const recipient of recipients) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: recipient,
          from_name: 'PennSync by CareMetric',
          subject: `Your ${reportLabel} report — ${endDate.toLocaleDateString()}`,
          body: reportBody,
        });
      }
    }

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${report_type}-report-${endDate.toISOString().split('T')[0]}.pdf"`
      }
    });

  } catch (error) {
    console.error('Report generation error:', error);
    return Response.json({ 
      error: 'Internal server error',
    }, { status: 500 });
  }
});

function calculateMetrics(data) {
  const { visits, patients, incidents, audits, trainings, noteConversions, alerts, tasks, users, dailyEnhancementTrend } = data;

  const activePatients = patients.filter(p => p.status === 'active').length;
  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const completionRate = visits.length > 0 ? (completedVisits / visits.length * 100).toFixed(1) : 0;

  const avgComplianceScore = audits.length > 0 
    ? (audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length).toFixed(1)
    : 0;

  const falls = incidents.filter(i => i.incident_type === 'fall').length;
  const hospitalizations = incidents.filter(i => i.incident_type === 'hospitalized').length;
  const medErrors = incidents.filter(i => i.incident_type === 'medication_error').length;

  const avgNoteQuality = noteConversions.length > 0
    ? (noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length).toFixed(1)
    : 0;

  const avgComplianceImprovement = noteConversions.length > 0
    ? (noteConversions.reduce((sum, n) => sum + (n.compliance_improvement || 0), 0) / noteConversions.length).toFixed(1)
    : 0;

  const criticalAlerts = alerts.filter(a => a.severity === 'critical' && a.status === 'active').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const taskCompletionRate = tasks.length > 0 ? (completedTasks / tasks.length * 100).toFixed(1) : 0;

  const completedTraining = trainings.filter(t => t.status === 'completed' || t.pass_fail_result === 'passed').length;
  const scoredTraining = trainings.filter(t => typeof t.score_percentage === 'number');
  const avgTrainingScore = scoredTraining.length > 0
    ? (scoredTraining.reduce((sum, t) => sum + t.score_percentage, 0) / scoredTraining.length).toFixed(1)
    : 0;

  // Nurse performance
  const nurses = users.filter(u => u.role === 'user');
  const nurseStats = nurses.map(nurse => {
    const nurseVisits = visits.filter(v => v.created_by === nurse.email);
    const nurseCompleted = nurseVisits.filter(v => v.status === 'completed').length;
    const nurseNotes = noteConversions.filter(n => n.nurse_email === nurse.email);
    const nurseAvgQuality = nurseNotes.length > 0
      ? (nurseNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / nurseNotes.length).toFixed(1)
      : 0;

    return {
      name: nurse.full_name || nurse.email,
      email: nurse.email,
      visits_completed: nurseCompleted,
      total_visits: nurseVisits.length,
      completion_rate: nurseVisits.length > 0 ? (nurseCompleted / nurseVisits.length * 100).toFixed(1) : 0,
      avg_note_quality: nurseAvgQuality,
      note_count: nurseNotes.length
    };
  }).filter(s => s.total_visits > 0).sort((a, b) => b.visits_completed - a.visits_completed);

  return {
    overview: {
      total_visits: visits.length,
      completed_visits: completedVisits,
      completion_rate: completionRate,
      active_patients: activePatients,
      total_patients: patients.length
    },
    compliance: {
      avg_score: avgComplianceScore,
      total_audits: audits.length,
      passed: audits.filter(a => a.status === 'passed').length,
      flagged: audits.filter(a => a.status === 'flagged').length,
      critical: audits.filter(a => a.status === 'critical').length
    },
    patient_outcomes: {
      falls,
      fall_rate: visits.length > 0 ? ((falls / visits.length) * 1000).toFixed(2) : 0,
      hospitalizations,
      hospitalization_rate: activePatients > 0 ? ((hospitalizations / activePatients) * 100).toFixed(2) : 0,
      medication_errors: medErrors,
      critical_alerts: criticalAlerts
    },
    ai_documentation: {
      notes_enhanced: noteConversions.length,
      avg_quality_score: avgNoteQuality,
      avg_compliance_improvement: avgComplianceImprovement,
      time_saved_hours: Math.round(completedVisits * 1.5),
      daily_trend: dailyEnhancementTrend
    },
    staff_performance: {
      total_nurses: nurses.length,
      nurse_stats: nurseStats,
      task_completion_rate: taskCompletionRate,
      training_completed: completedTraining,
      avg_training_score: avgTrainingScore
    }
  };
}

async function generateAIInsights(base44, metricsData, reportType) {
  const result = await base44.integrations.Core.InvokeLLM({
    model: "automatic",
    prompt: `Analyze these healthcare metrics and provide actionable AI insights.

REPORT TYPE: ${reportType}

METRICS:
${JSON.stringify(metricsData, null, 2)}

Provide:
1. Executive summary (2-3 sentences highlighting key findings)
2. Performance highlights (3-5 positive trends)
3. Areas of concern (3-5 issues requiring attention)
4. Priority actions (top 3 recommendations with rationale)
5. Predictive insights (trends and forecasts)
6. Benchmarking analysis (compare to industry standards if applicable)

Be specific, actionable, and data-driven.`,
    response_json_schema: {
      type: "object",
      properties: {
        executive_summary: { type: "string" },
        performance_highlights: { type: "array", items: { type: "string" } },
        areas_of_concern: {
          type: "array",
          items: {
            type: "object",
            properties: {
              concern: { type: "string" },
              impact: { type: "string" },
              data_points: { type: "array", items: { type: "string" } }
            }
          }
        },
        priority_actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              rationale: { type: "string" },
              expected_impact: { type: "string" },
              timeline: { type: "string" }
            }
          }
        },
        predictive_insights: { type: "array", items: { type: "string" } },
        benchmarking: { type: "string" }
      }
    }
  });

  return result;
}

function calculateDailyTrend(noteConversions, startDate, endDate) {
  const dailyData = {};
  
  // Initialize all days in range (ensure we include the end date)
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);
  const endDateNormalized = new Date(endDate);
  endDateNormalized.setHours(23, 59, 59, 999);
  
  while (currentDate <= endDateNormalized) {
    const dateKey = currentDate.toISOString().split('T')[0];
    dailyData[dateKey] = 0;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Count notes per day
  noteConversions.forEach(note => {
    const noteDate = new Date(note.created_date);
    noteDate.setHours(0, 0, 0, 0);
    const noteKey = noteDate.toISOString().split('T')[0];
    if (dailyData.hasOwnProperty(noteKey)) {
      dailyData[noteKey]++;
    }
  });
  
  // Convert to sorted array format for charting
  return Object.entries(dailyData)
    .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
    .map(([date, count]) => ({
      date: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }),
      count,
      fullDate: date
    }));
}

function generatePDFReport(config) {
  const { report_type, date_range_days, startDate, endDate, metricsData, aiInsights, user } = config;
  
  const doc = new jsPDF();
  let y = 20;

  const addText = (text, size = 10, bold = false) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(size);
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    doc.text(text, 20, y);
    y += size / 2 + 2;
  };

  const addSection = (title) => {
    y += 5;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFillColor(37, 99, 235);
    doc.rect(15, y - 5, 180, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(title, 20, y);
    doc.setTextColor(0, 0, 0);
    y += 10;
  };

  // Title
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('PennSync by CareMetric AI Report', 105, 30, { align: 'center' });
  doc.setFontSize(14);
  doc.text(report_type.replace(/_/g, ' ').toUpperCase(), 105, 40, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`, 105, 50, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 57, { align: 'center' });

  y = 70;

  // AI INSIGHTS (if available)
  if (aiInsights) {
    addSection('🤖 AI-POWERED EXECUTIVE SUMMARY');
    doc.setFontSize(9);
    // The LLM output is best-effort (no strict schema enforcement), so guard the
    // promised string/array fields — a response missing any of them must not
    // 500 the whole report after all the entity fetches + LLM call were paid for.
    const summaryLines = doc.splitTextToSize(aiInsights.executive_summary || 'No summary available.', 170);
    summaryLines.forEach(line => addText(line, 9));
    y += 5;

    addSection('✨ PERFORMANCE HIGHLIGHTS');
    (aiInsights.performance_highlights || []).forEach((highlight, i) => {
      addText(`${i + 1}. ${highlight}`, 9);
    });

    addSection('⚠️ PRIORITY ACTIONS');
    (aiInsights.priority_actions || []).slice(0, 3).forEach((action, i) => {
      addText(`${i + 1}. ${action.action}`, 9, true);
      addText(`   Rationale: ${action.rationale}`, 8);
      addText(`   Expected Impact: ${action.expected_impact}`, 8);
      y += 2;
    });
  }

  // OVERVIEW METRICS
  addSection('📊 OVERVIEW METRICS');
  addText(`Total Visits: ${metricsData.overview.total_visits}`, 10);
  addText(`Completed Visits: ${metricsData.overview.completed_visits} (${metricsData.overview.completion_rate}%)`, 10);
  addText(`Active Patients: ${metricsData.overview.active_patients} / ${metricsData.overview.total_patients}`, 10);

  // COMPLIANCE METRICS
  addSection('✅ COMPLIANCE & QUALITY');
  addText(`Average Compliance Score: ${metricsData.compliance.avg_score}/100`, 10);
  addText(`Audits: ${metricsData.compliance.passed} Passed, ${metricsData.compliance.flagged} Flagged, ${metricsData.compliance.critical} Critical`, 9);

  // PATIENT OUTCOMES
  addSection('🏥 PATIENT OUTCOMES');
  addText(`Falls: ${metricsData.patient_outcomes.falls} (Rate: ${metricsData.patient_outcomes.fall_rate} per 1000 visits)`, 9);
  addText(`Hospitalizations: ${metricsData.patient_outcomes.hospitalizations} (Rate: ${metricsData.patient_outcomes.hospitalization_rate}%)`, 9);
  addText(`Medication Errors: ${metricsData.patient_outcomes.medication_errors}`, 9);
  addText(`Critical Alerts: ${metricsData.patient_outcomes.critical_alerts}`, 9);

  // AI DOCUMENTATION
  addSection('🤖 AI DOCUMENTATION IMPACT');
  addText(`Notes Enhanced: ${metricsData.ai_documentation.notes_enhanced}`, 9);
  addText(`Avg Quality Score: ${metricsData.ai_documentation.avg_quality_score}/100`, 9);
  addText(`Avg Compliance Improvement: ${metricsData.ai_documentation.avg_compliance_improvement}%`, 9);
  addText(`Time Saved: ${metricsData.ai_documentation.time_saved_hours} hours`, 9);
  
  // Daily Enhancement Trend - New Page for Chart
  if (y > 200 || metricsData.ai_documentation.daily_trend.length > 20) {
    doc.addPage();
    y = 20;
  }
  
  addSection('📈 Daily Enhancement Trend');
  const maxEnhancements = Math.max(...metricsData.ai_documentation.daily_trend.map(d => d.count), 1);
  
  metricsData.ai_documentation.daily_trend.forEach((day, index) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    const barWidth = (day.count / maxEnhancements) * 100;
    doc.setFontSize(7);
    doc.text(`${day.date}`, 25, y);
    doc.text(`${day.count}`, 50, y);
    
    // Draw bar
    if (day.count > 0) {
      doc.setFillColor(59, 130, 246); // Blue
      doc.rect(60, y - 3, barWidth * 1.2, 4, 'F');
    }
    y += 5;
  });

  // STAFF PERFORMANCE
  addSection('👥 STAFF PERFORMANCE');
  addText(`Total Nurses: ${metricsData.staff_performance.total_nurses}`, 10);
  addText(`Task Completion Rate: ${metricsData.staff_performance.task_completion_rate}%`, 9);
  addText(`Training Completed: ${metricsData.staff_performance.training_completed}`, 9);
  addText(`Avg Training Score: ${metricsData.staff_performance.avg_training_score}/100`, 9);
  
  y += 3;
  addText('Top Performers:', 9, true);
  metricsData.staff_performance.nurse_stats.slice(0, 5).forEach((nurse, i) => {
    addText(`${i + 1}. ${nurse.name}: ${nurse.visits_completed} visits, ${nurse.note_count} notes (Quality: ${nurse.avg_note_quality})`, 8);
  });

  // PREDICTIVE INSIGHTS
  if (aiInsights?.predictive_insights) {
    addSection('🔮 PREDICTIVE INSIGHTS');
    aiInsights.predictive_insights.forEach(insight => {
      const lines = doc.splitTextToSize(`• ${insight}`, 170);
      lines.forEach(line => addText(line, 8));
    });
  }

  // CONCERNS
  if (aiInsights?.areas_of_concern) {
    addSection('🔴 AREAS REQUIRING ATTENTION');
    aiInsights.areas_of_concern.slice(0, 3).forEach((concern, i) => {
      addText(`${i + 1}. ${concern.concern}`, 9, true);
      addText(`   Impact: ${concern.impact}`, 8);
    });
  }

  return doc.output('arraybuffer');
}