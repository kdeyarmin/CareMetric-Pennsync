import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Service role for monitoring all patients
    const patients = await base44.asServiceRole.entities.Patient.filter({ status: 'active' });
    const alerts = [];
    const currentDate = new Date();
    
    for (const patient of patients) {
      const patientAlerts = [];
      
      // Fetch patient data
      const [visits, oasisRecords, carePlans] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patient.id }, '-created_date', 1),
        base44.asServiceRole.entities.CarePlan.filter({ patient_id: patient.id, status: 'active' })
      ]);
      
      const lastVisit = visits[0];
      const daysSinceLastVisit = lastVisit ? 
        Math.floor((currentDate - new Date(lastVisit.visit_date)) / (1000 * 60 * 60 * 24)) : 999;
      
      // RISK 1: High-risk diagnosis without recent documentation
      const highRiskDiagnoses = ['CHF', 'COPD', 'Diabetes', 'Stroke', 'Cancer', 'Heart Failure'];
      const hasHighRiskDx = highRiskDiagnoses.some(dx => 
        patient.primary_diagnosis?.toUpperCase().includes(dx.toUpperCase())
      );
      
      if (hasHighRiskDx && daysSinceLastVisit > 7) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'care_gap',
          severity: 'high',
          title: 'High-Risk Patient Without Recent Documentation',
          message: `${patient.first_name} ${patient.last_name} has ${patient.primary_diagnosis} and hasn't been seen in ${daysSinceLastVisit} days.`,
          contributing_factors: [
            `High-risk diagnosis: ${patient.primary_diagnosis}`,
            `Last visit: ${daysSinceLastVisit} days ago`,
            'Medicare requires frequent monitoring for high-risk conditions'
          ],
          recommended_actions: [
            'Schedule follow-up visit within 3 days',
            'Contact patient to assess current status',
            'Document any telephonic monitoring',
            'Review care plan for appropriate visit frequency'
          ],
          risk_score: 85,
          data_sources: { last_visit_date: lastVisit?.visit_date, diagnosis: patient.primary_diagnosis }
        });
      }
      
      // RISK 2: Functional decline from OASIS without care plan update
      if (oasisRecords.length > 0) {
        const latestOASIS = oasisRecords[0];
        const functionalLevel = latestOASIS.pdgm_data?.functional_impairment_level;
        
        if ((functionalLevel === 'high' || functionalLevel === 'medium') && carePlans.length === 0) {
          patientAlerts.push({
            patient_id: patient.id,
            alert_type: 'care_gap',
            severity: 'critical',
            title: 'Functional Impairment Without Active Care Plan',
            message: `OASIS shows ${functionalLevel} functional impairment but no active care plans exist.`,
            contributing_factors: [
              `OASIS functional level: ${functionalLevel}`,
              'No active care plans on file',
              'CMS requires care planning for functional limitations'
            ],
            recommended_actions: [
              'Create care plan addressing functional limitations immediately',
              'Document patient/family goals',
              'Schedule skilled nursing visit for assessment',
              'Consider PT/OT referral'
            ],
            risk_score: 95,
            data_sources: { oasis_date: latestOASIS.created_date, functional_level: functionalLevel }
          });
        }
      }
      
      // RISK 3: Missing vital signs in recent visits
      const recentVisitsWithoutVitals = visits.slice(0, 3).filter(v => 
        !v.vital_signs || Object.keys(v.vital_signs).length === 0
      );
      
      if (recentVisitsWithoutVitals.length >= 2) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'documentation_risk',
          severity: 'medium',
          title: 'Incomplete Vital Signs Documentation',
          message: `${recentVisitsWithoutVitals.length} of last 3 visits missing vital signs.`,
          contributing_factors: [
            'Vital signs are required for skilled nursing visits',
            'Missing baseline data for condition monitoring',
            'Audit risk for incomplete documentation'
          ],
          recommended_actions: [
            'Ensure vital signs captured at every skilled visit',
            'Add vital signs to previous visit notes if documented elsewhere',
            'Train staff on documentation requirements',
            'Enable Smart Vitals Input feature'
          ],
          risk_score: 65,
          data_sources: { visits_missing_vitals: recentVisitsWithoutVitals.length }
        });
      }
      
      // RISK 4: Therapy utilization threshold for LUPA avoidance
      const therapyVisits = visits.filter(v => 
        v.visit_type?.toLowerCase().includes('therapy') || 
        v.visit_type?.toLowerCase().includes('pt') ||
        v.visit_type?.toLowerCase().includes('ot')
      );
      
      const admissionDate = new Date(patient.admission_date);
      const daysInEpisode = Math.floor((currentDate - admissionDate) / (1000 * 60 * 60 * 24));
      
      if (daysInEpisode < 60 && daysInEpisode > 7 && therapyVisits.length < 4) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'readmission_risk',
          severity: 'high',
          title: 'Potential LUPA Risk - Low Therapy Utilization',
          message: `Only ${therapyVisits.length} therapy visits documented ${daysInEpisode} days into episode.`,
          contributing_factors: [
            `Episode day: ${daysInEpisode}`,
            `Therapy visits: ${therapyVisits.length}`,
            'Medicare LUPA threshold is typically 4 visits in 60-day episode',
            'Low utilization may trigger payment adjustment'
          ],
          recommended_actions: [
            'Review therapy orders and appropriateness',
            'Schedule additional PT/OT visits if clinically indicated',
            'Document medical necessity for therapy',
            'Consider therapy consultation for assessment'
          ],
          risk_score: 75,
          data_sources: { episode_day: daysInEpisode, therapy_visits: therapyVisits.length }
        });
      }
      
      // RISK 5: Homebound status not documented in recent notes
      if (lastVisit) {
        const noteMention = lastVisit.nurse_notes?.toLowerCase() || '';
        const homeboundKeywords = ['homebound', 'taxing', 'considerable effort', 'leaving home', 'ambulation'];
        const hasHomeboundDoc = homeboundKeywords.some(kw => noteMention.includes(kw));
        
        if (!hasHomeboundDoc && daysSinceLastVisit < 14) {
          patientAlerts.push({
            patient_id: patient.id,
            alert_type: 'documentation_risk',
            severity: 'critical',
            title: 'Missing Homebound Status Documentation',
            message: 'Recent visit note lacks homebound justification - critical for Medicare eligibility.',
            contributing_factors: [
              'Homebound status is Medicare eligibility requirement',
              'Must be documented at every skilled visit',
              'High audit risk if not clearly stated'
            ],
            recommended_actions: [
              'Add homebound justification to next visit note immediately',
              'Document specific limitations and why leaving home is taxing',
              'Include distance patient can ambulate safely',
              'Use Smart Note Assistant homebound templates'
            ],
            risk_score: 90,
            data_sources: { last_visit_date: lastVisit.visit_date }
          });
        }
      }
      
      // RISK 6: Care plan goals overdue for assessment
      const overduePlans = carePlans.filter(cp => {
        if (!cp.target_date) return false;
        const targetDate = new Date(cp.target_date);
        return currentDate > targetDate;
      });
      
      if (overduePlans.length > 0) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'care_gap',
          severity: 'medium',
          title: `${overduePlans.length} Care Plan Goal(s) Overdue for Assessment`,
          message: 'Care plan goals past target date require re-evaluation.',
          contributing_factors: [
            `${overduePlans.length} goals past target date`,
            'CMS requires timely assessment of patient progress',
            'Documentation needed for continued care justification'
          ],
          recommended_actions: [
            'Assess progress toward overdue goals at next visit',
            'Update care plan status (met/not met/revised)',
            'Document barriers to goal achievement if not met',
            'Revise interventions if goals not progressing'
          ],
          risk_score: 60,
          data_sources: { overdue_count: overduePlans.length }
        });
      }
      
      // Create alerts that don't already exist
      for (const alert of patientAlerts) {
        // Check if similar alert already exists and is active
        const existingAlerts = await base44.asServiceRole.entities.PatientAlert.filter({
          patient_id: alert.patient_id,
          alert_type: alert.alert_type,
          status: 'active'
        });
        
        const isDuplicate = existingAlerts.some(ea => 
          ea.title === alert.title && 
          new Date(ea.created_date) > new Date(currentDate.getTime() - 24 * 60 * 60 * 1000) // Created within 24h
        );
        
        if (!isDuplicate) {
          const created = await base44.asServiceRole.entities.PatientAlert.create({
            ...alert,
            status: 'active',
            flagged_urgent: alert.severity === 'critical'
          });
          alerts.push(created);
        }
      }
    }
    
    return Response.json({
      success: true,
      alerts_generated: alerts.length,
      patients_monitored: patients.length,
      timestamp: currentDate.toISOString()
    });
    
  } catch (error) {
    console.error('Error monitoring compliance risks:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});