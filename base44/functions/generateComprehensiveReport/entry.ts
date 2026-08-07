import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import jsPDF from 'npm:jspdf@2.5.2';

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

    const { reportType, dateRange, includeCharts = false } = await req.json();

    if (!reportType || typeof reportType !== 'string') {
      return Response.json({ error: 'reportType is required' }, { status: 400 });
    }

    const today = new Date();
    // Clamp to 1..365 (mirrors generateAIReport): a negative range produced an
    // inverted window that rendered an all-zero report as fact, and a huge
    // numeric overflowed Date into a 500.
    const daysAgo = Math.min(Math.max(parseInt(dateRange) || 30, 1), 365);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysAgo);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = today.toISOString().split('T')[0];

    // Fetch comprehensive data, then agency-scope for non-super_admin callers
    // so an agency_admin cannot pull every tenant's PHI into a PDF.
    let [visits, patients, incidents, users, complianceAudits, trainingCompletions, noteConversions, oasisUploads, alerts] = await Promise.all([
      base44.asServiceRole.entities.Visit.list('-visit_date', 1000),
      base44.asServiceRole.entities.Patient.list('-created_date', 5000),
      base44.asServiceRole.entities.Incident.list('-incident_date', 500),
      base44.asServiceRole.entities.User.list('-created_date', 5000),
      base44.asServiceRole.entities.ComplianceAudit.list('-audit_date', 500),
      base44.asServiceRole.entities.TrainingAssignment.list('-created_date', 5000),
      base44.asServiceRole.entities.NoteConversion.list('-created_date', 5000),
      base44.asServiceRole.entities.OASISUpload.list('-created_date', 200),
      base44.asServiceRole.entities.PatientAlert.list('-created_date', 5000)
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
      complianceAudits = (Array.isArray(complianceAudits) ? complianceAudits : []).filter((a) =>
        !a.patient_id || patientIds.has(a.patient_id)
      );
      trainingCompletions = (Array.isArray(trainingCompletions) ? trainingCompletions : []).filter((t) =>
        !t.assigned_to_user_id || agencyEmails.has(t.assigned_to_user_id)
      );
      noteConversions = (Array.isArray(noteConversions) ? noteConversions : []).filter((n) =>
        !n.patient_id || patientIds.has(n.patient_id)
      );
      oasisUploads = (Array.isArray(oasisUploads) ? oasisUploads : []).filter((o) =>
        !o.patient_id || patientIds.has(o.patient_id)
      );
      alerts = (Array.isArray(alerts) ? alerts : []).filter((a) =>
        !a.patient_id || patientIds.has(a.patient_id)
      );
    }

    // Filter by date range
    const filteredVisits = visits.filter(v => v.visit_date >= startDateStr && v.visit_date <= endDateStr);
    const filteredIncidents = incidents.filter(i => i.incident_date >= startDateStr && i.incident_date <= endDateStr);
    const filteredAudits = complianceAudits.filter(a => {
      const auditDate = new Date(a.audit_date || a.created_date);
      return auditDate >= startDate && auditDate <= today;
    });
    const filteredNoteConversions = noteConversions.filter(n => {
      const convDate = new Date(n.created_date);
      return convDate >= startDate && convDate <= today;
    });

    const doc = new jsPDF();
    let yPosition = 20;

    // Helper to add text and manage pages
    const addText = (text, fontSize = 10, isBold = false) => {
      if (yPosition > 270) {
        doc.addPage();
        yPosition = 20;
      }
      doc.setFontSize(fontSize);
      doc.setFont(undefined, isBold ? 'bold' : 'normal');
      doc.text(text, 20, yPosition);
      yPosition += fontSize / 2 + 2;
    };

    const addSection = (title) => {
      yPosition += 5;
      if (yPosition > 260) {
        doc.addPage();
        yPosition = 20;
      }
      doc.setFillColor(66, 133, 244);
      doc.rect(15, yPosition - 5, 180, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(title, 20, yPosition);
      doc.setTextColor(0, 0, 0);
      yPosition += 10;
    };

    // Title Page
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('PennSync', 105, 40, { align: 'center' });
    doc.setFontSize(18);
    doc.text('Comprehensive Report', 105, 55, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Report Type: ${reportType.replace(/_/g, ' ').toUpperCase()}`, 105, 75, { align: 'center' });
    doc.text(`Date Range: ${startDateStr} to ${endDateStr}`, 105, 85, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 95, { align: 'center' });
    doc.text(`Generated by: ${user.full_name || user.email}`, 105, 105, { align: 'center' });

    doc.addPage();
    yPosition = 20;

    // EXECUTIVE SUMMARY
    addSection('EXECUTIVE SUMMARY');
    
    const totalVisitsCount = filteredVisits.length;
    const completedVisits = filteredVisits.filter(v => v.status === 'completed').length;
    const completionRate = totalVisitsCount > 0 ? Math.round((completedVisits / totalVisitsCount) * 100) : 0;
    const activePatients = patients.filter(p => p.status === 'active').length;
    const totalPatients = patients.length;
    
    addText(`Total Visits: ${totalVisitsCount}`, 11);
    addText(`Completed Visits: ${completedVisits} (${completionRate}%)`, 11);
    addText(`Active Patients: ${activePatients} of ${totalPatients} total`, 11);
    addText(`Incidents Reported: ${filteredIncidents.length}`, 11);
    addText(`Compliance Audits Performed: ${filteredAudits.length}`, 11);

    // VISIT ANALYTICS
    addSection('VISIT ANALYTICS');
    
    const visitsByType = {};
    filteredVisits.forEach(v => {
      const type = v.visit_type || 'unknown';
      visitsByType[type] = (visitsByType[type] || 0) + 1;
    });

    addText('Visit Distribution by Type:', 11, true);
    Object.entries(visitsByType).forEach(([type, count]) => {
      const percentage = Math.round((count / totalVisitsCount) * 100);
      addText(`  ${type.replace(/_/g, ' ')}: ${count} (${percentage}%)`, 10);
    });

    // COMPLIANCE METRICS
    addSection('COMPLIANCE & QUALITY METRICS');
    
    const avgComplianceScore = filteredAudits.length > 0
      ? Math.round(filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length)
      : 0;
    
    const passedAudits = filteredAudits.filter(a => a.status === 'passed').length;
    const flaggedAudits = filteredAudits.filter(a => a.status === 'flagged').length;
    const criticalAudits = filteredAudits.filter(a => a.status === 'critical').length;

    addText(`Average Compliance Score: ${avgComplianceScore}/100`, 11);
    addText(`Audits Passed: ${passedAudits}`, 10);
    addText(`Audits Flagged: ${flaggedAudits}`, 10);
    addText(`Critical Issues: ${criticalAudits}`, 10);

    const visitsWithCompleteDoc = completedVisits > 0
      ? filteredVisits.filter(v => v.status === 'completed' && v.nurse_notes && v.nurse_notes.length > 100).length
      : 0;
    const docComplianceRate = completedVisits > 0 
      ? Math.round((visitsWithCompleteDoc / completedVisits) * 100)
      : 0;

    addText(`Documentation Completeness: ${docComplianceRate}%`, 11);

    // PATIENT OUTCOMES
    addSection('PATIENT OUTCOMES');
    
    const falls = filteredIncidents.filter(i => i.incident_type === 'fall').length;
    const hospitalizations = filteredIncidents.filter(i => i.incident_type === 'hospitalized').length;
    const medErrors = filteredIncidents.filter(i => i.incident_type === 'medication_error').length;
    
    const fallRate = totalVisitsCount > 0 ? Math.round((falls / totalVisitsCount) * 1000) : 0;
    const hospitalizationRate = activePatients > 0 ? Math.round((hospitalizations / activePatients) * 100) : 0;

    addText(`Falls: ${falls} (Rate: ${fallRate} per 1000 visits)`, 10);
    addText(`Hospitalizations: ${hospitalizations} (Rate: ${hospitalizationRate} per 100 patients)`, 10);
    addText(`Medication Errors: ${medErrors}`, 10);

    // STAFF PERFORMANCE
    addSection('STAFF PERFORMANCE');
    
    const nurses = users.filter(u => u.role === 'user');
    addText(`Total Nurses: ${nurses.length}`, 11);
    
    // Calculate note conversions per nurse and sort by highest first
    const nurseStats = nurses.map(nurse => {
      const nurseVisits = filteredVisits.filter(v => v.created_by === nurse.email);
      const nurseCompleted = nurseVisits.filter(v => v.status === 'completed').length;
      const nurseRate = nurseVisits.length > 0 ? Math.round((nurseCompleted / nurseVisits.length) * 100) : 0;
      const nurseNoteConversions = filteredNoteConversions.filter(n => n.nurse_email === nurse.email).length;
      
      return {
        name: nurse.full_name || nurse.email,
        completed: nurseCompleted,
        total: nurseVisits.length,
        rate: nurseRate,
        noteConversions: nurseNoteConversions
      };
    }).filter(stat => stat.total > 0)
      .sort((a, b) => b.noteConversions - a.noteConversions); // Sort by note conversions descending
    
    nurseStats.forEach(stat => {
      addText(`${stat.name}: ${stat.noteConversions} notes, ${stat.completed}/${stat.total} visits (${stat.rate}%)`, 9);
    });

    // AI UTILIZATION & ROI
    addSection('PENNSYNC IMPACT');
    
    const avgQualityScore = filteredNoteConversions.length > 0
      ? Math.round(filteredNoteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / filteredNoteConversions.length)
      : 0;
    
    const totalTimeSavedMin = completedVisits * 95;
    const totalTimeSavedHours = Math.round(totalTimeSavedMin / 60);
    const costSavings = totalTimeSavedHours * 40; // $40/hr avg nurse cost

    addText(`AI-Enhanced Notes: ${filteredNoteConversions.length}`, 10);
    addText(`Average Quality Score: ${avgQualityScore}/100`, 10);
    addText(`Total Time Saved: ${totalTimeSavedHours} hours`, 10);
    addText(`Estimated Cost Savings: $${costSavings.toLocaleString()}`, 10);

    // OASIS ANALYSIS
    addSection('OASIS DOCUMENTATION');
    
    const oasisInPeriod = oasisUploads.filter(o => {
      const uploadDate = new Date(o.created_date);
      return uploadDate >= startDate && uploadDate <= today;
    });

    addText(`OASIS Assessments Uploaded: ${oasisInPeriod.length}`, 10);
    addText(`Patients with Current OASIS: ${new Set(oasisInPeriod.map(o => o.patient_id)).size}`, 10);

    // TRAINING & DEVELOPMENT
    addSection('TRAINING & DEVELOPMENT');
    
    const trainingInPeriod = trainingCompletions.filter(t => {
      const compDate = new Date(t.completion_date || t.created_date);
      return compDate >= startDate && compDate <= today;
    });

    const completedTraining = trainingInPeriod.filter(t => t.status === 'completed' || t.pass_fail_result === 'passed').length;
    const scoredInPeriod = trainingInPeriod.filter(t => typeof t.score_percentage === 'number');

    addText(`Training Modules Completed: ${completedTraining}`, 10);
    addText(`Training in Progress: ${trainingInPeriod.filter(t => t.status === 'in_progress').length}`, 10);
    addText(`Average Training Score: ${scoredInPeriod.length > 0 ? Math.round(scoredInPeriod.reduce((sum, t) => sum + t.score_percentage, 0) / scoredInPeriod.length) : 'N/A'}`, 10);

    // ALERTS & RISK MANAGEMENT
    addSection('PATIENT ALERTS & RISK');
    
    const activeAlerts = alerts.filter(a => a.status === 'active').length;
    const criticalAlerts = alerts.filter(a => a.severity === 'critical' && a.status === 'active').length;
    const resolvedAlerts = alerts.filter(a => a.status === 'resolved').length;

    addText(`Active Alerts: ${activeAlerts}`, 10);
    addText(`Critical Alerts: ${criticalAlerts}`, 10);
    addText(`Resolved Alerts: ${resolvedAlerts}`, 10);

    // RECOMMENDATIONS
    addSection('KEY RECOMMENDATIONS');
    
    if (completionRate < 85) {
      addText('• Improve visit completion rate through scheduling optimization', 9);
    }
    if (avgComplianceScore < 80) {
      addText('• Increase compliance training and documentation quality', 9);
    }
    if (fallRate > 10) {
      addText('• Implement enhanced fall prevention protocols', 9);
    }
    if (hospitalizationRate > 15) {
      addText('• Focus on proactive patient monitoring to reduce readmissions', 9);
    }
    if (activeAlerts > criticalAlerts * 5) {
      addText('• Review and address patient alert response times', 9);
    }
    if (completionRate >= 90 && avgComplianceScore >= 85 && fallRate < 10) {
      addText('• Excellent performance across all metrics - maintain current standards', 9);
    }

    // Footer on last page
    yPosition = 280;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text('PennSync - AI-Powered Home Health Documentation System', 105, yPosition, { align: 'center' });
    doc.text(`Report generated on ${new Date().toLocaleString()}`, 105, yPosition + 5, { align: 'center' });

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="caremetric-ai-${reportType}-report-${endDateStr}.pdf"`
      }
    });
  } catch (error) {
    console.error('Report generation error:', error);
    return Response.json({ 
      error: 'Internal server error',
      details: 'Failed to generate comprehensive report'
    }, { status: 500 });
  }
});