import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

export default function RegulatoryComplianceMonitor({ enhancedNote, visitType }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [violations, setViolations] = useState([]);

  // Fetch recent regulatory updates
  const { data: recentUpdates = [] } = useQuery({
    queryKey: ['recentRegulatoryUpdates'],
    queryFn: async () => {
      const updates = await base44.entities.RegulatoryUpdate.list('-effective_date', 20);
      return updates.filter(u => 
        u.status === 'implemented' && 
        u.effective_date && 
        new Date(u.effective_date) <= new Date()
      );
    }
  });

  const checkCompliance = async () => {
    setAnalyzing(true);
    try {
      const updatesSummary = recentUpdates.slice(0, 5).map(u => 
        `- ${u.title} (${u.source}, effective ${u.effective_date}): ${u.summary}`
      ).join('\n');

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a regulatory compliance expert. Review this clinical note for compliance with the LATEST regulatory updates.

RECENT REGULATORY UPDATES (Last 90 days):
${updatesSummary}

CLINICAL NOTE TO REVIEW:
${enhancedNote}

VISIT TYPE: ${visitType}

Analyze the note and identify any violations or risks related to these recent regulatory changes. Return JSON:
{
  "violations": [
    {
      "regulation": "Name/reference of regulation",
      "issue": "What compliance issue exists",
      "severity": "critical|high|medium|low",
      "recommendation": "How to fix it",
      "update_reference": "Which recent update this relates to"
    }
  ],
  "overall_status": "compliant|needs_review|non_compliant"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            violations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  regulation: { type: "string" },
                  issue: { type: "string" },
                  severity: { type: "string" },
                  recommendation: { type: "string" },
                  update_reference: { type: "string" }
                }
              }
            },
            overall_status: { type: "string" }
          }
        }
      });

      setViolations(response.violations || []);
      
      if (response.violations?.length === 0) {
        toast.success("Note complies with recent regulatory updates");
      } else {
        toast.warning(`Found ${response.violations.length} compliance concern(s)`);
      }
    } catch (error) {
      console.error('Error checking regulatory compliance:', error);
      toast.error("Failed to check regulatory compliance");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            Latest Regulatory Compliance
          </span>
          <Button
            onClick={checkCompliance}
            disabled={analyzing || !enhancedNote}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 mr-2" />
                Check Against Recent Updates
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentUpdates.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-2">
              Recent Regulatory Updates ({recentUpdates.length}):
            </p>
            <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
              {recentUpdates.slice(0, 3).map((update, idx) => (
                <li key={idx}>
                  • {update.title} ({update.source}) - {new Date(update.effective_date).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {violations.length > 0 ? (
          <div className="space-y-3">
            {violations.map((violation, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 p-3 rounded-lg border-l-4 border-amber-600"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {violation.regulation}
                    </p>
                  </div>
                  <Badge className={
                    violation.severity === 'critical' ? 'bg-red-600' :
                    violation.severity === 'high' ? 'bg-orange-500' :
                    violation.severity === 'medium' ? 'bg-yellow-500' :
                    'bg-blue-500'
                  }>
                    {violation.severity}
                  </Badge>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                  <strong>Issue:</strong> {violation.issue}
                </p>
                {violation.update_reference && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                    <strong>Related Update:</strong> {violation.update_reference}
                  </p>
                )}
                <div className="bg-green-50 dark:bg-green-900/30 p-2 rounded">
                  <p className="text-xs text-green-800 dark:text-green-300">
                    <strong>Recommendation:</strong> {violation.recommendation}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : violations.length === 0 && !analyzing ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Check your note against the latest regulatory updates</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}