import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const defaultTemplates = [
      {
        template_name: 'Patient Education Handout',
        template_type: 'patient_education',
        description: 'General patient education handout for health conditions and treatments',
        category: 'Education',
        template_content: `
          <html>
            <head><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }</style></head>
            <body>
              <h1>Patient Education: {{topic}}</h1>
              <p><strong>Date:</strong> {{date}}</p>
              <p><strong>Patient:</strong> {{patient_name}}</p>
              
              <h2>About Your Condition</h2>
              <p>{{condition_description}}</p>
              
              <h2>What You Should Know</h2>
              <p>{{key_information}}</p>
              
              <h2>Instructions</h2>
              <p>{{instructions}}</p>
              
              <h2>When to Contact Your Healthcare Provider</h2>
              <p>{{warning_signs}}</p>
              
              <h2>Additional Resources</h2>
              <p>{{additional_resources}}</p>
              
              <p><em>If you have questions, please contact your healthcare provider.</em></p>
            </body>
          </html>
        `,
        required_fields: ['topic', 'condition_description', 'key_information', 'instructions', 'warning_signs'],
        optional_fields: ['additional_resources'],
        is_system_template: true,
        hipaa_compliant: true,
        tags: ['education', 'patient-facing']
      },
      {
        template_name: 'Discharge Instructions',
        template_type: 'discharge_instructions',
        description: 'Post-care instructions for patients being discharged from care',
        category: 'Discharge',
        template_content: `
          <html>
            <head><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }</style></head>
            <body>
              <h1>Discharge Instructions</h1>
              <p><strong>Patient:</strong> {{patient_name}}</p>
              <p><strong>Discharge Date:</strong> {{date}}</p>
              
              <h2>Diagnosis</h2>
              <p>{{diagnosis}}</p>
              
              <h2>Medications</h2>
              <p>{{medication_instructions}}</p>
              
              <h2>Activity & Diet</h2>
              <p>{{activity_diet_restrictions}}</p>
              
              <h2>Wound Care (if applicable)</h2>
              <p>{{wound_care}}</p>
              
              <h2>Follow-up Appointments</h2>
              <p>{{follow_up_instructions}}</p>
              
              <h2>Warning Signs - Seek Immediate Care If You Experience</h2>
              <p>{{emergency_symptoms}}</p>
              
              <p><strong>Questions?</strong> Contact {{provider_contact_info}}</p>
            </body>
          </html>
        `,
        required_fields: ['diagnosis', 'medication_instructions', 'activity_diet_restrictions', 'follow_up_instructions', 'emergency_symptoms'],
        optional_fields: ['wound_care', 'provider_contact_info'],
        is_system_template: true,
        hipaa_compliant: true,
        tags: ['discharge', 'instructions', 'post-care']
      },
      {
        template_name: 'Referral Letter',
        template_type: 'referral_letter',
        description: 'Professional referral letter to specialist or other healthcare provider',
        category: 'Clinical',
        template_content: `
          <html>
            <head><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }</style></head>
            <body>
              <p><strong>Date:</strong> {{date}}</p>
              
              <p>Dear {{specialist_name}},</p>
              
              <p>I am referring my patient, {{patient_name}} (DOB: {{patient_dob}}), for your evaluation and management.</p>
              
              <h2>Reason for Referral</h2>
              <p>{{reason_for_referral}}</p>
              
              <h2>Clinical Summary</h2>
              <p>{{clinical_summary}}</p>
              
              <h2>Current Medications</h2>
              <p>{{current_medications}}</p>
              
              <h2>Allergies</h2>
              <p>{{allergies}}</p>
              
              <h2>Relevant History</h2>
              <p>{{relevant_history}}</p>
              
              <p>Please advise on your recommendations. I would appreciate your input regarding management of this patient.</p>
              
              <p>Sincerely,</p>
              <p>{{provider_name}}<br/>{{provider_credentials}}</p>
            </body>
          </html>
        `,
        required_fields: ['specialist_name', 'patient_dob', 'reason_for_referral', 'clinical_summary', 'current_medications', 'allergies'],
        optional_fields: ['relevant_history', 'provider_credentials'],
        is_system_template: true,
        hipaa_compliant: true,
        tags: ['referral', 'specialist', 'clinical']
      },
      {
        template_name: 'Care Plan Summary',
        template_type: 'care_plan_summary',
        description: 'Summary of care plan goals and interventions for patient',
        category: 'Care Planning',
        template_content: `
          <html>
            <head><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }</style></head>
            <body>
              <h1>Your Care Plan</h1>
              <p><strong>Patient:</strong> {{patient_name}}</p>
              <p><strong>Date Created:</strong> {{date}}</p>
              
              <h2>Your Healthcare Goals</h2>
              <p>{{care_goals}}</p>
              
              <h2>Problem Areas We're Addressing</h2>
              <p>{{problem_areas}}</p>
              
              <h2>Your Care Plan</h2>
              <p>{{care_plan_details}}</p>
              
              <h2>What You Need to Do</h2>
              <p>{{patient_responsibilities}}</p>
              
              <h2>Your Care Team</h2>
              <p>{{care_team_info}}</p>
              
              <h2>Follow-up Schedule</h2>
              <p>{{follow_up_schedule}}</p>
              
              <p>Your active participation in your care is essential to achieving these goals.</p>
            </body>
          </html>
        `,
        required_fields: ['care_goals', 'problem_areas', 'care_plan_details', 'patient_responsibilities'],
        optional_fields: ['care_team_info', 'follow_up_schedule'],
        is_system_template: true,
        hipaa_compliant: true,
        tags: ['care-plan', 'goals', 'patient-education']
      }
    ];

    // Create templates
    const createdTemplates = await base44.asServiceRole.entities.DocumentTemplate.bulkCreate(defaultTemplates);

    return Response.json({
      success: true,
      count: createdTemplates.length,
      templates: createdTemplates
    });

  } catch (error) {
    console.error('Error creating templates:', error);
    return Response.json({ 
      error: 'Failed to create templates',
      details: error.message 
    }, { status: 500 });
  }
});