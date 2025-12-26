import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Wand2, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function OneClickComplianceFixer({ 
  noteContent, 
  visitType, 
  diagnosis, 
  patientData,
  vitalSigns,
  onApplyFix,
  autoAnalyze = true 
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [isFixing, setIsFixing] = useState(false);
  const [fixedIssues, setFixedIssues] = useState([]);

  useEffect(() => {
    if (autoAnalyze && noteContent?.length > 50) {
      analyzeCompliance();
    }
  }, [noteContent, visitType, diagnosis]);

  const analyzeCompliance = async () => {
    if (!noteContent) return;

    setIsAnalyzing(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clinical note for Medicare compliance gaps. Identify ONLY critical missing elements that can be added with one-click fixes.

NOTE:
${noteContent}

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}
VITALS: ${JSON.stringify(vitalSigns)}
PATIENT: ${patientData?.first_name} ${patientData?.last_name}

For each critical gap, provide:
1. Element name (e.g., "Homebound Status")
2. Why it's missing
3. ONE-SENTENCE fix that can be added to the note
4. Severity (critical/high/medium)

Return only actionable gaps with ready-to-insert text.`,
        response_json_schema: {
          type: "object",
          properties: {
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  reason: { type: "string" },
                  fix_text: { type: "string" },
                  severity: { type: "string" },
                  location_hint: { type: "string" }
                }
              }
            },
            overall_score: { type: "number" }
          }
        }
      });

      setComplianceIssues(result.issues || []);
    } catch (error) {
      console.error('Error analyzing compliance:', error);
    }
    setIsAnalyzing(false);
  };

  const handleFixOne = (issue) => {
    onApplyFix?.(issue.fix_text);
    setFixedIssues([...fixedIssues, issue.element]);
  };

  const handleFixAll = async () => {
    setIsFixing(true);
    const unfixedIssues = complianceIssues.filter(i => !fixedIssues.includes(i.element));
    
    for (const issue of unfixedIssues) {
      onApplyFix?.(issue.fix_text);
      setFixedIssues(prev => [...prev, issue.element]);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    setIsFixing(false);
  };

  const criticalIssues = complianceIssues.filter(i => i.severity === 'critical' && !fixedIssues.includes(i.element));
  const highIssues = complianceIssues.filter(i => i.severity === 'high' && !fixedIssues.includes(i.element));
  const unfixedCount = criticalIssues.length + highIssues.length;

  if (isAnalyzing) {
    return (
      <Card className="border-2 border-blue-200">
        <CardContent className="p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
          <p className="text-sm text-gray-600">Analyzing compliance...</p>
        </CardContent>
      </Card>
    );
  }

  if (unfixedCount === 0) {
    return (
      <Alert className="bg-green-50 border-green-300">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <AlertDescription className="text-sm text-green-900">
          No critical compliance issues detected
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-orange-300 bg-gradient-to-r from-orange-50 to-yellow-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Quick Compliance Fixes
          </CardTitle>
          <Button
            size="sm"
            onClick={handleFixAll}
            disabled={isFixing}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <Wand2 className="w-4 h-4 mr-2" />
            {isFixing ? 'Fixing...' : `Fix All (${unfixedCount})`}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {criticalIssues.map((issue, idx) => (
          <Card key={idx} className="border-l-4 border-l-red-500">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-red-600 text-xs">CRITICAL</Badge>
                    <p className="font-semibold text-sm">{issue.element}</p>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{issue.reason}</p>
                  <div className="bg-gray-50 p-2 rounded text-xs italic text-gray-700">
                    "{issue.fix_text}"
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleFixOne(issue)}
                  className="bg-blue-600 hover:bg-blue-700 h-8 text-xs"
                >
                  <Wand2 className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {highIssues.map((issue, idx) => (
          <Card key={idx} className="border-l-4 border-l-orange-500">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-orange-600 text-xs">HIGH</Badge>
                    <p className="font-semibold text-sm">{issue.element}</p>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{issue.reason}</p>
                  <div className="bg-gray-50 p-2 rounded text-xs italic text-gray-700">
                    "{issue.fix_text}"
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleFixOne(issue)}
                  className="bg-blue-600 hover:bg-blue-700 h-8 text-xs"
                >
                  <Wand2 className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}