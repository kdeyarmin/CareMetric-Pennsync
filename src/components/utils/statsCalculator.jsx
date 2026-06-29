/**
 * Centralized Statistics Calculator
 * Ensures consistent stat calculations across all dashboards, reports, and analytics
 */

export const calculateStats = (data) => {
  const {
    visits = [],
    noteConversions = [],
    users = [],
    patients = [],
    incidents = [],
    complianceAudits = [],
    _userActivities = [],
    dateRange = 30 // default 30 days
  } = data;

  // Calculate date ranges
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - dateRange);
  const startDateString = startDate.toISOString().split('T')[0];

  // ====================
  // VISIT STATISTICS
  // ====================
  const totalVisits = visits.length;
  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const scheduledVisits = visits.filter(v => v.status === 'scheduled').length;
  const cancelledVisits = visits.filter(v => v.status === 'cancelled').length;
  const inProgressVisits = visits.filter(v => v.status === 'in_progress').length;
  
  const visitsInDateRange = visits.filter(v => {
    if (!v.visit_date && !v.created_date) return false;
    const visitDate = new Date(v.visit_date || v.created_date);
    return visitDate >= startDate;
  }).length;

  const completedVisitsInRange = visits.filter(v => {
    if (!v.visit_date && !v.created_date) return false;
    const visitDate = new Date(v.visit_date || v.created_date);
    return visitDate >= startDate && v.status === 'completed';
  }).length;

  const completionRate = totalVisits > 0 
    ? Math.round((completedVisits / totalVisits) * 100) 
    : 0;

  // ====================
  // NOTE ENHANCEMENT STATISTICS
  // ====================
  // Note enhancements = times the "enhance note" button was clicked and AI generated a note
  const totalNoteConversions = noteConversions.length;
  
  const noteConversionsInRange = noteConversions.filter(nc => {
    if (!nc.created_date) return false;
    const conversionDate = new Date(nc.created_date);
    return conversionDate >= startDate;
  }).length;

  // ====================
  // TIME SAVINGS CALCULATIONS
  // ====================
  // Each AI note enhancement saves 20 minutes
  const minutesPerNoteEnhancement = 20;
  const totalTimeSavedMinutes = totalNoteConversions * minutesPerNoteEnhancement;
  const totalTimeSavedHours = Math.round(totalTimeSavedMinutes / 60);
  const timeSavedInRangeMinutes = noteConversionsInRange * minutesPerNoteEnhancement;
  const timeSavedInRangeHours = Math.round(timeSavedInRangeMinutes / 60);

  // Format time saved for display
  const formatTimeSaved = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  // ====================
  // USER STATISTICS
  // ====================
  const totalUsers = users.length;
  const adminUsers = users.filter(u => u.role === 'admin').length;
  const activeUsers = users.filter(u => u.is_approved === true || u.role === 'admin').length;
  const pendingUsers = users.filter(u => u.is_approved === false && u.role !== 'admin').length;

  // ====================
  // PATIENT STATISTICS
  // ====================
  const totalPatients = patients.length;
  const activePatients = patients.filter(p => p.status === 'active').length;
  const dischargedPatients = patients.filter(p => p.status === 'discharged').length;

  // ====================
  // INCIDENT STATISTICS
  // ====================
  const totalIncidents = incidents.length;
  const incidentsInRange = incidents.filter(i => {
    if (!i.incident_date) return false;
    const incidentDate = new Date(i.incident_date);
    return incidentDate >= startDate;
  }).length;
  
  const falls = incidents.filter(i => i.incident_type === 'fall').length;
  const hospitalizations = incidents.filter(i => i.incident_type === 'hospitalized').length;
  const medicationErrors = incidents.filter(i => i.incident_type === 'medication_error').length;

  // ====================
  // COMPLIANCE STATISTICS
  // ====================
  const auditsInRange = complianceAudits.filter(a => {
    const auditDate = new Date(a.audit_date || a.created_date);
    return auditDate >= startDate;
  });

  const avgComplianceScore = auditsInRange.length > 0
    ? Math.round(auditsInRange.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / auditsInRange.length)
    : 0;

  const passedAudits = auditsInRange.filter(a => a.status === 'passed').length;
  const qualityScore = auditsInRange.length > 0
    ? Math.round((passedAudits / auditsInRange.length) * 100)
    : 0;

  // ====================
  // FINANCIAL ESTIMATES
  // ====================
  const estimatedRevenuePerVisit = 180; // Average Medicare reimbursement
  const estimatedRevenue = completedVisits * estimatedRevenuePerVisit;
  const estimatedRevenueInRange = completedVisitsInRange * estimatedRevenuePerVisit;

  const nurseHourlyCost = 40;
  const costSavings = totalTimeSavedHours * nurseHourlyCost;
  const costSavingsInRange = timeSavedInRangeHours * nurseHourlyCost;

  // ====================
  // RETURN CONSOLIDATED STATS
  // ====================
  return {
    // Visit stats
    visits: {
      total: totalVisits,
      completed: completedVisits,
      scheduled: scheduledVisits,
      cancelled: cancelledVisits,
      inProgress: inProgressVisits,
      inRange: visitsInDateRange,
      completedInRange: completedVisitsInRange,
      completionRate
    },

    // Note enhancement stats (enhance button clicks)
    noteEnhancements: {
      total: totalNoteConversions,
      inRange: noteConversionsInRange
    },

    // Time savings
    timeSaved: {
      totalMinutes: totalTimeSavedMinutes,
      totalHours: totalTimeSavedHours,
      rangeMinutes: timeSavedInRangeMinutes,
      rangeHours: timeSavedInRangeHours,
      displayTotal: formatTimeSaved(totalTimeSavedMinutes),
      displayRange: formatTimeSaved(timeSavedInRangeMinutes)
    },

    // User stats
    users: {
      total: totalUsers,
      admins: adminUsers,
      active: activeUsers,
      pending: pendingUsers
    },

    // Patient stats
    patients: {
      total: totalPatients,
      active: activePatients,
      discharged: dischargedPatients
    },

    // Incident stats
    incidents: {
      total: totalIncidents,
      inRange: incidentsInRange,
      falls,
      hospitalizations,
      medicationErrors
    },

    // Compliance stats
    compliance: {
      avgScore: avgComplianceScore,
      qualityScore,
      auditsInRange: auditsInRange.length,
      passedAudits
    },

    // Financial
    financial: {
      estimatedRevenue,
      estimatedRevenueInRange,
      costSavings,
      costSavingsInRange,
      roi: estimatedRevenue > 0 ? Math.round((costSavings / estimatedRevenue) * 100) : 0
    },

    // Metadata
    meta: {
      dateRange,
      startDate: startDateString,
      calculatedAt: new Date().toISOString()
    }
  };
};

