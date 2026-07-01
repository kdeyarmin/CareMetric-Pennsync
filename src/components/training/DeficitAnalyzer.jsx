import { base44 } from "@/api/base44Client";
import { analyzeNurseDeficits as analyzeNurseDeficitsBackend } from "@/functions/analyzeNurseDeficits";

// Client-side wrapper that calls the backend analysis function
export const analyzeNurseDeficits = async (nurseEmail, daysPeriod = 30) => {
  if (!nurseEmail) return null;

  try {
    const response = await analyzeNurseDeficitsBackend({
      nurseEmail,
      daysPeriod
    });
    
    return response.data;
  } catch (error) {
    console.error("Error analyzing nurse deficits:", error);
    // Fallback to client-side analysis if backend fails
    return fallbackClientAnalysis(nurseEmail);
  }
};

// Fallback client-side analysis
const fallbackClientAnalysis = async (nurseEmail) => {
  try {
    const suggestions = await base44.entities.TrainingRecommendation.filter({
      nurse_email: nurseEmail,
      addressed: false
    }, '-created_date', 100);

    if (suggestions.length === 0) {
      return { deficits: [], strengths: [], recommendations: [] };
    }

    const categoryFrequency = {};
    const recentSuggestions = {};

    suggestions.forEach(sugg => {
      categoryFrequency[sugg.recommendation_type] = (categoryFrequency[sugg.recommendation_type] || 0) + 1;
      
      if (!recentSuggestions[sugg.recommendation_type]) {
        recentSuggestions[sugg.recommendation_type] = [];
      }
      if (recentSuggestions[sugg.recommendation_type].length < 3) {
        recentSuggestions[sugg.recommendation_type].push({
          text: sugg.recommendation_text,
          source: sugg.source,
          date: sugg.created_date
        });
      }
    });

    const deficits = Object.entries(categoryFrequency)
      .filter(([_, count]) => count >= 3)
      .map(([category, count]) => ({
        category,
        count,
        severity: count >= 10 ? 'critical' : count >= 6 ? 'high' : 'medium',
        examples: recentSuggestions[category] || []
      }))
      .sort((a, b) => b.count - a.count);

    const trainingMap = {
      'documentation': { scenarios: ['homebound_justification', 'skilled_need'], quizzes: ['medicare_cop', 'oasis'] },
      'clinical': { scenarios: ['vital_signs', 'skilled_need'], quizzes: ['skilled_need', 'oasis'] },
      'communication': { scenarios: ['patient_response'], quizzes: ['homebound', 'safety'] },
      'compliance': { scenarios: ['homebound_justification', 'skilled_need', 'patient_response'], quizzes: ['medicare_cop', 'oasis', 'homebound'] },
      'safety': { scenarios: ['vital_signs', 'patient_response'], quizzes: ['safety', 'infection_control'] }
    };

    const recommendations = deficits.map(deficit => ({
      category: deficit.category,
      severity: deficit.severity,
      count: deficit.count,
      suggestedScenarios: trainingMap[deficit.category]?.scenarios || [],
      suggestedQuizzes: trainingMap[deficit.category]?.quizzes || [],
      priority: deficit.severity === 'critical' ? 1 : deficit.severity === 'high' ? 2 : 3
    })).sort((a, b) => a.priority - b.priority);

    return { deficits, recommendations, totalSuggestions: suggestions.length };
  } catch (error) {
    console.error("Error in fallback analysis:", error);
    return null;
  }
};
