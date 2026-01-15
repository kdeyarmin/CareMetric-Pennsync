import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader } from 'lucide-react';
import { toast } from 'sonner';

export default function PersonalizedRecommendationsWidget() {
  const [recommendations, setRecommendations] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleGenerateRecommendations = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('generateTrainingRecommendations', {});
      setRecommendations(response.data);
      toast.success('Personalized recommendations generated');
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Your Personalized Learning Path
        </CardTitle>
        <CardDescription>AI-powered training recommendations based on your performance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!recommendations ? (
          <Button
            onClick={handleGenerateRecommendations}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading && <Loader className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? 'Generating...' : 'Generate My Recommendations'}
          </Button>
        ) : (
          <div className="space-y-6">
            {/* User Profile Summary */}
            {recommendations.user_profile && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-3">Your Learning Profile</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-600">Completed Modules</p>
                    <p className="text-2xl font-bold text-blue-600">{recommendations.user_profile.completed_modules}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Average Score</p>
                    <p className="text-2xl font-bold text-blue-600">{recommendations.user_profile.average_score}%</p>
                  </div>
                </div>
              </div>
            )}

            {/* Priority Recommendations */}
            {recommendations.recommendations?.priority_recommendations && recommendations.recommendations.priority_recommendations.length > 0 && (
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <h4 className="font-semibold text-purple-900 mb-3">🎯 Priority Recommendations</h4>
                <ul className="space-y-2">
                  {recommendations.recommendations.priority_recommendations.slice(0, 3).map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-purple-800">
                      <span className="text-purple-600 font-bold mt-0.5">{idx + 1}.</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Skill Gap Training */}
            {recommendations.recommendations?.skill_gap_training && recommendations.recommendations.skill_gap_training.length > 0 && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <h4 className="font-semibold text-orange-900 mb-3">📚 Fill Your Skill Gaps</h4>
                <ul className="space-y-2">
                  {recommendations.recommendations.skill_gap_training.slice(0, 3).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-orange-800">
                      <span className="text-orange-600 font-bold mt-0.5">→</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Compliance Required */}
            {recommendations.recommendations?.compliance_required_modules && recommendations.recommendations.compliance_required_modules.length > 0 && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <h4 className="font-semibold text-red-900 mb-3">⚠️ Required Compliance Training</h4>
                <ul className="space-y-2">
                  {recommendations.recommendations.compliance_required_modules.slice(0, 3).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                      <span className="text-red-600 font-bold mt-0.5">!</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Advanced Modules */}
            {recommendations.recommendations?.advanced_modules && recommendations.recommendations.advanced_modules.length > 0 && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-900 mb-3">🚀 Advanced Modules</h4>
                <ul className="space-y-2">
                  {recommendations.recommendations.advanced_modules.slice(0, 3).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                      <span className="text-green-600 font-bold mt-0.5">⭐</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Learning Tips */}
            {recommendations.recommendations?.learning_tips && recommendations.recommendations.learning_tips.length > 0 && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-3">💡 Learning Tips</h4>
                <ul className="space-y-2">
                  {recommendations.recommendations.learning_tips.slice(0, 3).map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-blue-800">
                      <span className="text-blue-600 font-bold mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              onClick={() => setRecommendations(null)}
              variant="outline"
              className="w-full"
            >
              Clear Recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}