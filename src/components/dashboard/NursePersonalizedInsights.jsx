import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, AlertCircle, Clock, Target, Star, CheckCircle2, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import AIInsightFeedbackWidget from "../feedback/AIInsightFeedbackWidget";

export default function NursePersonalizedInsights({ 
  nurseEmail, 
  recentActivity, 
  noteConversions,
  trainingRecommendations,
  complianceAudits,
  pendingTasks 
}) {
  // Calculate insights
  const avgQualityScore = noteConversions?.length > 0
    ? (noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length).toFixed(0)
    : 0;

  const avgComplianceScore = noteConversions?.length > 0
    ? (noteConversions.reduce((sum, n) => sum + (n.enhanced_note_compliance || 0), 0) / noteConversions.length).toFixed(0)
    : 0;

  const criticalTraining = trainingRecommendations?.filter(t => t.severity === 'critical' && !t.addressed).length || 0;
  const highPriorityTasks = pendingTasks?.filter(t => t.priority === 'high').length || 0;

  const failedAudits = complianceAudits?.filter(a => a.status === 'critical' || a.status === 'flagged').length || 0;

  const [showFeedback, setShowFeedback] = useState(false);

  // Generate insight summary for feedback
  const insightSummary = `Performance: Quality ${avgQualityScore}%, Compliance ${avgComplianceScore}%. ${
    criticalTraining > 0 ? `${criticalTraining} critical training items. ` : ''
  }${highPriorityTasks > 0 ? `${highPriorityTasks} high priority tasks. ` : ''}${
    failedAudits > 0 ? `${failedAudits} flagged audits.` : ''
  }`;

  return (
    <Card className="border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="w-5 h-5 text-indigo-600" />
            Your Performance Insights
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowFeedback(!showFeedback)}
            className="gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            Feedback
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-lg p-3 border border-indigo-200">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <p className="text-xs text-gray-600">Avg Quality</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{avgQualityScore}%</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-indigo-200">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-blue-600" />
              <p className="text-xs text-gray-600">Avg Compliance</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{avgComplianceScore}%</p>
          </div>
        </div>

        {criticalTraining > 0 && (
          <Link to={createPageUrl("StaffTrainingHub")}>
            <Card className="bg-red-50 border-red-300 cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <p className="text-sm font-medium text-red-900">
                      {criticalTraining} Critical Training Item{criticalTraining > 1 ? 's' : ''}
                    </p>
                  </div>
                  <Badge className="bg-red-600">Action Needed</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {highPriorityTasks > 0 && (
          <Card className="bg-orange-50 border-orange-300">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-600" />
                  <p className="text-sm font-medium text-orange-900">
                    {highPriorityTasks} High Priority Task{highPriorityTasks > 1 ? 's' : ''}
                  </p>
                </div>
                <Badge className="bg-orange-600">Due Soon</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {failedAudits > 0 && (
          <Card className="bg-yellow-50 border-yellow-300">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-600" />
                  <p className="text-sm font-medium text-yellow-900">
                    {failedAudits} Flagged Audit{failedAudits > 1 ? 's' : ''}
                  </p>
                </div>
                <Badge className="bg-yellow-600">Review</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {criticalTraining === 0 && highPriorityTasks === 0 && failedAudits === 0 && (
          <div className="text-center py-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-900">You're all caught up! 🎉</p>
            <p className="text-xs text-gray-600">No urgent items requiring attention</p>
          </div>
        )}

        {/* AI Insight Feedback */}
        {showFeedback && (
          <div className="pt-3 border-t border-indigo-200">
            <AIInsightFeedbackWidget
              insightType="performance_insight"
              insightContent={insightSummary}
              onFeedbackSubmitted={() => setShowFeedback(false)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}