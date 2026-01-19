import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThumbsUp, ThumbsDown, TrendingUp, BarChart3, MessageSquare } from "lucide-react";

export default function AIFeedbackAnalytics() {
  const { data: feedback = [] } = useQuery({
    queryKey: ['aiFeedback'],
    queryFn: () => base44.entities.AIFeedback.list('-created_date', 500)
  });

  const stats = {
    total: feedback.length,
    positive: feedback.filter(f => f.helpful_rating >= 4).length,
    negative: feedback.filter(f => f.helpful_rating <= 2).length,
    withComments: feedback.filter(f => f.feedback_text).length,
    accepted: feedback.filter(f => f.user_action === 'accepted').length,
    rejected: feedback.filter(f => f.user_action === 'rejected').length
  };

  const positiveRate = stats.total > 0 ? ((stats.positive / stats.total) * 100).toFixed(1) : 0;

  const byType = feedback.reduce((acc, f) => {
    acc[f.ai_suggestion_type] = (acc[f.ai_suggestion_type] || 0) + 1;
    return acc;
  }, {});

  const avgRatingByType = {};
  Object.keys(byType).forEach(type => {
    const typeFeedback = feedback.filter(f => f.ai_suggestion_type === type);
    const avg = typeFeedback.reduce((sum, f) => sum + (f.helpful_rating || 0), 0) / typeFeedback.length;
    avgRatingByType[type] = avg.toFixed(1);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-600" />
          AI Feedback Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Feedback</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">Positive Rate</p>
            <p className="text-2xl font-bold text-green-600">{positiveRate}%</p>
          </div>
          <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">Accepted</p>
            <p className="text-2xl font-bold text-purple-600">{stats.accepted}</p>
          </div>
          <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">With Comments</p>
            <p className="text-2xl font-bold text-amber-600">{stats.withComments}</p>
          </div>
        </div>

        <Tabs defaultValue="byType">
          <TabsList>
            <TabsTrigger value="byType">By Type</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>

          <TabsContent value="byType" className="space-y-3">
            <h3 className="text-sm font-semibold">Feedback by AI Feature</h3>
            {Object.entries(byType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium capitalize">
                    {type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-gray-500">{count} responses</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                    Avg: {avgRatingByType[type]}/5
                  </Badge>
                  <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                    <div
                      className="h-2 bg-green-500 rounded-full"
                      style={{ width: `${(avgRatingByType[type] / 5) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="recent" className="space-y-3">
            {feedback.slice(0, 10).map((item, idx) => (
              <Card key={idx} className="border-l-4 border-l-purple-500">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <Badge variant="outline" className="text-xs mb-1">
                        {item.ai_suggestion_type.replace(/_/g, ' ')}
                      </Badge>
                      <p className="text-xs text-gray-500">{item.user_email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {item.helpful_rating >= 4 ? (
                        <ThumbsUp className="w-4 h-4 text-green-600" />
                      ) : item.helpful_rating <= 2 ? (
                        <ThumbsDown className="w-4 h-4 text-red-600" />
                      ) : null}
                      <span className="text-sm font-semibold">{item.helpful_rating}/5</span>
                    </div>
                  </div>
                  {item.feedback_text && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                      "{item.feedback_text}"
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Badge className={
                      item.user_action === 'accepted' ? 'bg-green-100 text-green-800' :
                      item.user_action === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }>
                      {item.user_action}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}