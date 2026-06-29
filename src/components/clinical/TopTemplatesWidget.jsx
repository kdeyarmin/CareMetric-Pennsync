import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TopTemplatesWidget() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['clinical-templates-top'],
    queryFn: () => base44.entities.ClinicalLibraryTemplate.list('-usage_count', 5),
    initialData: []
  });

  const topTemplates = templates.filter(t => t.usage_count > 0).slice(0, 5);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="text-sm sm:text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-navy-600" />
          Top Clinical Phrases
        </CardTitle>
      </CardHeader>
      <CardContent>
        {topTemplates.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <p className="text-sm">No templates used yet</p>
            <Link to={createPageUrl("ResourceLibrary")} className="text-xs text-navy-600 hover:underline mt-2 block">
              Create your first template
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {topTemplates.map((template, idx) => (
              <div key={template.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                <Badge className="bg-navy-600 text-white shrink-0 text-xs">{idx + 1}</Badge>
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-slate-900 truncate block">
                    {template.phrase}
                  </code>
                  <p className="text-[10px] text-slate-500 capitalize">{template.category}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <TrendingUp className="w-3 h-3 text-slate-400" />
                  <span className="text-xs font-semibold text-navy-600">{template.usage_count}</span>
                </div>
              </div>
            ))}
            <Link to={createPageUrl("ResourceLibrary")}>
              <button className="w-full mt-2 text-xs text-navy-600 hover:text-navy-700 font-medium py-2 hover:bg-navy-50 rounded transition-colors">
                View All Templates →
              </button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}