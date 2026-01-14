import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, Loader2, CheckCircle2 } from 'lucide-react';

export default function CarePlanOptimizer({ patientId }) {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [error, setError] = useState(null);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await base44.functions.invoke('optimizeCarePlan', {
        patientId
      });

      setRecommendations(response.data?.recommendations);
    } catch (err) {
      setError(err.message || 'Failed to optimize care plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-600" />
            AI Care Plan Optimizer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800">
              {error}
            </div>
          )}

          {!recommendations ? (
            <Button
              onClick={handleOptimize}
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Optimize Care Plan'
              )}
            </Button>
          ) : (
            <div className="space-y-6">
              {recommendations.care_plan_adjustments && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Care Plan Adjustments
                  </h3>
                  <div className="space-y-2">
                    {recommendations.care_plan_adjustments.map((adj, i) => (
                      <div key={i} className="bg-blue-50 border border-blue-200 rounded p-3">
                        <p className="text-sm text-gray-700">{adj}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recommendations.intervention_changes && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Intervention Changes</h3>
                  <div className="space-y-2">
                    {recommendations.intervention_changes.map((intervention, i) => (
                      <div key={i} className="bg-purple-50 border border-purple-200 rounded p-3">
                        <p className="text-sm text-gray-700">{intervention}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recommendations.risk_mitigation && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Risk Mitigation</h3>
                  <div className="space-y-2">
                    {recommendations.risk_mitigation.map((risk, i) => (
                      <div key={i} className="bg-orange-50 border border-orange-200 rounded p-3">
                        <p className="text-sm text-gray-700">{risk}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setRecommendations(null)}>
                  Analyze Again
                </Button>
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                  Implement Changes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}