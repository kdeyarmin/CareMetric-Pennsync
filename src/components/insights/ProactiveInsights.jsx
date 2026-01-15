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
        return response?.data?.insights || [];
      } catch (err) {
        console.error('Failed to fetch insights:', err);
        return [];
      }
    },
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  if (isLoading) {
    return <SkeletonCard className="mb-6" />;
  }

  if (!insights?.length) return null;

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