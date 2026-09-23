// The AI report's arithmetic and page, carried from
// base44/functions/generateAIReport/entry.ts.
//
// These three blocks are the report. They are COPIED, never retyped: every
// number in `calculateMetrics` is a figure an administrator reads off a page
// and acts on, and D57 settled that asserting a table of expected numbers you
// computed yourself is the transcription D12 threw out.
// `base44/functionTests/pennsyncApiOriginalParity.test.js` compares these
// texts with the original's and fails on any difference, which is why the
// adaptations below are enumerated rather than described. It lives in its own
// module because a test in `services/pennsync-api` may not read a file outside
// that directory (D60), and the comparison has to read the original.
//
// THREE ADAPTATIONS, and nothing else:
//
// 1. `generatePDFReport` becomes `buildAiReport(doc, config)` and no longer
//    constructs its own `jsPDF`. That is `documents.mjs`'s standing contract —
//    a builder is pure and takes a jsPDF-shaped object — so parity is provable
//    on the drawing calls, which is the only way a PDF's parity can be proved
//    at all: jsPDF stamps a creation time and a document id, so two runs of
//    the same code differ byte for byte.
// 2. `new Date().toLocaleString()` in the "Generated:" line becomes a supplied
//    `generatedAt`, for the same reason `documents.mjs` refuses to invent a
//    date: a builder that reads the clock produces a different document either
//    side of a second and cannot be compared with anything.
// 3. `function` becomes `export function`.
// 4. The two TRAINING lines render only when their figures are present.
//    `TrainingAssignment` is `hub` and D84's `uncarried_legs` entry settles the
//    leg by name, so this store counts nothing for them. Printing the zero that
//    an empty array produces would tell an administrator that nobody in the
//    agency trained, and printing a marker in their place would render as
//    `Avg Training Score: served_by_hub/100`. The lines are omitted, the layout
//    is kept for a figure the Support Hub can supply later, and the answer says
//    where the leg went. That is D69's scoped transform, not a rewrite.
//
// `calculateMetrics` and `calculateDailyTrend` are carried with no adaptation
// at all. What feeds them is `report-metrics.mjs`, which rebuilds arrays the
// contract's aggregates describe rather than the rows they were counted from —
// see that file for why that is faithful and where it is proved.

export function calculateMetrics(data) {
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


export function calculateDailyTrend(noteConversions, startDate, endDate) {
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


export function buildAiReport(doc, config) {
  const { report_type, date_range_days, startDate, endDate, metricsData, aiInsights, user, generatedAt } = config;
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
  doc.text(`Generated: ${generatedAt}`, 105, 57, { align: 'center' });

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
  if (metricsData.staff_performance.training_completed !== null) {
    addText(`Training Completed: ${metricsData.staff_performance.training_completed}`, 9);
  }
  if (metricsData.staff_performance.avg_training_score !== null) {
    addText(`Avg Training Score: ${metricsData.staff_performance.avg_training_score}/100`, 9);
  }
  
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
