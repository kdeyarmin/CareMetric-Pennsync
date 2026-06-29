import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { GraduationCap, BookOpen, Brain, CheckCircle2 } from "lucide-react";

export default function TrainingProgressChart({ 
  trainingCompletions = [],
  microLearningProgress = [],
  recommendations = [],
  compact = false 
}) {
  // Calculate completion rates by category
  const completionByCategory = {};
  trainingCompletions.forEach(tc => {
    if (!completionByCategory[tc.training_module_id]) {
      completionByCategory[tc.training_module_id] = { completed: 0, total: 0 };
    }
    completionByCategory[tc.training_module_id].total++;
    if (tc.status === 'completed') {
      completionByCategory[tc.training_module_id].completed++;
    }
  });

  // Prepare chart data for training modules
  const moduleData = Object.entries(completionByCategory).map(([moduleId, data]) => ({
    module: moduleId.substring(0, 20),
    completionRate: Math.round((data.completed / data.total) * 100),
    completed: data.completed,
    total: data.total
  })).slice(0, 6);

  // Micro-learning progress over time
  const microLearningData = microLearningProgress
    .filter(ml => ml.status === 'completed')
    .reduce((acc, ml) => {
      const date = new Date(ml.created_date).toISOString().split('T')[0];
      if (!acc[date]) acc[date] = 0;
      acc[date]++;
      return acc;
    }, {});

  const microLearningChartData = Object.entries(microLearningData)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-14); // Last 14 days

  // Quiz scores over time
  const quizData = trainingCompletions
    .filter(tc => tc.score !== null && tc.score !== undefined)
    .sort((a, b) => new Date(a.completion_date) - new Date(b.completion_date))
    .slice(-10)
    .map(tc => ({
      date: new Date(tc.completion_date).toLocaleDateString(),
      score: tc.score,
      module: tc.training_module_id?.substring(0, 15) || 'Quiz'
    }));

  const avgScore = quizData.length > 0 
    ? Math.round(quizData.reduce((sum, q) => sum + q.score, 0) / quizData.length)
    : 0;

  const completedCount = trainingCompletions.filter(tc => tc.status === 'completed').length;
  const totalAssigned = trainingCompletions.length;
  const overallProgress = totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-4 h-4 text-blue-600" />
              <p className="text-xs text-slate-600">Modules Completed</p>
            </div>
            <p className="text-2xl font-bold">{completedCount}/{totalAssigned}</p>
            <Progress value={overallProgress} className="h-1.5 mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-navy-600" />
              <p className="text-xs text-slate-600">Avg Quiz Score</p>
            </div>
            <p className="text-2xl font-bold">{avgScore}%</p>
            <Progress value={avgScore} className="h-1.5 mt-2 [&>div]:bg-navy-500" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-green-600" />
              <p className="text-xs text-slate-600">Micro-Lessons</p>
            </div>
            <p className="text-2xl font-bold">{microLearningProgress.filter(ml => ml.status === 'completed').length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
              <p className="text-xs text-slate-600">Open Tasks</p>
            </div>
            <p className="text-2xl font-bold">{recommendations.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Training Module Completion Rates */}
      {moduleData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Training Module Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={compact ? 200 : 250}>
              <BarChart data={moduleData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="module" fontSize={12} angle={-45} textAnchor="end" height={80} />
                <YAxis fontSize={12} label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Bar dataKey="completionRate" fill="#3557b0" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quiz Scores Over Time */}
        {quizData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quiz Performance Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={compact ? 180 : 220}>
                <LineChart data={quizData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Micro-Learning Activity */}
        {microLearningChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Daily Learning Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={compact ? 180 : 220}>
                <BarChart data={microLearningChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#22c55e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}