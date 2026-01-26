import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { diagnosis, visitType, providerType } = await req.json();

    if (!diagnosis || !visitType) {
      return Response.json(
        { error: 'Missing required fields: diagnosis, visitType' },
        { status: 400 }
      );
    }

    // Fetch all available templates
    const allTemplates = await base44.asServiceRole.entities.DocumentTemplate.list();

    // Filter templates by visit type and category
    const relevantTemplates = allTemplates.filter((t) => {
      const visitTypeMatch = t.visit_type === visitType || !t.visit_type;
      const categoryMatch = !providerType || 
        t.category.toLowerCase().includes(providerType.toLowerCase()) ||
        providerType.toLowerCase().includes(t.category.toLowerCase());
      return visitTypeMatch && categoryMatch;
    });

    // Score and rank templates based on related diagnoses
    const scoredTemplates = relevantTemplates.map((template) => {
      let score = 50;

      // Check if template has related diagnoses
      if (template.related_diagnoses && template.related_diagnoses.length > 0) {
        const diagnosisMatch = template.related_diagnoses.some((d) =>
          diagnosis.toLowerCase().includes(d.toLowerCase()) ||
          d.toLowerCase().includes(diagnosis.toLowerCase())
        );
        if (diagnosisMatch) score += 50;
      }

      // Check tags
      if (template.tags && template.tags.length > 0) {
        const tagMatch = template.tags.some((tag) =>
          diagnosis.toLowerCase().includes(tag.toLowerCase()) ||
          tag.toLowerCase().includes(diagnosis.toLowerCase())
        );
        if (tagMatch) score += 25;
      }

      // Prioritize system templates
      if (template.is_system_template) score += 10;

      return { ...template, score };
    });

    // Sort by score and return top 5
    const topTemplates = scoredTemplates.sort((a, b) => b.score - a.score).slice(0, 5);

    return Response.json({
      suggested_templates: topTemplates,
      total_found: relevantTemplates.length,
      diagnosis,
      visitType,
    });
  } catch (error) {
    console.error('Template suggestion error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});