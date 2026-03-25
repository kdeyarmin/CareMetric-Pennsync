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

    // 1. Fetch comprehensive historical data
    const [
      providerSettings,
      recentRecommendations,
      allModules,
      existingCompletions,
      complianceAudits,
      patientCases,
      visits
    ] = await Promise.all([
      base44.entities.ProviderSettings.filter({ provider_type: providerType, is_active: true }),
      base44.entities.TrainingRecommendation.filter({ nurse_email: nurseEmail, addressed: false }, '-created_date', 50),
      base44.entities.TrainingModule.filter({ is_active: true }),
      base44.entities.TrainingCompletion.filter({ nurse_email: nurseEmail }),
      base44.entities.ComplianceAudit.filter({ nurse_email: nurseEmail }, '-audit_date', 30),
      base44.entities.Patient.filter({ created_by: nurseEmail }),
      base44.entities.Visit.filter({ created_by: nurseEmail }, '-visit_date', 100)
    ]);

    // 2. Analyze historical compliance performance by category
    const compliancePerformance = analyzeCompliancePerformance(complianceAudits, recentRecommendations);
    
    // 3. Calculate patient case complexity
    const caseComplexity = analyzeCaseComplexity(patientCases, visits);

    // 4. Analyze training feedback to understand what works
    const trainingEffectiveness = analyzeTrainingEffectiveness(existingCompletions);

    // 5. Build skill gap profile with severity scores
    const skillGapProfile = buildSkillGapProfile({
      complianceResults,
      complianceAudits,
      recentRecommendations,
      compliancePerformance,
      caseComplexity
    });

    // 6. Score and rank all modules based on relevance
    const scoredModules = allModules
      .filter(m => !isAlreadyAssigned(m.id, existingCompletions))
      .map(module => ({
        module,
        score: calculateModuleRelevanceScore({
          module,
          skillGapProfile,
          providerType,
          providerSettings: providerSettings[0],
          trainingEffectiveness,
          caseComplexity,
          existingCompletions
        })
      }))
      .filter(sm => sm.score > 0)
      .sort((a, b) => b.score - a.score);

    // 7. Select top modules based on learning capacity
    const modulesToAssign = scoredModules.slice(0, determineOptimalTrainingLoad(nurseEmail, existingCompletions));

    // 8. Create training completion records with intelligent due dates
    for (const scoredModule of modulesToAssign) {
      const module = scoredModule.module;
      const relevanceScore = scoredModule.score;
      
      // Calculate due date based on urgency (driven by score and severity)
      const dueDate = new Date();
      const urgencyLevel = getUrgencyLevel(relevanceScore, skillGapProfile);
      
      if (urgencyLevel === 'critical') {
        dueDate.setDate(dueDate.getDate() + 3); // 3 days
      } else if (urgencyLevel === 'high') {
        dueDate.setDate(dueDate.getDate() + 7); // 1 week
      } else if (urgencyLevel === 'medium') {
        dueDate.setDate(dueDate.getDate() + 14); // 2 weeks
      } else {
        dueDate.setDate(dueDate.getDate() + 30); // 1 month
      }

      await base44.entities.TrainingCompletion.create({
        nurse_email: nurseEmail,
        training_module_id: module.id,
        status: 'assigned',
        due_date: dueDate.toISOString().split('T')[0]
      });

      // Generate detailed assignment reason
      const assignmentReason = generateAssignmentReason(skillGapProfile, module, relevanceScore);

      assignedModules.push({
        module_id: module.id,
        title: module.title,
        category: module.category,
        due_date: dueDate.toISOString().split('T')[0],
        urgency: urgencyLevel,
        relevance_score: relevanceScore.toFixed(1),
        reason: assignmentReason
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
      skill_gap_profile: skillGapProfile,
      performance_summary: {
        compliance_performance: compliancePerformance,
        case_complexity: caseComplexity,
        training_effectiveness: trainingEffectiveness
      }
    });

  } catch (error) {
    console.error('Auto-assign training error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});

// ========== HELPER FUNCTIONS ==========

function analyzeCompliancePerformance(audits, recommendations) {
  const categoryScores = {};
  const categoryFrequency = {};
  
  // Analyze audit results by category
  audits.forEach(audit => {
    audit.issues?.forEach(issue => {
      const category = categorizeIssue(issue.element);
      if (!categoryScores[category]) {
        categoryScores[category] = { total: 0, count: 0, severities: [] };
      }
      categoryScores[category].total += (100 - (issue.severity === 'critical' ? 30 : issue.severity === 'high' ? 20 : 10));
      categoryScores[category].count += 1;
      categoryScores[category].severities.push(issue.severity);
    });
  });

  // Analyze recommendation frequency
  recommendations.forEach(rec => {
    const category = rec.recommendation_type;
    categoryFrequency[category] = (categoryFrequency[category] || 0) + 1;
  });

  // Calculate average scores and identify weak areas
  const weakAreas = [];
  Object.entries(categoryScores).forEach(([category, data]) => {
    const avgScore = data.total / data.count;
    const criticalCount = data.severities.filter(s => s === 'critical').length;
    
    if (avgScore < 80 || criticalCount > 0) {
      weakAreas.push({
        category,
        avgScore: avgScore.toFixed(1),
        issueCount: data.count,
        criticalCount,
        frequency: categoryFrequency[category] || 0
      });
    }
  });

  return {
    categoryScores,
    weakAreas: weakAreas.sort((a, b) => (b.criticalCount - a.criticalCount) || (a.avgScore - b.avgScore)),
    overallTrend: audits.length > 2 ? calculateTrend(audits) : 'stable'
  };
}

function analyzeCaseComplexity(patients, visits) {
  let complexityScore = 0;
  let factors = [];

  // Multiple comorbidities
  const avgComorbidities = patients.reduce((sum, p) => sum + (p.secondary_diagnoses?.length || 0), 0) / (patients.length || 1);
  if (avgComorbidities > 3) {
    complexityScore += 20;
    factors.push('High comorbidity burden');
  }

  // Hospice patients
  const hospiceCount = patients.filter(p => p.care_type === 'hospice').length;
  if (hospiceCount > 0) {
    complexityScore += 15 * (hospiceCount / patients.length);
    factors.push(`${hospiceCount} hospice patient(s)`);
  }

  // Wound care
  const woundPatients = patients.filter(p => p.wounds?.length > 0).length;
  if (woundPatients > patients.length * 0.3) {
    complexityScore += 15;
    factors.push('Significant wound care caseload');
  }

  // Recent hospitalizations
  const recentHospitalizations = patients.filter(p => 
    p.past_hospitalizations?.some(h => {
      const hospDate = new Date(h.date);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return hospDate > threeMonthsAgo;
    })
  ).length;
  
  if (recentHospitalizations > patients.length * 0.2) {
    complexityScore += 10;
    factors.push('High readmission risk patients');
  }

  return {
    score: Math.min(100, complexityScore),
    level: complexityScore > 50 ? 'high' : complexityScore > 25 ? 'medium' : 'low',
    factors
  };
}

function analyzeTrainingEffectiveness(completions) {
  const feedback = completions.filter(c => c.relevance_rating || c.effectiveness_rating);
  
  if (feedback.length === 0) {
    return { hasData: false };
  }

  // Calculate effectiveness by module category
  const categoryEffectiveness = {};
  
  feedback.forEach(comp => {
    const module = comp.training_module_id;
    const rating = comp.relevance_rating || comp.effectiveness_rating || 0;
    
    // We'd need to join with modules to get category, simplified here
    if (!categoryEffectiveness['general']) {
      categoryEffectiveness['general'] = { total: 0, count: 0, modules: [] };
    }
    categoryEffectiveness['general'].total += rating;
    categoryEffectiveness['general'].count += 1;
  });

  // Find what types of training this nurse finds most valuable
  const preferredLearningStyle = feedback.filter(c => c.would_recommend).length > feedback.length * 0.7
    ? 'responsive_to_training'
    : 'needs_engagement';

  return {
    hasData: true,
    avgRating: feedback.reduce((sum, c) => sum + (c.relevance_rating || 0), 0) / feedback.length,
    preferredLearningStyle,
    completionRate: completions.filter(c => c.status === 'completed').length / completions.length,
    categoryEffectiveness
  };
}

function buildSkillGapProfile(data) {
  const { complianceResults, complianceAudits, recentRecommendations, compliancePerformance, caseComplexity } = data;
  const gaps = {};

  // Process current compliance results
  if (complianceResults) {
    processComplianceViolations(gaps, complianceResults.compliance_violations, 'medicare', 10);
    processComplianceViolations(gaps, complianceResults.hipaa_compliance?.violations, 'hipaa', 15);
    processComplianceViolations(gaps, complianceResults.state_regulatory?.potential_violations, 'state_regulation', 12);
  }

  // Process historical audits with recency weighting
  complianceAudits.forEach((audit, idx) => {
    const recencyWeight = 1 - (idx / complianceAudits.length) * 0.5; // More recent = higher weight
    audit.issues?.forEach(issue => {
      const category = categorizeIssue(issue.element);
      const severityScore = issue.severity === 'critical' ? 30 : issue.severity === 'high' ? 20 : 10;
      
      if (!gaps[category]) {
        gaps[category] = { score: 0, frequency: 0, severities: [], elements: new Set() };
      }
      gaps[category].score += severityScore * recencyWeight;
      gaps[category].frequency += recencyWeight;
      gaps[category].severities.push(issue.severity);
      gaps[category].elements.add(issue.element);
    });
  });

  // Add weak areas from performance analysis
  compliancePerformance.weakAreas?.forEach(area => {
    if (!gaps[area.category]) {
      gaps[area.category] = { score: 0, frequency: 0, severities: [], elements: new Set() };
    }
    gaps[area.category].score += (100 - area.avgScore) * 0.5;
    gaps[area.category].frequency += area.frequency * 0.3;
  });

  // Boost complexity-related gaps
  if (caseComplexity.level === 'high') {
    caseComplexity.factors.forEach(factor => {
      const category = mapComplexityToCategory(factor);
      if (gaps[category]) {
        gaps[category].score *= 1.3; // 30% boost for complexity
      }
    });
  }

  // Convert to sorted array
  return Object.entries(gaps)
    .map(([category, data]) => ({
      category,
      score: data.score,
      frequency: data.frequency,
      avgSeverity: calculateAvgSeverity(data.severities),
      elements: Array.from(data.elements)
    }))
    .sort((a, b) => b.score - a.score);
}

function calculateModuleRelevanceScore(params) {
  const { module, skillGapProfile, providerType, providerSettings, trainingEffectiveness, caseComplexity, existingCompletions } = params;
  
  let score = 0;

  // 1. Skill gap alignment (0-50 points)
  const matchingGaps = skillGapProfile.filter(gap => 
    module.category?.toLowerCase().includes(gap.category.toLowerCase()) ||
    module.related_skills?.some(s => s.toLowerCase().includes(gap.category.toLowerCase())) ||
    gap.elements.some(e => module.title?.toLowerCase().includes(e.toLowerCase()))
  );

  if (matchingGaps.length > 0) {
    const topGap = matchingGaps[0];
    score += Math.min(50, topGap.score);
    
    // Frequency bonus
    if (topGap.frequency > 3) {
      score += 10;
    }
  }

  // 2. Provider type relevance (0-20 points)
  if (providerSettings?.common_diagnoses?.some(d => 
    module.related_diagnoses?.some(md => md.toLowerCase().includes(d.toLowerCase()))
  )) {
    score += 20;
  }

  // 3. Case complexity alignment (0-15 points)
  if (caseComplexity.level === 'high' && module.difficulty_level === 'advanced') {
    score += 15;
  } else if (caseComplexity.level === 'medium' && module.difficulty_level === 'intermediate') {
    score += 10;
  }

  // 4. Historical effectiveness (0-15 points)
  if (trainingEffectiveness.hasData) {
    // Check if similar modules were effective
    const similarCompleted = existingCompletions.filter(c => 
      c.status === 'completed' && 
      (c.relevance_rating || 0) >= 4
    );
    if (similarCompleted.length > 0) {
      score += 10;
    }
  }

  // 5. Recency penalty - don't over-assign similar content
  const recentSimilar = existingCompletions.filter(c => {
    const completedDate = new Date(c.completion_date || c.created_date);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return completedDate > thirtyDaysAgo && c.status === 'completed';
  });
  
  if (recentSimilar.length > 2) {
    score *= 0.7; // 30% penalty
  }

  // 6. Required training boost
  if (module.is_required || module.required_for_onboarding) {
    score += 25;
  }

  return score;
}

function processComplianceViolations(gaps, violations, category, baseScore) {
  violations?.forEach(v => {
    const severityMultiplier = v.severity === 'critical' ? 3 : v.severity === 'high' ? 2 : 1;
    const subCategory = v.category || v.element || category;
    
    if (!gaps[subCategory]) {
      gaps[subCategory] = { score: 0, frequency: 0, severities: [], elements: new Set() };
    }
    gaps[subCategory].score += baseScore * severityMultiplier;
    gaps[subCategory].frequency += 1;
    gaps[subCategory].severities.push(v.severity || v.risk_level);
    gaps[subCategory].elements.add(v.element || v.requirement);
  });
}

function categorizeIssue(element) {
  const categoryMap = {
    'HOMEBOUND': 'documentation',
    'SKILLED': 'clinical',
    'PATIENT RESPONSE': 'patient_education',
    'SAFETY': 'safety',
    'HIPAA': 'hipaa',
    'MEDICATION': 'medication',
    'OASIS': 'oasis'
  };

  for (const [key, category] of Object.entries(categoryMap)) {
    if (element?.toUpperCase().includes(key)) {
      return category;
    }
  }
  
  return 'documentation';
}

function calculateAvgSeverity(severities) {
  if (severities.length === 0) return 'low';
  const severityScores = { critical: 3, high: 2, medium: 1, low: 0 };
  const avg = severities.reduce((sum, s) => sum + (severityScores[s] || 0), 0) / severities.length;
  
  if (avg >= 2.5) return 'critical';
  if (avg >= 1.5) return 'high';
  if (avg >= 0.5) return 'medium';
  return 'low';
}

function calculateTrend(audits) {
  if (audits.length < 3) return 'stable';
  
  const recentAvg = audits.slice(0, 5).reduce((sum, a) => sum + (a.compliance_score || 0), 0) / 5;
  const olderAvg = audits.slice(5, 10).reduce((sum, a) => sum + (a.compliance_score || 0), 0) / Math.min(5, audits.length - 5);
  
  if (recentAvg > olderAvg + 5) return 'improving';
  if (recentAvg < olderAvg - 5) return 'declining';
  return 'stable';
}

function isAlreadyAssigned(moduleId, completions) {
  return completions.some(c => 
    c.training_module_id === moduleId && 
    (c.status === 'assigned' || c.status === 'in_progress')
  );
}

function determineOptimalTrainingLoad(nurseEmail, existingCompletions) {
  const activeTraining = existingCompletions.filter(c => 
    c.status === 'assigned' || c.status === 'in_progress'
  ).length;

  // Don't overwhelm - limit based on current load
  if (activeTraining >= 5) return 2; // Only add 2 more
  if (activeTraining >= 3) return 3; // Add 3 more
  return 5; // Can handle 5 new modules
}

function getUrgencyLevel(score, skillGapProfile) {
  // Check if there are critical gaps
  const hasCriticalGaps = skillGapProfile.some(g => g.avgSeverity === 'critical');
  
  if (hasCriticalGaps && score > 70) return 'critical';
  if (score > 60) return 'high';
  if (score > 30) return 'medium';
  return 'low';
}

function generateAssignmentReason(skillGapProfile, module, score) {
  const matchingGaps = skillGapProfile.filter(gap => 
    module.category?.toLowerCase().includes(gap.category.toLowerCase()) ||
    gap.elements.some(e => module.title?.toLowerCase().includes(e.toLowerCase()))
  );

  if (matchingGaps.length > 0) {
    const gap = matchingGaps[0];
    return `Addresses ${gap.category} performance gap (${gap.issueCount} recent issue${gap.issueCount > 1 ? 's' : ''}, severity: ${gap.avgSeverity})`;
  }

  if (module.is_required) {
    return 'Required agency training';
  }

  return 'Recommended based on provider type and role';
}

function mapComplexityToCategory(factor) {
  if (factor.includes('wound')) return 'wound_care';
  if (factor.includes('hospice')) return 'end_of_life';
  if (factor.includes('comorbidity')) return 'clinical';
  if (factor.includes('readmission')) return 'care_coordination';
  return 'clinical';
}