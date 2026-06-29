import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Eye } from "lucide-react";
import { format } from "date-fns";

export default function TemplateVersionHistory({ parentTemplateId }) {
  const { data: versions = [] } = useQuery({
    queryKey: ['template-versions', parentTemplateId],
    queryFn: () => base44.entities.PDFTemplate.filter({ parent_template_id: parentTemplateId }, '-created_date'),
    initialData: [],
    enabled: !!parentTemplateId
  });

  if (!versions.length) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-slate-500">
          <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No version history yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5" />
          Version History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions.map((version) => (
          <div key={version.id} className="p-3 border rounded-lg hover:bg-slate-50">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge>v{version.version}</Badge>
                  <span className="text-xs text-slate-500">
                    {format(new Date(version.created_date), 'MMM dd, yyyy')}
                  </span>
                </div>
                {version.change_notes && (
                  <p className="text-sm text-slate-600 mt-2">{version.change_notes}</p>
                )}
                <p className="text-xs text-slate-500 mt-2">
                  Used {version.usage_count || 0} times
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(version.template_file_url, '_blank')}
              >
                <Eye className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}