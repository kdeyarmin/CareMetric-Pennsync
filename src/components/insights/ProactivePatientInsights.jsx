import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  Lightbulb,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ProactivePatientInsights({ patientId, patientName }) {
  const [refreshing, setRefreshing] = useState(false);

  const { data: insights, isLoading, refetch } = useQuery({
    queryKey: ['proactiveInsights', patientId],
    queryFn: async () => {
      const response = await base44.functions.invoke('generateProactiveInsights', {
        patient_id: patientId
      });
      return response.data;
    },
    enabled: !!patientId,
    staleTime: 300000 // Cache for 5 minutes
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      toast.success('Insights refreshed');
    } catch (error) {
      toast.error('Failed to refresh insights');
    } finally {
      setRefreshing(false);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-600 text-white',
      medium: 'bg-yellow-600 text-white',
      low: 'bg-blue-600 text-white'
    };
    return colors[severity] || colors.medium;
  };

  const getTrendIcon = (direction) => {
    if (direction === 'improving') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (direction === 'worsening') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <CheckCircle2 className="w-4 h-4 text-gray-600" />;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-600">Analyzing patient data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!insights?.insights) return null;

  const data = insights.insights;

  return (
    <div className="space-y-4">
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-blue-600" />
              Proactive Clinical Insights - {patientName}
            </CardTitle>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Risk Flags */}
          {data.risk_flags?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                Risk Alerts ({data.risk_flags.length})
              </h3>
              <div className="space-y-3">
                {data.risk_flags.map((risk, idx) => (
                  <div key={idx} className="border-l-4 border-orange-500 bg-orange-50 dark:bg-orange-900 p-3 rounded">
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-medium">{risk.description}</span>
                      <Badge className={getSeverityColor(risk.severity)}>
                        {risk.severity}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 space-y-2">
                      <div>
                        <strong>Indicators:</strong>
                        <ul className="list-disc list-inside ml-2">
                          {risk.indicators.map((ind, i) => (
                            <li key={i}>{ind}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Recommended Actions:</strong>
                        <ul className="list-disc list-inside ml-2">
                          {risk.recommended_actions.map((action, i) => (
                            <li key={i}>{action}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending Concerns */}
          {data.trending_concerns?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Trending Patterns
              </h3>
              <div className="space-y-2">
                {data.trending_concerns.map((trend, idx) => (
                  <div key={idx} className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      {getTrendIcon(trend.trend_direction)}
                      <span className="font-medium text-sm">{trend.concern}</span>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">
                      {trend.clinical_significance}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visit Preparation */}
          {data.visit_preparation && (
            <div className="bg-white dark:bg-slate-900 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-600" />
                Pre-Visit Preparation
              </h3>
              <div className="space-y-3 text-sm">
                {data.visit_preparation.key_assessment_areas?.length > 0 && (
                  <div>
                    <strong className="text-purple-700">Focus Assessment On:</strong>
                    <ul className="list-disc list-inside ml-2 mt-1">
                      {data.visit_preparation.key_assessment_areas.map((area, i) => (
                        <li key={i}>{area}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.visit_preparation.suggested_discussion_points?.length > 0 && (
                  <div>
                    <strong className="text-purple-700">Discussion Points:</strong>
                    <ul className="list-disc list-inside ml-2 mt-1">
                      {data.visit_preparation.suggested_discussion_points.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preventive Opportunities */}
          {data.preventive_opportunities?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-green-600" />
                Preventive Opportunities
              </h3>
              <div className="space-y-2">
                {data.preventive_opportunities.map((opp, idx) => (
                  <div key={idx} className="bg-green-50 dark:bg-green-900 p-3 rounded text-sm">
                    <p className="font-medium text-green-900 dark:text-green-100">{opp.opportunity}</p>
                    <p className="text-xs text-green-700 dark:text-green-300">
                      Expected benefit: {opp.benefit}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}