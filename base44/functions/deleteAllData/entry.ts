import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can delete all data
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const deletionSummary = {};

    // Define all entities to clear (excluding sample data)
    const entitiesToClear = [
      'Patient',
      'Visit',
      'CarePlan',
      'Task',
      'Invoice',
      'Payment',
      'Incident',
      'PatientAlert',
      'TelehealthMessage',
      'Appointment',
      'Referral',
      'NoteConversion',
      'TrainingCompletion',
      'UserActivity',
      'ComplianceAudit',
      'OASISUpload',
      'OASISAudit',
      'NurseGoal',
      'ProviderPermission',
      'ProviderDashboardCustomization',
      'ProviderPatientAssignment',
      'PersonalizedLearningPath',
      'ProviderBadge',
      'ProviderCertification',
      'LearnedFormatPattern',
      'PatientRecommendation',
      'PatientEducationAssignment',
      'RiskAnalysis',
      'RiskAlert',
      'PatientOutcome',
      'AIInsightFeedback',
      'NoteFeedback',
      'MicroLearningProgress',
      'ScheduleFeedback',
      'OASISFeedback',
      'OASISActionItem',
      'PendingPatientUpdate',
      'SecurityLog',
      'AuditTrail',
      'WorkflowExecution',
      'ApprovalRequest',
      'NoteTemplate',
      'ProviderPreferences',
      'ProviderUsagePattern',
      'TerminologyGlossary',
      'TelehealthConsent',
      'PatientBillingInfo',
      'ProviderAvailability',
      'ProviderTimeBlock',
      'PaymentRecord',
      'OfflineDataCache'
    ];

    // Delete data from each entity (keeping sample data)
    for (const entityName of entitiesToClear) {
      try {
        // Get all non-sample records
        const records = await base44.asServiceRole.entities[entityName].filter({
          $or: [
            { is_sample: { $ne: true } },
            { is_sample: { $exists: false } }
          ]
        });

        // Delete each record
        let deleteCount = 0;
        for (const record of records) {
          try {
            await base44.asServiceRole.entities[entityName].delete(record.id);
            deleteCount++;
          } catch (err) {
            console.error(`Error deleting ${entityName} record ${record.id}:`, err);
          }
        }

        deletionSummary[entityName] = deleteCount;
      } catch (err) {
        console.error(`Error processing ${entityName}:`, err);
        deletionSummary[entityName] = `Error: ${err.message}`;
      }
    }

    // Log the deletion
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'delete_all_data',
      details: {
        deletionSummary,
        reason: 'Admin initiated full data reset'
      }
    });

    return Response.json({
      success: true,
      message: 'All non-sample data has been deleted',
      deletionSummary
    });

  } catch (error) {
    console.error('Error deleting all data:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});