import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  TrendingUp, 
  FileText, 
  MessageSquare,
  Zap,
  CheckCircle2,
  Settings
} from 'lucide-react';

export default function AdaptiveLearningDashboard({ userEmail }) {
  const { data: learnedPatterns = [] } = useQuery({
    queryKey: ['learnedPatterns', userEmail],
    queryFn: async () => {
      const patterns = await base44.entities.LearnedFormatPattern.filter({ user_email: userEmail });
      return patterns.sort((a, b) => b.confidence_score - a.confidence_score).slice(0, 10);
    },
    enabled: !!userEmail
  });

  const { data: conversionStats } = useQuery({
    queryKey: ['conversionStats', userEmail],
    queryFn: async () => {
      const conversions = await base44.entities.NoteConversion.filter({ nurse_email: userEmail });
      const total = conversions.length;
      const avgQuality = conversions.reduce((sum, c) => sum + (c.quality_score || 0), 0) / total;
      const avgCompliance = conversions.reduce((sum, c) => sum + (c.enhanced_note_compliance || 0), 0) / total;
      
      return {
        total_notes: total,
        avg_quality_score: avgQuality,
        avg_compliance_score: avgCompliance,
        learning_progress: Math.min(100, (total / 50) * 100)
      };
    },
    enabled: !!userEmail,
    initialData: { total_notes: 0, avg_quality_score: 0, avg_compliance_score: 0, learning_progress: 0 }
  });

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'structure': return <FileText className="w-4 h-4" />;
      case 'terminology': return <MessageSquare className="w-4 h-4" />;
      case 'style': return <Zap className="w-4 h-4" />;
      default: return <Brain className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            AI Learning Your Style
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">Learning Progress</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {conversionStats.total_notes}/50 notes analyzed
              </span>
            </div>
            <Progress value={conversionStats.learning_progress} className="h-2" />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              {conversionStats.learning_progress < 100 
                ? `${50 - conversionStats.total_notes} more notes to fully learn your style`
                : 'Fully learned your documentation style! ✨'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 p-3 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Avg Quality Score</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {conversionStats.avg_quality_score.toFixed(0)}%
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 p-3 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Avg Compliance</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {conversionStats.avg_compliance_score.toFixed(0)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Learned Patterns</CardTitle>
            <Badge variant="secondary">{learnedPatterns.length} patterns</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {learnedPatterns.length > 0 ? (
            <div className="space-y-3">
              {learnedPatterns.map((pattern, idx) => (
                <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(pattern.pattern_category)}
                      <span className="font-semibold text-sm capitalize">{pattern.pattern_category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={pattern.confidence_score * 100} 
                        className="w-20 h-2"
                      />
                      <span className="text-xs text-gray-500">
                        {Math.round(pattern.confidence_score * 100)}%
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                    {pattern.pattern_description}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <CheckCircle2 className="w-3 h-3" />
                    Applied {pattern.usage_count} times
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Brain className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Complete a few more notes for AI to learn your unique style
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-purple-200 dark:border-purple-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">How It Works</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As you create notes, our AI learns your preferred terminology, structure, 
                and documentation style. Future notes will automatically match your unique 
                voice while maintaining compliance standards.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}