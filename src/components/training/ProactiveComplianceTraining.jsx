import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { BookOpen, AlertTriangle, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ProactiveComplianceTraining({ userEmail }) {
  const [generating, setGenerating] = useState(false);

  const { data: violations = [] } = useQuery({
    queryKey: ["userViolations", userEmail],
    queryFn: () => base44.entities.ComplianceViolation.filter({ user_email: userEmail, status: "open" }),
    enabled: !!userEmail,
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ["trainingRecs", userEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: userEmail, addressed: false }),
    enabled: !!userEmail,
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  // Group violations by category to identify patterns
  const violationPatterns = violations.reduce((acc, v) => {
    const cat = v.rule_category || v.rule_name || "General";
    if (!acc[cat]) acc[cat] = { count: 0, severity: "low", examples: [] };
    acc[cat].count++;
    if (v.severity === "critical" || v.severity === "high") acc[cat].severity = v.severity;
    if (acc[cat].examples.length < 2) acc[cat].examples.push(v.violation_description);
    return acc;
  }, {});

  const topPatterns = Object.entries(violationPatterns)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 3);

  const generateTraining = async () => {
    setGenerating(true);
    try {
      const prompt = `Based on these compliance patterns, suggest 3 micro-learning topics:
${topPatterns.map(([cat, data]) => `- ${cat}: ${data.count} issues (${data.severity}). Examples: ${data.examples.join("; ")}`).join("\n")}
Return specific training module suggestions.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  description: { type: "string" },
                  estimated_minutes: { type: "number" },
                  priority: { type: "string" },
                },
              },
            },
          },
        },
      });

      for (const s of (result.suggestions || []).slice(0, 3)) {
        await base44.entities.TrainingRecommendation.create({
          nurse_email: userEmail,
          recommendation_type: "compliance",
          recommendation_text: `${s.topic}: ${s.description}`,
          source: "compliance_checker",
          severity: s.priority === "high" ? "high" : "medium",
        });
      }
      toast.success("Training recommendations generated!");
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  if (violations.length === 0 && recommendations.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10">
      <CardHeader className="pb-2 p-3 sm:p-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-amber-600" />
          Recommended Learning
          {violations.length > 0 && (
            <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">
              Based on {violations.length} compliance issue{violations.length > 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0 space-y-2">
        {topPatterns.length > 0 && (
          <div className="space-y-1.5">
            {topPatterns.map(([cat, data]) => (
              <div key={cat} className="flex items-center gap-2 text-xs p-2 bg-white dark:bg-slate-800 rounded-lg border">
                <AlertTriangle className={`h-3 w-3 flex-shrink-0 ${data.severity === "critical" || data.severity === "high" ? "text-red-500" : "text-amber-500"}`} />
                <span className="flex-1 font-medium">{cat}</span>
                <Badge variant="outline" className="text-[10px]">{data.count}x</Badge>
              </div>
            ))}
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[10px] font-semibold text-slate-500 uppercase">Suggested Modules</p>
            {recommendations.slice(0, 3).map((rec) => (
              <div key={rec.id} className="text-xs p-2 bg-white dark:bg-slate-800 rounded-lg border flex items-start gap-2">
                <Sparkles className="h-3 w-3 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>{rec.recommendation_text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {topPatterns.length > 0 && (
            <Button size="sm" variant="outline" onClick={generateTraining} disabled={generating} className="h-7 text-xs flex-1">
              {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Generate Training
            </Button>
          )}
          <Link to={createPageUrl("TrainingHub")} className="flex-1">
            <Button size="sm" variant="outline" className="h-7 text-xs w-full">
              <ArrowRight className="h-3 w-3 mr-1" /> Training Hub
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}