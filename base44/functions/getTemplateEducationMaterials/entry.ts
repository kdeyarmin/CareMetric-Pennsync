import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { templateId, patientDiagnosis } = await req.json();

    // Get the template
    let linkedMaterials = [];
    let diagnosisMaterials = [];

    if (templateId) {
      const template = await base44.asServiceRole.entities.DocumentTemplate.filter(
        { id: templateId }
      );

      if (template && template[0]?.linked_education_ids?.length > 0) {
        // Get materials linked to this template
        const allMaterials = await base44.asServiceRole.entities.PatientEducationMaterial.filter({
          is_approved: true,
          is_active: true
        });

        linkedMaterials = allMaterials.filter(m =>
          template[0].linked_education_ids.includes(m.id)
        );
      }
    }

    // If patient diagnosis provided, get relevant materials
    if (patientDiagnosis) {
      const allMaterials = await base44.asServiceRole.entities.PatientEducationMaterial.filter({
        is_approved: true,
        is_active: true
      });

      diagnosisMaterials = allMaterials.filter(m =>
        m.diagnoses && m.diagnoses.some(d =>
          d.toLowerCase().includes(patientDiagnosis.toLowerCase()) ||
          patientDiagnosis.toLowerCase().includes(d.toLowerCase())
        )
      ).slice(0, 5);
    }

    // Combine and deduplicate
    const allMaterialIds = new Set([
      ...linkedMaterials.map(m => m.id),
      ...diagnosisMaterials.map(m => m.id)
    ]);

    const combined = [
      ...linkedMaterials,
      ...diagnosisMaterials.filter(m => !linkedMaterials.find(lm => lm.id === m.id))
    ];

    return new Response(
      JSON.stringify({
        linkedMaterials,
        diagnosisMaterials: diagnosisMaterials.filter(m =>
          !linkedMaterials.find(lm => lm.id === m.id)
        ),
        allMaterials: combined.slice(0, 10)
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching template education materials:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        linkedMaterials: [],
        diagnosisMaterials: [],
        allMaterials: []
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});