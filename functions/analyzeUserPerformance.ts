import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { user_email } = await req.json();
        const targetEmail = user_email || user.email;

        // Fetch user's performance data
        const [noteConversions, oasisAudits, complianceAudits, existingGaps, completedTraining] = await Promise.all([
            base44.asServiceRole.entities.NoteConversion.filter({ nurse_email: targetEmail }, '-created_date', 50),
            base44.asServiceRole.entities.OASISAudit.filter({ user_email: targetEmail }, '-created_date', 20),
            base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, '-audit_date', 30),
            base44.asServiceRole.entities.SkillGap.filter({ user_email: targetEmail, status: { "$ne": "addressed" } }),
            base44.asServiceRole.entities.TrainingCompletion.filter({ nurse_email: targetEmail, status: 'completed' })
        ]);

        if (noteConversions.length === 0 && oasisAudits.length === 0 && complianceAudits.length === 0) {
            return Response.json({ 
                message: 'Not enough data to analyze performance yet',
                gaps_identified: []
            });
        }

        // Build analysis prompt
        const analysisPrompt = `You are an expert healthcare education specialist analyzing a provider's documentation and compliance performance.

**Provider Performance Data:**

**Recent Notes (${noteConversions.length}):**
${noteConversions.slice(0, 10).map(nc => `
- Quality Score: ${nc.quality_score || 0}/100, Compliance: ${nc.enhanced_note_compliance || 0}/100
- Violations: ${nc.violations?.length || 0} (${nc.violations?.slice(0, 3).join(', ') || 'none'})
- Visit Type: ${nc.visit_type}
`).join('\n')}

**OASIS Audits (${oasisAudits.length}):**
${oasisAudits.slice(0, 5).map(oa => `
- Status: ${oa.status}
- Summary: ${oa.summary?.substring(0, 150) || 'N/A'}
`).join('\n')}

**Compliance Audits (${complianceAudits.length}):**
${complianceAudits.slice(0, 10).map(ca => `
- Score: ${ca.compliance_score || 0}/100, Status: ${ca.status}
- Violations: ${ca.violations_found?.slice(0, 3).join(', ') || 'none'}
`).join('\n')}

**Already Completed Training:**
${completedTraining.map(t => t.training_module_id).join(', ') || 'None'}

**Task:**
Analyze this data and identify 3-5 specific skill gaps or areas for improvement. For each gap:
1. Identify the specific skill area (be precise, e.g., "OASIS M1800 Documentation", "Medicare Homebound Criteria")
2. Determine severity (critical/high/medium/low) based on frequency and impact
3. Explain why this gap was identified with evidence
4. Suggest what type of training would help (we'll match to modules later)

Focus on patterns, recurring issues, and areas with the most impact on compliance and quality.`;

        const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: analysisPrompt,
            response_json_schema: {
                type: "object",
                properties: {
                    skill_gaps: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                skill_area: { type: "string" },
                                gap_type: { 
                                    type: "string",
                                    enum: ["documentation", "compliance", "clinical_knowledge", "oasis", "terminology", "assessment"]
                                },
                                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                                reasoning: { type: "string" },
                                frequency_evidence: { type: "string" },
                                training_topic_suggestions: {
                                    type: "array",
                                    items: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        });

        const identifiedGaps = aiResponse.skill_gaps || [];

        // Fetch available training modules
        const allTrainingModules = await base44.asServiceRole.entities.TrainingModule.filter({ is_active: true });

        // Create or update skill gap records
        const gapRecords = [];
        for (const gap of identifiedGaps) {
            // Find matching training modules based on keywords
            const matchedModules = allTrainingModules.filter(tm => 
                gap.training_topic_suggestions.some(topic => 
                    tm.title.toLowerCase().includes(topic.toLowerCase()) ||
                    tm.description?.toLowerCase().includes(topic.toLowerCase()) ||
                    tm.related_skills?.some(skill => skill.toLowerCase().includes(topic.toLowerCase()))
                )
            ).map(m => m.id);

            // Check if similar gap already exists
            const existingGap = existingGaps.find(eg => 
                eg.skill_area.toLowerCase() === gap.skill_area.toLowerCase() &&
                eg.status !== 'addressed'
            );

            if (existingGap) {
                // Update frequency count
                await base44.asServiceRole.entities.SkillGap.update(existingGap.id, {
                    frequency_count: (existingGap.frequency_count || 1) + 1,
                    last_detected: new Date().toISOString(),
                    ai_reasoning: gap.reasoning,
                    recommended_modules: matchedModules,
                    severity: gap.severity
                });
                gapRecords.push({ ...existingGap, updated: true });
            } else {
                // Create new gap record
                const newGap = await base44.asServiceRole.entities.SkillGap.create({
                    user_email: targetEmail,
                    skill_area: gap.skill_area,
                    gap_type: gap.gap_type,
                    severity: gap.severity,
                    ai_reasoning: gap.reasoning,
                    source_records: [
                        ...noteConversions.slice(0, 3).map(nc => ({
                            entity_type: 'NoteConversion',
                            entity_id: nc.id,
                            relevance: 'Documentation pattern'
                        })),
                        ...complianceAudits.slice(0, 2).map(ca => ({
                            entity_type: 'ComplianceAudit',
                            entity_id: ca.id,
                            relevance: 'Compliance issue'
                        }))
                    ],
                    recommended_modules: matchedModules,
                    frequency_count: 1,
                    identified_date: new Date().toISOString(),
                    last_detected: new Date().toISOString(),
                    status: 'identified'
                });
                gapRecords.push({ ...newGap, new: true });
            }
        }

        return Response.json({ 
            success: true,
            message: `Identified ${identifiedGaps.length} skill gaps for ${targetEmail}`,
            gaps_identified: gapRecords,
            analysis_summary: {
                notes_analyzed: noteConversions.length,
                oasis_audits_analyzed: oasisAudits.length,
                compliance_audits_analyzed: complianceAudits.length
            }
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});