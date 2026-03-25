import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role to delete all user data
    const userEmail = user.email;

    // Delete all user-related data in the correct order (respecting foreign keys)
    
    // 1. Delete user's visits first (referenced by other entities)
    const visits = await base44.asServiceRole.entities.Visit.filter({ created_by: userEmail });
    for (const visit of visits) {
      await base44.asServiceRole.entities.Visit.delete(visit.id);
    }

    // 2. Delete user's patients
    const patients = await base44.asServiceRole.entities.Patient.filter({ created_by: userEmail });
    for (const patient of patients) {
      await base44.asServiceRole.entities.Patient.delete(patient.id);
    }

    // 3. Delete care plans
    const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ created_by: userEmail });
    for (const plan of carePlans) {
      await base44.asServiceRole.entities.CarePlan.delete(plan.id);
    }

    // 4. Delete tasks
    const tasks = await base44.asServiceRole.entities.Task.filter({
      $or: [{ assigned_to: userEmail }, { created_by: userEmail }]
    });
    for (const task of tasks) {
      await base44.asServiceRole.entities.Task.delete(task.id);
    }

    // 5. Delete patient alerts
    const alerts = await base44.asServiceRole.entities.PatientAlert.filter({
      $or: [{ assigned_to: userEmail }, { created_by: userEmail }]
    });
    for (const alert of alerts) {
      await base44.asServiceRole.entities.PatientAlert.delete(alert.id);
    }

    // 6. Delete compliance audits
    const audits = await base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: userEmail });
    for (const audit of audits) {
      await base44.asServiceRole.entities.ComplianceAudit.delete(audit.id);
    }

    // 7. Delete training records
    const trainings = await base44.asServiceRole.entities.TrainingCompletion.filter({ nurse_email: userEmail });
    for (const training of trainings) {
      await base44.asServiceRole.entities.TrainingCompletion.delete(training.id);
    }

    // 8. Delete nurse skills
    const skills = await base44.asServiceRole.entities.NurseSkill.filter({ nurse_email: userEmail });
    for (const skill of skills) {
      await base44.asServiceRole.entities.NurseSkill.delete(skill.id);
    }

    // 9. Delete incidents
    const incidents = await base44.asServiceRole.entities.Incident.filter({ created_by: userEmail });
    for (const incident of incidents) {
      await base44.asServiceRole.entities.Incident.delete(incident.id);
    }

    // 10. Delete subscriptions
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({ user_email: userEmail });
    for (const sub of subscriptions) {
      await base44.asServiceRole.entities.Subscription.delete(sub.id);
    }

    // 11. Delete activity logs
    const activities = await base44.asServiceRole.entities.UserActivity.filter({ user_email: userEmail });
    for (const activity of activities) {
      await base44.asServiceRole.entities.UserActivity.delete(activity.id);
    }

    // 12. Delete security logs
    const secLogs = await base44.asServiceRole.entities.SecurityLog.filter({ user_email: userEmail });
    for (const log of secLogs) {
      await base44.asServiceRole.entities.SecurityLog.delete(log.id);
    }

    // 13. Finally delete the user record itself
    const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
    if (users.length > 0) {
      await base44.asServiceRole.entities.User.delete(users[0].id);
    }

    return Response.json({ 
      success: true, 
      message: 'Account and all associated data deleted successfully' 
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    return Response.json({ 
      error: 'Failed to delete account', 
      details: error.message 
    }, { status: 500 });
  }
});