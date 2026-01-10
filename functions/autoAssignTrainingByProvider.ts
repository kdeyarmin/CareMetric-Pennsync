import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Automatically assigns training modules based on:
 * - Provider type
 * - Compliance audit results
 * - Identified skill gaps
 * - Recent training recommendations
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { nurseEmail, providerType, complianceResults = null } = await req.json();

    // Only admin or self can trigger training assignment
    if (user.role !== 'admin' && user.email !== nurseEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.log(`Auto-assigning training for ${nurseEmail} (${providerType})`);

    const assignedModules = [];

    // 1. Get provider-specific baseline training
    const providerSettings = await base44.entities.ProviderSettings.filter({
      provider_type: providerType,
      is_active: true
    });

    // 2. Get recent training recommendations for this nurse
    const recentRecommendations = await base44.entities.TrainingRecommendation.filter({
      nurse_email: nurseEmail,
      addressed: false
    }, '-created_date', 20);

    // 3. Get all available training modules
    const allModules = await base44.entities.TrainingModule.filter({
      is_active: true
    });

    // 4. Filter modules relevant to provider type
    const relevantModules = allModules.filter(module => {
      // Check if module applies to this provider type
      if (module.related_diagnoses?.length > 0) {
        // Provider-specific diagnosis focus
        const providerDiagnoses = providerSettings[0]?.common_diagnoses || [];
        return module.related_diagnoses.some(d => 
          providerDiagnoses.some(pd => d.toLowerCase().includes(pd.toLowerCase()))
        );
      }
      return true; // Include general modules
    });

    // 5. Analyze compliance results for skill gaps
    const skillGaps = new Set();
    
    if (complianceResults) {
      // Extract skill gaps from compliance violations
      complianceResults.compliance_violations?.forEach(v => {
        if (v.severity === 'critical' || v.severity === 'high') {
          skillGaps.add(v.element);
        }
      });

      // Extract from HIPAA violations
      complianceResults.hipaa_compliance?.violations?.forEach(v => {
        skillGaps.add(v.category);
      });

      // Extract from state regulatory issues
      complianceResults.state_regulatory?.potential_violations?.forEach(v => {
        skillGaps.add(v.requirement);
      });
    }

    // Also get skill gaps from recommendations
    recentRecommendations.forEach(rec => {
      if (rec.severity === 'critical' || rec.severity === 'high') {
        skillGaps.add(rec.recommendation_type);
      }
    });

    // 6. Match training modules to skill gaps
    const gapBasedModules = relevantModules.filter(module => {
      // Check if module addresses any skill gaps
      return Array.from(skillGaps).some(gap => 
        module.category?.toLowerCase().includes(gap.toLowerCase()) ||
        module.title?.toLowerCase().includes(gap.toLowerCase()) ||
        module.related_skills?.some(s => s.toLowerCase().includes(gap.toLowerCase()))
      );
    });

    // 7. Get existing training completions to avoid duplicates
    const existingCompletions = await base44.entities.TrainingCompletion.filter({
      nurse_email: nurseEmail,
      status: { $in: ['assigned', 'in_progress', 'completed'] }
    });

    const completedModuleIds = new Set(existingCompletions.map(c => c.training_module_id));

    // 8. Assign priority modules (not already assigned)
    const modulesToAssign = [
      ...gapBasedModules.filter(m => !completedModuleIds.has(m.id)),
      // Add required modules for provider type
      ...relevantModules.filter(m => 
        m.required_for_onboarding && !completedModuleIds.has(m.id)
      )
    ].slice(0, 5); // Limit to 5 modules at a time

    // 9. Create training completion records
    for (const module of modulesToAssign) {
      // Calculate due date based on priority
      const dueDate = new Date();
      if (Array.from(skillGaps).some(gap => 
        module.title?.toLowerCase().includes(gap.toLowerCase())
      )) {
        dueDate.setDate(dueDate.getDate() + 7); // 1 week for high-priority
      } else {
        dueDate.setDate(dueDate.getDate() + 30); // 1 month for general
      }

      await base44.entities.TrainingCompletion.create({
        nurse_email: nurseEmail,
        training_module_id: module.id,
        status: 'assigned',
        due_date: dueDate.toISOString().split('T')[0]
      });

      assignedModules.push({
        module_id: module.id,
        title: module.title,
        category: module.category,
        due_date: dueDate.toISOString().split('T')[0],
        reason: Array.from(skillGaps).some(gap => 
          module.title?.toLowerCase().includes(gap.toLowerCase())
        ) ? 'Addresses identified skill gap' : 'Provider-specific baseline training'
      });
    }

    // 10. Mark addressed recommendations
    if (assignedModules.length > 0) {
      for (const rec of recentRecommendations.slice(0, 10)) {
        await base44.entities.TrainingRecommendation.update(rec.id, {
          addressed: true
        });
      }
    }

    // 11. Create notification task
    if (assignedModules.length > 0) {
      await base44.entities.Task.create({
        title: `${assignedModules.length} New Training Module(s) Assigned`,
        description: `Training modules have been automatically assigned based on your provider type and recent performance:\n\n` +
          assignedModules.map(m => `- ${m.title} (Due: ${m.due_date})\n  Reason: ${m.reason}`).join('\n\n'),
        type: 'other',
        priority: 'medium',
        assigned_to: nurseEmail,
        source: 'ai_generated',
        due_timeframe: 'this_week'
      });
    }

    return Response.json({
      success: true,
      assigned_count: assignedModules.length,
      modules: assignedModules,
      skill_gaps_addressed: Array.from(skillGaps)
    });

  } catch (error) {
    console.error('Auto-assign training error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});