/**
 * Get stats for a specific nurse
 */
export const calculateNurseStats = (nurseEmail, data) => {
  const { visits = [], noteConversions = [], dateRange = 30 } = data;

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - dateRange);

  const nurseVisits = visits.filter(v => v.created_by === nurseEmail);
  const nurseConversions = noteConversions.filter(nc => nc.nurse_email === nurseEmail);

  const completedVisits = nurseVisits.filter(v => v.status === 'completed').length;
  const totalConversions = nurseConversions.length;

  const conversionsInRange = nurseConversions.filter(nc => {
    if (!nc.created_date) return false;
    const conversionDate = new Date(nc.created_date);
    return conversionDate >= startDate;
  }).length;

  const timeSavedMinutes = totalConversions * 20;
  const timeSavedHours = Math.round(timeSavedMinutes / 60);

  return {
    totalVisits: nurseVisits.length,
    completedVisits,
    completionRate: nurseVisits.length > 0 ? Math.round((completedVisits / nurseVisits.length) * 100) : 0,
    noteConversions: totalConversions,
    noteConversionsInRange: conversionsInRange,
    timeSavedMinutes,
    timeSavedHours,
    timeSavedDisplay: timeSavedHours > 0 ? `${timeSavedHours}h ${timeSavedMinutes % 60}m` : `${timeSavedMinutes}m`
  };
};

/**
 * Format number with commas
 */
export const formatNumber = (num) => {
  return num.toLocaleString();
};

/**
 * Format currency
 */
export const formatCurrency = (amount) => {
  return `$${amount.toLocaleString()}`;
};

/**
 * Calculate percentage
 */
export const calculatePercentage = (part, total) => {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
};