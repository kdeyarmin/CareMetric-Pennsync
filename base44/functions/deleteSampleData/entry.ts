import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin function to delete all sample data from the database
 * This removes all records marked with is_sample: true
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can delete sample data
    if (user?.role !== 'admin') {
      return Response.json({ 
        error: 'Forbidden: Admin access required' 
      }, { status: 403 });
    }

    let deletedCount = 0;
    const results = {};

    // Delete sample Patients
    try {
      const samplePatients = await base44.asServiceRole.entities.Patient.filter({ is_sample: true });
      for (const patient of samplePatients) {
        await base44.asServiceRole.entities.Patient.delete(patient.id);
        deletedCount++;
      }
      results.patients = samplePatients.length;
      console.log(`Deleted ${samplePatients.length} sample patients`);
    } catch (e) {
      console.error('Error deleting sample patients:', e);
      results.patients_error = e.message;
    }

    // Delete sample Visits
    try {
      const sampleVisits = await base44.asServiceRole.entities.Visit.filter({ is_sample: true });
      for (const visit of sampleVisits) {
        await base44.asServiceRole.entities.Visit.delete(visit.id);
        deletedCount++;
      }
      results.visits = sampleVisits.length;
      console.log(`Deleted ${sampleVisits.length} sample visits`);
    } catch (e) {
      console.error('Error deleting sample visits:', e);
      results.visits_error = e.message;
    }

    // Delete sample CarePlans
    try {
      const sampleCarePlans = await base44.asServiceRole.entities.CarePlan.filter({ is_sample: true });
      for (const plan of sampleCarePlans) {
        await base44.asServiceRole.entities.CarePlan.delete(plan.id);
        deletedCount++;
      }
      results.care_plans = sampleCarePlans.length;
      console.log(`Deleted ${sampleCarePlans.length} sample care plans`);
    } catch (e) {
      console.error('Error deleting sample care plans:', e);
      results.care_plans_error = e.message;
    }

    return Response.json({
      success: true,
      message: `Successfully deleted ${deletedCount} sample records`,
      details: results
    });

  } catch (error) {
    console.error('Error in deleteSampleData:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});