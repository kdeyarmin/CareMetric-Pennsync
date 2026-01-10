import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Target, Phone, Calendar, FileText } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { secureAICall } from "../utils/security";

export default function NextBestActionsAI({ 
  enhancedNote,
  patientData,
  vitalSigns,
  diagnosis,
  onCreateTask,
  userEmail 
}) {
  const [actions, setActions] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (enhancedNote) {
      analyzeNextSteps();
    }
  }, [enhancedNote]);

  const analyzeNextSteps = async () => {
    setIsAnalyzing(true);
    try {
      const result = await secureAICall(
        () => base44.integrations.Core.InvokeLLM({
          prompt: `Based on clinical note, suggest 3 most important next actions for nurse.

NOTE: ${enhancedNote.substring(0, 800)}
VITALS: ${Object.entries(vitalSigns || {}).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ')}
Dx: ${diagnosis}

Prioritize actions that:
- Address abnormal findings
- Prevent complications
- Improve patient outcomes
- Ensure continuity of care

Return top 3 actions:
{
  "actions": [
    {
      "action": "Specific action to take",
      "rationale": "Why this is important",
      "timeframe": "When to do it",
      "priority": "critical/high/medium",
      "type": "notify_md/schedule_visit/coordinate_care/educate/monitor"
    }
  ]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              actions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    rationale: { type: "string" },
                    timeframe: { type: "string" },
                    priority: { type: "string" },
                    type: { type: "string" }
                  }
                }
              }
            }
          }
        }),
        userEmail
      );
      setActions(result);
    } catch (error) {
      setActions(null);
    }
    setIsAnalyzing(false);
  };

  if (isAnalyzing || !actions?.actions?.length) return null;

  const getActionIcon = (type) => {
    switch (type) {
      case 'notify_md': return Phone;
      case 'schedule_visit': return Calendar;
      case 'coordinate_care': return Target;
      default: return FileText;
    }
  };

  const priorityColors = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-600 text-white',
    medium: 'bg-blue-600 text-white'
  };

  return (
    <Card className="border-2 border-indigo-400 bg-gradient-to-r from-indigo-50 to-purple-50 shadow-lg">
      <CardHeader className="py-3 bg-gradient-to-r from-indigo-100 to-purple-100">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-indigo-600" />
          AI Recommended Next Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {actions.actions.map((action, idx) => {
          const Icon = getActionIcon(action.type);
          return (
            <div key={idx} className="bg-white rounded-lg border-2 border-indigo-200 p-3 space-y-2 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-2">
                <Icon className="w-4 h-4 text-indigo-600 mt-1 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{action.action}</span>
                    <Badge className={priorityColors[action.priority] || priorityColors.medium}>
                      {action.priority}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{action.timeframe}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{action.rationale}</p>
                  <Button
                    size="sm"
                    onClick={() => onCreateTask?.(action.action, action.rationale, action.priority)}
                    className="bg-indigo-600 hover:bg-indigo-700 w-full gap-2"
                  >
                    Create Task <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}