import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";

const COLORS = ['#ef4444', '#f59e0b', '#3557b0', '#22c55e', '#8b5cf6'];

export default function DocumentationGapsReport({ oasisData = [], noteData = [], compact = false }) {
  // Analyze OASIS accuracy issues
  const commonIssues = useMemo(() => {
    const issues = {};
    
    oasisData.forEach(item => {
      const accuracyIssues = item.analysis_results?.accuracy_issues || [];
      accuracyIssues.forEach(issue => {
        const category = issue.item?.match(/M\d{4}/)?.[0] || 'Other';
        if (!issues[category]) {
          issues[category] = { category, count: 0, highSeverity: 0 };
        }
        issues[category].count++;
        if (issue.severity === 'high') issues[category].highSeverity++;
      });
    });

    return Object.values(issues)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [oasisData]);

  // Gap categories
  const gapCategories = useMemo(() => {
    const categories = {
      'Functional Status': 0,
      'Clinical Assessment': 0,
      'Diagnosis Coding': 0,
      'Skilled Need': 0,
      'Safety/Risk': 0
    };

    oasisData.forEach(item => {
      const issues = item.analysis_results?.accuracy_issues || [];
      issues.forEach(issue => {
        const item_code = issue.item || '';
        if (item_code.match(/M18[0-6]/)) categories['Functional Status']++;
        else if (item_code.match(/M1[2-6]/)) categories['Clinical Assessment']++;
        else if (item_code.match(/M102/)) categories['Diagnosis Coding']++;
        else if (issue.recommendation?.toLowerCase().includes('skilled')) categories['Skilled Need']++;
        else categories['Safety/Risk']++;
      });
    });

    return Object.entries(categories)
      .map(([name, value]) => ({ name, value }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [oasisData]);

  // Note quality issues
  const noteIssues = useMemo(() => {
    let lowQuality = 0;
    let _missingVitals = 0;
    let shortNotes = 0;

    noteData.forEach(note => {
      if ((note.quality_score || 0) < 70) lowQuality++;
      if ((note.rough_note_length || 0) < 100) shortNotes++;
    });

    return [
      { issue: 'Low Quality Score (<70%)', count: lowQuality },
      { issue: 'Very Short Notes (<100 chars)', count: shortNotes }
    ].filter(i => i.count > 0);
  }, [noteData]);

  const totalGaps = commonIssues.reduce((s, i) => s + i.count, 0);

  return (
    <Card className={compact ? "" : "col-span-full"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Documentation Gaps Report
          </div>
          {totalGaps > 0 && (
            <Badge className="bg-orange-100 text-orange-800">
              {totalGaps} issues identified
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {oasisData.length === 0 && noteData.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No documentation data available</p>
        ) : (
          <div className={compact ? "" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
            {/* Common OASIS issues chart */}
            <div className={compact ? "" : "lg:col-span-2"}>
              <p className="text-sm font-medium text-slate-700 mb-3">Most Common OASIS Issues</p>
              {commonIssues.length > 0 ? (
                <ResponsiveContainer width="100%" height={compact ? 180 : 250}>
                  <BarChart data={commonIssues} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={60} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#f59e0b" name="Total Issues" />
                    <Bar dataKey="highSeverity" fill="#ef4444" name="High Severity" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-slate-500 py-8">No OASIS issues found</p>
              )}
            </div>

            {/* Gap categories pie */}
            {!compact && gapCategories.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-3">Gap Categories</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={gapCategories}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={({ _name, percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {gapCategories.map((entry, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {gapCategories.map((cat, idx) => (
                    <Badge key={cat.name} variant="outline" className="text-xs" style={{ borderColor: COLORS[idx % COLORS.length] }}>
                      {cat.name}: {cat.value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Note quality issues */}
            {!compact && noteIssues.length > 0 && (
              <div className="lg:col-span-3 pt-4 border-t">
                <p className="text-sm font-medium text-slate-700 mb-3">Smart Note Quality Issues</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {noteIssues.map((issue, idx) => (
                    <div key={idx} className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-xl font-bold text-red-900">{issue.count}</p>
                      <p className="text-xs text-red-700">{issue.issue}</p>
                    </div>
                  ))}
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-xl font-bold text-green-900">
                      {noteData.length - noteIssues.reduce((s, i) => s + i.count, 0)}
                    </p>
                    <p className="text-xs text-green-700">Quality Notes</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}