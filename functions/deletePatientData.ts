import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, deleteAll } = await req.json();

    if (deleteAll) {
      // Delete all patients and their data
      const patients = await base44.asServiceRole.entities.Patient.list();
      
      for (const patient of patients) {
        // Delete all related data for each patient
        await deletePatientRelatedData(base44, patient.id);
        // Delete the patient
        await base44.asServiceRole.entities.Patient.delete(patient.id);
      }

      await base44.asServiceRole.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        user_role: user.role,
        action: 'bulk_patient_deletion',
        details: { patient_count: patients.length }
      });

      return Response.json({
        success: true,
        message: `Successfully deleted ${patients.length} patients and all their data`,
        deleted_count: patients.length
      });
    }

    if (!patientId) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    // Delete single patient and related data
    const patient = await base44.asServiceRole.entities.Patient.get(patientId);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    await deletePatientRelatedData(base44, patientId);
    await base44.asServiceRole.entities.Patient.delete(patientId);

    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'patient_deletion',
      details: { 
        patient_id: patientId,
        patient_name: `${patient.first_name} ${patient.last_name}`
      }
    });

    return Response.json({
      success: true,
      message: 'Patient and all related data deleted successfully'
    });

  } catch (error) {
    console.error('Delete patient error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function deletePatientRelatedData(base44, patientId) {
  try {
    // Delete visits
    const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id: patientId });
    for (const visit of visits) {
      await base44.asServiceRole.entities.Visit.delete(visit.id);
    }

    // Delete care plans
    const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId });
    for (const plan of carePlans) {
      await base44.asServiceRole.entities.CarePlan.delete(plan.id);
    }

    // Delete incidents
    const incidents = await base44.asServiceRole.entities.Incident.filter({ patient_id: patientId });
    for (const incident of incidents) {
      await base44.asServiceRole.entities.Incident.delete(incident.id);
    }

    // Delete tasks
    const tasks = await base44.asServiceRole.entities.Task.filter({ patient_id: patientId });
    for (const task of tasks) {
      await base44.asServiceRole.entities.Task.delete(task.id);
    }

    // Delete alerts
    const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id: patientId });
    for (const alert of alerts) {
      await base44.asServiceRole.entities.PatientAlert.delete(alert.id);
    }

    // Delete education assignments
    const eduAssignments = await base44.asServiceRole.entities.PatientEducationAssignment.filter({ patient_id: patientId });
    for (const assignment of eduAssignments) {
      await base44.asServiceRole.entities.PatientEducationAssignment.delete(assignment.id);
    }

    // Delete document analysis history
    const analyses = await base44.asServiceRole.entities.DocumentAnalysisHistory.filter({ patient_id: patientId });
    for (const analysis of analyses) {
      await base44.asServiceRole.entities.DocumentAnalysisHistory.delete(analysis.id);
    }

  } catch (error) {
    console.error('Error deleting related data:', error);
    throw error;
  }
}