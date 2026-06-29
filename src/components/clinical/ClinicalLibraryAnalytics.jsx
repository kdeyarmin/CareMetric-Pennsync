import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Users, Calendar } from "lucide-react";

export default function ClinicalLibraryAnalytics() {
  const { data: templates = [] } = useQuery({
    queryKey: ['clinical-templates'],
    queryFn: () => base44.entities.ClinicalLibraryTemplate.list('-usage_count', 200),
    initialData: []
  });

  const analytics = useMemo(() => {
    const topTemplates = templates
      .filter(t => t.usage_count > 0)
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, 10);

    const byCategory = templates.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + (t.usage_count || 0);
      return acc;
    }, {});

    const byType = templates.reduce((acc, t) => {
      acc[t.template_type] = (acc[t.template_type] || 0) + (t.usage_count || 0);
      return acc;
    }, {});

    const byCreator = templates.reduce((acc, t) => {
      const creator = t.created_by || 'Unknown';
      if (!acc[creator]) {
        acc[creator] = { count: 0, usage: 0 };
      }
      acc[creator].count += 1;
      acc[creator].usage += t.usage_count || 0;
      return acc;
    }, {});

    return {
      topTemplates,
      byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
      byType: Object.entries(byType),
      byCreator: Object.entries(byCreator)
        .sort((a, b) => b[1].usage - a[1].usage)
        .slice(0, 5),
      totalUsage: templates.reduce((sum, t) => sum + (t.usage_count || 0), 0),
      activeTemplates: templates.filter(t => t.is_active).length,
      totalTemplates: templates.length
    };
  }, [templates]);

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600 mb-1">Total Usage</p>
                <p className="text-2xl font-bold text-indigo-600">{analytics.totalUsage}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600 mb-1">Active Templates</p>
                <p className="text-2xl font-bold text-green-600">{analytics.activeTemplates}</p>
              </div>
              <BarChart3 className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600 mb-1">Total Templates</p>
                <p className="text-2xl font-bold text-navy-600">{analytics.totalTemplates}</p>
              </div>
              <Calendar className="w-8 h-8 text-navy-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Most Used Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {analytics.topTemplates.map((template, idx) => (
              <div key={template.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Badge className="bg-indigo-600 text-white shrink-0">#{idx + 1}</Badge>
                  <div className="min-w-0 flex-1">
                    <code className="text-sm font-mono text-slate-900 truncate block">
                      {template.phrase}
                    </code>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{template.category}</Badge>
                      <Badge variant="outline" className="text-xs">{template.template_type}</Badge>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-lg font-bold text-indigo-600">{template.usage_count}</p>
                  <p className="text-xs text-slate-500">uses</p>
                </div>
              </div>
            ))}
            {analytics.topTemplates.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No usage data yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Usage by Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Usage by Category
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {analytics.byCategory.map(([category, count]) => (
              <div key={category} className="flex items-center gap-3">
                <p className="text-sm font-medium w-32 capitalize">{category.replace('_', ' ')}</p>
                <div className="flex-1 bg-slate-200 rounded-full h-6 relative">
                  <div
                    className="bg-indigo-600 h-6 rounded-full flex items-center justify-end pr-2"
                    style={{ width: `${analytics.totalUsage > 0 ? (count / analytics.totalUsage) * 100 : 0}%` }}
                  >
                    <span className="text-xs text-white font-medium">{count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Contributors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Top Contributors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {analytics.byCreator.map(([email, data]) => (
              <div key={email} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-slate-900">{email}</p>
                  <p className="text-xs text-slate-600">{data.count} templates created</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-navy-600">{data.usage}</p>
                  <p className="text-xs text-slate-500">total uses</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}