import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { nurseEmail, daysPeriod = 30 } = await req.json();
    // Only admins may analyze another nurse's deficits/PHI; others get themselves.
    if (nurseEmail && nurseEmail !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const emailToAnalyze = nurseEmail || user.email;

    // Fetch all AI suggestions for this nurse in the time period
    const suggestions = await base44.asServiceRole.entities.TrainingRecommendation.filter({
      nurse_email: emailToAnalyze
    });

    // Filter by date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysPeriod);
    
    const recentSuggestions = suggestions.filter(s => 
      new Date(s.created_date) >= cutoffDate
    );

    if (recentSuggestions.length === 0) {
      return Response.json({
        nurseEmail: emailToAnalyze,
        totalSuggestions: 0,
        deficits: [],
        patterns: [],
        recommendations: [],
        strengths: []
      });
    }

    // Pattern Analysis
    const categoryFrequency = {};
    const elementFrequency = {};
    const sourceFrequency = {};
    const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0 };
    const timelineData = {};
    const patientSpecificPatterns = {};

    recentSuggestions.forEach(sugg => {
      // Category frequency
      categoryFrequency[sugg.recommendation_type] = (categoryFrequency[sugg.recommendation_type] || 0) + 1;

      // Element frequency (from context_data)
      if (sugg.context_data?.element) {
        elementFrequency[sugg.context_data.element] = (elementFrequency[sugg.context_data.element] || 0) + 1;
      }

      // Source frequency
      sourceFrequency[sugg.source] = (sourceFrequency[sugg.source] || 0) + 1;

      // Severity distribution
      if (sugg.severity) {
        severityDistribution[sugg.severity]++;
      }

      // Timeline (by week)
      const weekKey = new Date(sugg.created_date).toISOString().split('T')[0].substring(0, 7); // YYYY-MM
      timelineData[weekKey] = (timelineData[weekKey] || 0) + 1;

      // Patient-specific patterns
      if (sugg.patient_id) {
        patientSpecificPatterns[sugg.patient_id] = (patientSpecificPatterns[sugg.patient_id] || 0) + 1;
      }
    });

    // Identify deficits (categories/elements with high frequency)
    const categoryDeficits = Object.entries(categoryFrequency)
      .filter(([_, count]) => count >= 3)
      .map(([category, count]) => ({
        type: 'category',
        name: category,
        count,
        severity: count >= 10 ? 'critical' : count >= 6 ? 'high' : 'medium',
        percentage: Math.round((count / recentSuggestions.length) * 100),
        examples: recentSuggestions
          .filter(s => s.recommendation_type === category)
          .slice(0, 3)
          .map(s => ({
            text: s.recommendation_text,
            source: s.source,
            date: s.created_date,
            element: s.context_data?.element
          }))
      }))
      .sort((a, b) => b.count - a.count);

    const elementDeficits = Object.entries(elementFrequency)
      .filter(([_, count]) => count >= 2)
      .map(([element, count]) => ({
        type: 'element',
        name: element,
        count,
        severity: count >= 5 ? 'high' : 'medium',
        percentage: Math.round((count / recentSuggestions.length) * 100),
        examples: recentSuggestions
          .filter(s => s.context_data?.element === element)
          .slice(0, 2)
          .map(s => ({
            text: s.recommendation_text,
            source: s.source,
            date: s.created_date
          }))
      }))
      .sort((a, b) => b.count - a.count);

    // Combine deficits
    const allDeficits = [...categoryDeficits, ...elementDeficits];

    // Identify patterns
    const patterns = [];

    // Pattern: Consistent issues with specific source
    Object.entries(sourceFrequency).forEach(([source, count]) => {
      if (count >= 5) {
        patterns.push({
          type: 'source_dependency',
          description: `High reliance on ${source} (${count} suggestions)`,
          implication: 'May indicate foundational skill gap requiring comprehensive training',
          count
        });
      }
    });

    // Pattern: High severity issues
    if (severityDistribution.critical + severityDistribution.high > recentSuggestions.length * 0.3) {
      patterns.push({
        type: 'high_severity',
        description: 'High proportion of critical/high severity suggestions',
        implication: 'Urgent training needed to prevent compliance issues',
        count: severityDistribution.critical + severityDistribution.high
      });
    }

    // Pattern: Specific element repetition
    const topElement = Object.entries(elementFrequency).sort((a, b) => b[1] - a[1])[0];
    if (topElement && topElement[1] >= 4) {
      patterns.push({
        type: 'element_repetition',
        description: `Recurring issue with "${topElement[0]}" (${topElement[1]} times)`,
        implication: 'Targeted practice on this specific element recommended',
        count: topElement[1]
      });
    }

    // Training recommendations based on deficits
    const trainingMap = {
      'documentation': {
        scenarios: ['homebound_justification', 'skilled_need'],
        quizzes: ['medicare_cop', 'oasis'],
        priority: 1
      },
      'clinical': {
        scenarios: ['vital_signs', 'skilled_need'],
        quizzes: ['skilled_need', 'oasis'],
        priority: 2
      },
      'communication': {
        scenarios: ['patient_response'],
        quizzes: ['homebound', 'safety'],
        priority: 3
      },
      'compliance': {
        scenarios: ['homebound_justification', 'skilled_need', 'patient_response'],
        quizzes: ['medicare_cop', 'oasis', 'homebound'],
        priority: 1
      },
      'safety': {
        scenarios: ['vital_signs', 'patient_response'],
        quizzes: ['safety', 'infection_control'],
        priority: 2
      }
    };

    const recommendations = categoryDeficits.map(deficit => ({
      category: deficit.name,
      severity: deficit.severity,
      count: deficit.count,
      percentage: deficit.percentage,
      suggestedScenarios: trainingMap[deficit.name]?.scenarios || [],
      suggestedQuizzes: trainingMap[deficit.name]?.quizzes || [],
      priority: trainingMap[deficit.name]?.priority || 3,
      rationale: `Based on ${deficit.count} AI suggestions in ${deficit.name}, focused training is recommended`
    })).sort((a, b) => a.priority - b.priority);

    // Identify strengths (categories with low suggestion frequency)
    const allCategories = ['documentation', 'clinical', 'compliance', 'safety', 'communication', 'technology'];
    const strengths = allCategories
      .filter(cat => !categoryFrequency[cat] || categoryFrequency[cat] < 2)
      .map(cat => ({
        category: cat,
        description: `Strong ${cat} skills with minimal AI assistance needed`
      }));

    return Response.json({
      nurseEmail: emailToAnalyze,
      analysisPeriod: `${daysPeriod} days`,
      totalSuggestions: recentSuggestions.length,
      deficits: allDeficits,
      patterns,
      recommendations,
      strengths,
      analytics: {
        categoryBreakdown: categoryFrequency,
        elementBreakdown: elementFrequency,
        sourceBreakdown: sourceFrequency,
        severityDistribution,
        timeline: timelineData,
        patientSpecificCount: Object.keys(patientSpecificPatterns).length
      },
      rawSuggestions: recentSuggestions.slice(0, 50) // Include raw data for detailed view
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});