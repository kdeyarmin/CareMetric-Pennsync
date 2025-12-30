import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Target, TrendingDown, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DocumentationGapAnalysis({ 
  trainingRecommendations = [], 
  complianceAudits = [],
  onViewTraining
}) {
  // Analyze common gaps
  const gapAnalysis = React.useMemo(() => {
    const elementCounts = {};
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const sourceBreakdown = {};

    // Count issues from compliance audits
    complianceAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const element = issue.element || 'Unknown';
        elementCounts[element] = (elementCounts[element] || 0) + 1;
        severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
      });
    });

    // Count training recommendations by area
    trainingRecommendations.forEach(rec => {
      const type = rec.recommendation_type || 'general';
      sourceBreakdown[type] = (sourceBreakdown[type] || 0) + 1;
    });

    // Sort gaps by frequency
    const sortedGaps = Object.entries(elementCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      sortedGaps,
      severityCounts,
      sourceBreakdown,
      totalIssues: Object.values(elementCounts).reduce((sum, count) => sum + count, 0),
      totalRecommendations: trainingRecommendations.length
    };
  }, [trainingRecommendations, complianceAudits]);

  // Calculate improvement potential
  const improvementAreas = React.useMemo(() => {
    return gapAnalysis.sortedGaps.map(([element, count]) => {
      const percentage = Math.round((count / gapAnalysis.totalIssues) * 100);
      return {
        element,
        count,
        percentage,
        impact: count > 5 ? 'high' : count > 2 ? 'medium' : 'low'
      };
    });
  }, [gapAnalysis]);

  return (
    <div className="space-y-4">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-red-500 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 font-medium">Critical Issues</p>
                <p className="text-3xl font-bold text-red-900">{gapAnalysis.severityCounts.critical}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-600 font-medium">High Priority</p>
                <p className="text-3xl font-bold text-orange-900">{gapAnalysis.severityCounts.high}</p>
              </div>
              <Target className="w-10 h-10 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">Training Recs</p>
                <p className="text-3xl font-bold text-blue-900">{gapAnalysis.totalRecommendations}</p>
              </div>
              <Lightbulb className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Documentation Gaps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-600" />
            Most Common Documentation Gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {improvementAreas.length > 0 ? (
            improvementAreas.map((area, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={
                      area.impact === 'high' ? 'bg-red-600' :
                      area.impact === 'medium' ? 'bg-orange-600' :
                      'bg-yellow-600'
                    }>
                      #{idx + 1}
                    </Badge>
                    <p className="font-medium text-sm">{area.element}</p>
                  </div>
                  <span className="text-sm text-gray-600">{area.count} occurrences</span>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={area.percentage} className="flex-1" />
                  <span className="text-xs text-gray-500 w-12">{area.percentage}%</span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-600">No documentation gaps detected!</p>
              <p className="text-xs text-gray-500 mt-1">Keep up the excellent work</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations by Category */}
      {gapAnalysis.totalRecommendations > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-600" />
              Training Recommendations by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(gapAnalysis.sourceBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => (
                <div key={category} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                  <span className="text-sm font-medium capitalize">{category.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{count} recommendations</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onViewTraining?.(category)}
                      className="text-xs"
                    >
                      View Training
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Actionable Insights */}
      {improvementAreas.length > 0 && (
        <Alert className="bg-blue-50 border-blue-300">
          <Lightbulb className="w-5 h-5 text-blue-600" />
          <AlertDescription>
            <p className="font-semibold text-blue-900 mb-2">💡 Key Insight</p>
            <p className="text-sm text-blue-800">
              Focus on improving <strong>{improvementAreas[0].element}</strong> - it appears in {improvementAreas[0].percentage}% of your flagged documentation. 
              Targeted training in this area could significantly improve your compliance scores.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}