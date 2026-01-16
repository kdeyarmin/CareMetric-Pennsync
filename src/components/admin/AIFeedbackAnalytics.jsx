import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lightbulb, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

export default function AIFeedbackAnalytics() {
  const { data: feedbackData = [] } = useQuery({
    queryKey: ['aiFeedback'],
    queryFn: () => base44.entities.AIFeedback.filter({ is_processed: false })
  });

  const processAllFeedback = async () => {
    try {
      await base44.functions.invoke('processAIFeedback', {});
      toast.success('Feedback analysis completed');
    } catch (error) {
      toast.error('Failed to process feedback');
    }
  };

  // Analyze feedback patterns
  const analysis = {
    by_type: {},
    by_action: {},
    avg_ratings: {}
  };

  feedbackData.forEach(feedback => {
    // By type
    if (!analysis.by_type[feedback.ai_suggestion_type]) {
      analysis.by_type[feedback.ai_suggestion_type] = 0;
    }
    analysis.by_type[feedback.ai_suggestion_type]++;

    // By action
    if (!analysis.by_action[feedback.user_action]) {
      analysis.by_action[feedback.user_action] = 0;
    }
    analysis.by_action[feedback.user_action]++;

    // Ratings
    if (!analysis.avg_ratings[feedback.ai_suggestion_type]) {
      analysis.avg_ratings[feedback.ai_suggestion_type] = {
        helpful: [],
        accuracy: []
      };
    }
    if (feedback.helpful_rating) {
      analysis.avg_ratings[feedback.ai_suggestion_type].helpful.push(feedback.helpful_rating);
    }
    if (feedback.accuracy_rating) {
      analysis.avg_ratings[feedback.ai_suggestion_type].accuracy.push(feedback.accuracy_rating);
    }
  });

  // Calculate averages
  Object.keys(analysis.avg_ratings).forEach(type => {
    const helpful = analysis.avg_ratings[type].helpful;
    const accuracy = analysis.avg_ratings[type].accuracy;
    analysis.avg_ratings[type] = {
      helpful: helpful.length > 0 ? (helpful.reduce((a, b) => a + b) / helpful.length).toFixed(2) : null,
      accuracy: accuracy.length > 0 ? (accuracy.reduce((a, b) => a + b) / accuracy.length).toFixed(2) : null
    };
  });

  const chartData = Object.entries(analysis.by_type).map(([type, count]) => ({
    name: type,
    count,
    helpful: analysis.avg_ratings[type]?.helpful || 0,
    accuracy: analysis.avg_ratings[type]?.accuracy || 0
  }));

  const actionData = Object.entries(analysis.by_action).map(([action, count]) => ({
    name: action,
    count
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-bold">AI Feedback Analytics</h2>
        </div>
        <Button onClick={processAllFeedback} className="bg-blue-600 hover:bg-blue-700">
          <TrendingUp className="w-4 h-4 mr-2" />
          Analyze & Process Feedback
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Total Feedback: {feedbackData.length}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#3b82f6" name="Feedback Count" />
              <Bar dataKey="helpful" fill="#10b981" name="Avg Helpful Rating" />
              <Bar dataKey="accuracy" fill="#f59e0b" name="Avg Accuracy Rating" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">User Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={actionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Quality Metrics by Suggestion Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(analysis.avg_ratings).map(([type, ratings]) => (
              <div key={type} className="flex items-center justify-between p-2 border rounded">
                <span className="font-medium text-sm">{type}</span>
                <div className="flex gap-2">
                  <Badge variant="outline">
                    Helpful: {ratings.helpful || 'N/A'}
                  </Badge>
                  <Badge variant="outline">
                    Accuracy: {ratings.accuracy || 'N/A'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}