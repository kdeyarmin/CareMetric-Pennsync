import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { patientDiagnosis, limit = 5 } = await req.json();

    if (!patientDiagnosis) {
      return new Response(
        JSON.stringify({ suggestions: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all approved education materials
    const materials = await base44.asServiceRole.entities.PatientEducationMaterial.filter({
      is_approved: true,
      is_active: true
    });

    if (!materials || materials.length === 0) {
      return new Response(
        JSON.stringify({ suggestions: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Find materials matching the diagnosis
    const relevantMaterials = materials.filter(m =>
      m.diagnoses && m.diagnoses.some(d =>
        d.toLowerCase().includes(patientDiagnosis.toLowerCase()) ||
        patientDiagnosis.toLowerCase().includes(d.toLowerCase())
      )
    );

    // Sort by rating and view count
    const sorted = relevantMaterials
      .sort((a, b) => {
        const aScore = (a.average_rating || 0) * 2 + (a.view_count || 0);
        const bScore = (b.average_rating || 0) * 2 + (b.view_count || 0);
        return bScore - aScore;
      })
      .slice(0, limit);

    return new Response(
      JSON.stringify({ suggestions: sorted }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Education Material Suggestion Error:', error);
    return new Response(
      JSON.stringify({ error: error.message, suggestions: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});