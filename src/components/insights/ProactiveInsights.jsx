import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, TrendingUp, Brain, Heart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { SkeletonCard } from '@/components/ui/LoadingSkeleton';

export default function ProactiveInsights({ userEmail }) {
  const { data: insights, isLoading, error } = useQuery({
    queryKey: ['proactiveInsights', userEmail],
    queryFn: async () => {
      try {
        const response = await base44.functions.invoke('generateProactiveInsights', {
          user_email: userEmail
        });
        const result = response?.data?.insights || response?.insights;
        
        // Return empty array if no meaningful insights
        if (!result || !result.trending_concerns || result.trending_concerns.length === 0) {
          return [];
        }
        
        // Convert insights to display format
        const displayInsights = [];
        
        if (result.risk_flags?.length > 0) {
          displayInsights.push(...result.risk_flags.map(risk => ({
            type: 'warning',
            title: risk.risk_type,
            description: risk.description
          })));
        }
        
        if (result.trending_concerns?.length > 0) {
          displayInsights.push(...result.trending_concerns.slice(0, 2).map(concern => ({
            type: 'trending',
            title: concern.concern,
            description: concern.clinical_significance
          })));
        }
        
        return displayInsights.slice(0, 3);
      } catch (err) {
        console.error('Failed to fetch insights:', err);
        return [];
      }
    },
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  if (isLoading) {
    return null; // Don't show skeleton, just hide while loading
  }

  if (!insights || insights.length === 0) return null;

  const getIcon = (type) => {
    switch (type) {
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-orange-500" />;
      case 'trending':
        return <TrendingUp className="w-5 h-5 text-blue-500" />;
      case 'clinical':
        return <Heart className="w-5 h-5 text-red-500" />;
      default:
        return <Brain className="w-5 h-5 text-purple-500" />;
    }
  };

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
        AI Insights
      </h3>
      <div className="space-y-3">
        {insights.slice(0, 3).map((insight, idx) => (
          <Card key={idx} className="border-l-4 border-l-blue-500">
            <CardContent className="pt-6 flex gap-4">
              <div className="flex-shrink-0">
                {getIcon(insight.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">
                  {insight.title}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {insight.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}