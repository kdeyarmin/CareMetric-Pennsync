import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  TrendingUp,
  Clock,
  BookOpen,
  ChevronRight,
  RefreshCw,
  Loader2
} from "lucide-react";
import { trainingModuleMap } from "./RecommendationTracker";

export default function NurseTrainingSuggestions({ nurseEmail, compact = false }) {
  const [suggestedModules, setSuggestedModules] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['nurseRecommendations', nurseEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter(
      { nurse_email: nurseEmail },
      '-created_date',
      100
    ),
    enabled: !!nurseEmail,
  });

  const analyzeAndSuggest = useCallback(async () => {
    if (recommendations.length === 0) return;
    
    setIsAnalyzing(true);

    // Count recommendations by type
    const typeCounts = {};
    const unaddressedByType = {};
    
    recommendations.forEach(rec => {
      typeCounts[rec.recommendation_type] = (typeCounts[rec.recommendation_type] || 0) + 1;
      if (!rec.addressed) {
        unaddressedByType[rec.recommendation_type] = (unaddressedByType[rec.recommendation_type] || 0) + 1;
      }
    });

    // Sort types by frequency (prioritize unaddressed)
    const sortedTypes = Object.entries(typeCounts)
      .map(([type, count]) => ({
        type,
        total: count,
        unaddressed: unaddressedByType[type] || 0,
        score: (unaddressedByType[type] || 0) * 2 + count
      }))
      .sort((a, b) => b.score - a.score);

    // Get top training modules based on recommendation patterns
    const modules = [];
    const addedTitles = new Set();

    sortedTypes.forEach(({ type, total, unaddressed }) => {
      const typeModules = trainingModuleMap[type] || [];
      typeModules.forEach(module => {
        if (!addedTitles.has(module.title)) {
          modules.push({
            ...module,
            category: type,
            relevanceScore: Math.min(100, Math.round((unaddressed * 15 + total * 5))),
            recommendationCount: total,
            unaddressedCount: unaddressed
          });
          addedTitles.add(module.title);
        }
      });
    });

    // Sort by relevance and take top modules
    const sorted = modules
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, compact ? 3 : 8);

    setSuggestedModules(sorted);
    setIsAnalyzing(false);
  }, [recommendations, compact]);

  useEffect(() => {
    if (recommendations.length > 0) {
      analyzeAndSuggest();
    }
  }, [recommendations, analyzeAndSuggest]);

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      documentation: 'bg-navy-100 text-navy-800',
      compliance: 'bg-orange-100 text-orange-800',
      clinical: 'bg-blue-100 text-blue-800',
      safety: 'bg-red-100 text-red-800',
      communication: 'bg-green-100 text-green-800',
      technology: 'bg-indigo-100 text-indigo-800'
    };
    return colors[category] || 'bg-slate-100 text-slate-800';
  };

  // Summary stats
  const totalRecs = recommendations.length;
  const unaddressedRecs = recommendations.filter(r => !r.addressed).length;
  const topCategory = Object.entries(
    recommendations.reduce((acc, r) => {
      acc[r.recommendation_type] = (acc[r.recommendation_type] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])[0];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" />
          <p className="text-sm text-slate-500 mt-2">Loading recommendations...</p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-navy-50">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              Suggested Training
            </div>
            {unaddressedRecs > 0 && (
              <Badge className="bg-orange-100 text-orange-800">{unaddressedRecs} gaps</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 space-y-2">
          {suggestedModules.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">No training suggestions yet</p>
          ) : (
            suggestedModules.slice(0, 3).map((module, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-medium truncate max-w-[150px]">{module.title}</span>
                </div>
                <Badge className={`${getPriorityColor(module.priority)} text-xs`}>
                  {module.relevanceScore}%
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-600" />
            Personalized Training Suggestions
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={analyzeAndSuggest}
            disabled={isAnalyzing}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isAnalyzing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold text-blue-700">{totalRecs}</p>
            <p className="text-xs text-slate-600">Total Recommendations</p>
          </div>
          <div className="bg-orange-50 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold text-orange-700">{unaddressedRecs}</p>
            <p className="text-xs text-slate-600">Unaddressed</p>
          </div>
          <div className="bg-navy-50 p-3 rounded-lg text-center">
            <p className="text-lg font-bold text-navy-700 capitalize">{topCategory?.[0] || '—'}</p>
            <p className="text-xs text-slate-600">Top Area</p>
          </div>
        </div>

        {/* Suggested Modules */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Recommended Training Modules</h3>
          {suggestedModules.length === 0 ? (
            <div className="text-center py-6 bg-slate-50 rounded-lg">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No training suggestions yet</p>
              <p className="text-xs text-slate-400">Recommendations will appear as you use the system</p>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestedModules.map((module, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-white border rounded-lg hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{module.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={getCategoryColor(module.category)} variant="outline">
                          {module.category}
                        </Badge>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {module.duration} min
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-indigo-500" />
                        <span className="text-sm font-semibold text-indigo-600">{module.relevanceScore}%</span>
                      </div>
                      <p className="text-xs text-slate-500">{module.recommendationCount} recs</p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={createPageUrl('NurseTrainingHub')}>
                        Start <ChevronRight className="w-4 h-4 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommendation Breakdown */}
        {totalRecs > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Skill Gap Analysis</h3>
            <div className="space-y-2">
              {Object.entries(
                recommendations.reduce((acc, r) => {
                  acc[r.recommendation_type] = (acc[r.recommendation_type] || 0) + 1;
                  return acc;
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-xs font-medium capitalize w-24">{type}</span>
                    <Progress value={(count / totalRecs) * 100} className="flex-1 h-2" />
                    <span className="text-xs text-slate-500 w-8">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}