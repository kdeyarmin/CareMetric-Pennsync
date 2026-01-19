import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, TrendingUp, AlertCircle, CheckCircle, Loader } from "lucide-react";
import { toast } from "sonner";

export default function CodingAccuracyReport() {
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.filter({})
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => base44.entities.Visit.filter({})
  });

  const generateAccuracyReport = async () => {
    setAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze these invoices and visits for coding accuracy issues and common billing errors.

Invoices: ${JSON.stringify(invoices.slice(0, 100))}
Visits: ${JSON.stringify(visits.slice(0, 100))}

Identify:
1. Common coding errors (wrong modifiers, unbundled codes, incorrect E&M levels)
2. Documentation insufficiency for billed codes
3. Duplicate billing issues
4. Downcoding patterns (billing lower than documented)
5. Compliance risks and red flags

Provide specific examples and recommendations.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_accuracy_score: { type: "number" },
            total_invoices_reviewed: { type: "number" },
            issues_found: { type: "number" },
            common_errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  error_type: { type: "string" },
                  frequency: { type: "number" },
                  description: { type: "string" },
                  examples: { type: "array", items: { type: "string" } },
                  recommendation: { type: "string" },
                  financial_impact: { type: "string" }
                }
              }
            },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" },
                  action_needed: { type: "string" }
                }
              }
            },
            improvement_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_performance: { type: "string" },
                  target: { type: "string" },
                  steps: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      setReport(response);
      toast.success("Coding accuracy report generated");
    } catch (error) {
      toast.error("Failed to generate report");
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-blue-600" />
            Coding Accuracy Report
          </CardTitle>
          <Button onClick={generateAccuracyReport} disabled={analyzing}>
            {analyzing ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Generate Report"
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!report ? (
          <div className="text-center py-8 text-gray-500">
            <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm">Click "Generate Report" to analyze coding accuracy</p>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="errors">Common Errors</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
              <TabsTrigger value="improvements">Opportunities</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-300">Accuracy Score</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                    {report.overall_accuracy_score?.toFixed(1)}%
                  </p>
                  <Progress value={report.overall_accuracy_score} className="mt-2" />
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                  <p className="text-sm text-purple-700 dark:text-purple-300">Invoices Reviewed</p>
                  <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                    {report.total_invoices_reviewed}
                  </p>
                </div>
                <div className="p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                  <p className="text-sm text-orange-700 dark:text-orange-300">Issues Found</p>
                  <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                    {report.issues_found}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="errors" className="space-y-3">
              {report.common_errors?.map((error, idx) => (
                <div key={idx} className="p-4 border rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium">{error.error_type}</p>
                      <p className="text-xs text-gray-600">
                        Frequency: {error.frequency} occurrences
                      </p>
                    </div>
                    <Badge variant="outline">{error.financial_impact}</Badge>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                    {error.description}
                  </p>
                  {error.examples && error.examples.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs mb-2">
                      <p className="font-semibold mb-1">Examples:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {error.examples.map((ex, i) => (
                          <li key={i}>{ex}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded text-xs">
                    <p className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                      Recommendation:
                    </p>
                    <p className="text-blue-700 dark:text-blue-300">{error.recommendation}</p>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="compliance" className="space-y-3">
              {report.compliance_risks?.map((risk, idx) => (
                <div
                  key={idx}
                  className={`p-4 border rounded-lg ${
                    risk.severity === 'high'
                      ? 'border-red-300 bg-red-50 dark:bg-red-950'
                      : 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950'
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <AlertCircle
                      className={`w-4 h-4 mt-0.5 ${
                        risk.severity === 'high' ? 'text-red-600' : 'text-yellow-600'
                      }`}
                    />
                    <div>
                      <p className="font-medium">{risk.risk}</p>
                      <Badge
                        className={
                          risk.severity === 'high'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }
                      >
                        {risk.severity} severity
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm ml-6">{risk.action_needed}</p>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="improvements" className="space-y-3">
              {report.improvement_opportunities?.map((opp, idx) => (
                <div key={idx} className="p-4 border rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium">{opp.area}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div>
                          <span className="text-gray-600">Current:</span>{' '}
                          <span className="font-semibold">{opp.current_performance}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Target:</span>{' '}
                          <span className="font-semibold text-green-600">{opp.target}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="ml-6 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                    <p className="text-xs font-semibold mb-1">Action Steps:</p>
                    <ul className="text-xs space-y-1">
                      {opp.steps?.map((step, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <CheckCircle className="w-3 h-3 text-green-600 mt-0.5" />
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}