import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertTriangle, CheckCircle, Info, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";

export default function RealTimeComplianceFeedback({ 
  noteContent, 
  visitType, 
  providerType,
  patientData 
}) {
  const [complianceScore, setComplianceScore] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [issues, setIssues] = useState([]);
  const [recommendations, setRecommendations] = useState([]);

  useEffect(() => {
    if (noteContent && noteContent.length > 50) {
      const debounce = setTimeout(() => {
        analyzeCompliance();
      }, 3000);
      return () => clearTimeout(debounce);
    }
  }, [noteContent, visitType]);

  const analyzeCompliance = async () => {
    setIsAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clinical note for compliance with regulatory standards (OASIS, HIPAA, Medicare):

Visit Type: ${visitType}
Provider Type: ${providerType}
Note Content: ${noteContent}

Evaluate:
1. OASIS documentation requirements (if home health)
2. HIPAA privacy compliance
3. Medicare billing documentation requirements
4. Required elements for ${visitType} visit
5. Clinical detail and justification

Provide a compliance score (0-100) and identify specific issues and recommendations.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number" },
            oasis_compliance: {
              type: "object",
              properties: {
                score: { type: "number" },
                issues: { type: "array", items: { type: "string" } },
                met_requirements: { type: "array", items: { type: "string" } }
              }
            },
            hipaa_compliance: {
              type: "object",
              properties: {
                score: { type: "number" },
                issues: { type: "array", items: { type: "string" } }
              }
            },
            medicare_compliance: {
              type: "object",
              properties: {
                score: { type: "number" },
                issues: { type: "array", items: { type: "string" } },
                missing_elements: { type: "array", items: { type: "string" } }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string" },
                  suggestion: { type: "string" },
                  example: { type: "string" }
                }
              }
            }
          }
        }
      });

      setComplianceScore(response.overall_score);
      
      const allIssues = [
        ...(response.oasis_compliance?.issues || []).map(i => ({ type: "OASIS", text: i, severity: "high" })),
        ...(response.hipaa_compliance?.issues || []).map(i => ({ type: "HIPAA", text: i, severity: "critical" })),
        ...(response.medicare_compliance?.missing_elements || []).map(i => ({ type: "Medicare", text: i, severity: "medium" }))
      ];
      
      setIssues(allIssues);
      setRecommendations(response.recommendations || []);
    } catch (error) {
      console.error("Error analyzing compliance:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score) => {
    if (score >= 90) return "from-green-50 to-emerald-50 border-green-200";
    if (score >= 70) return "from-yellow-50 to-amber-50 border-yellow-200";
    return "from-red-50 to-rose-50 border-red-200";
  };

  if (!noteContent || noteContent.length < 50) return null;

  return (
    <Card className={`border-2 bg-gradient-to-br ${complianceScore ? getScoreBgColor(complianceScore) : 'from-slate-50 to-gray-50 border-slate-200'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <CardTitle className="text-base">Compliance Check</CardTitle>
            <Badge variant="outline" className="text-xs">Real-time</Badge>
          </div>
          {isAnalyzing && (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent" />
              Analyzing...
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {complianceScore !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/60 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Overall Compliance Score</span>
              <span className={`text-2xl font-bold ${getScoreColor(complianceScore)}`}>
                {complianceScore}%
              </span>
            </div>
            <Progress value={complianceScore} className="h-2" />
            <div className="flex items-center gap-2 mt-2">
              {complianceScore >= 90 ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : complianceScore >= 70 ? (
                <Info className="w-4 h-4 text-yellow-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              )}
              <span className="text-xs text-gray-600">
                {complianceScore >= 90 ? "Excellent compliance" : 
                 complianceScore >= 70 ? "Good, minor improvements needed" : 
                 "Needs significant improvement"}
              </span>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {issues.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Compliance Issues ({issues.length})
              </h4>
              {issues.map((issue, idx) => (
                <Alert key={idx} className="py-2">
                  <AlertDescription className="text-xs">
                    <Badge variant="outline" className="mr-2 text-xs">
                      {issue.type}
                    </Badge>
                    {issue.text}
                  </AlertDescription>
                </Alert>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {recommendations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                Recommendations
              </h4>
              {recommendations.slice(0, 3).map((rec, idx) => (
                <div key={idx} className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                  <div className="flex items-start gap-2">
                    <Badge 
                      variant={rec.priority === "high" ? "destructive" : "outline"} 
                      className="text-xs mt-0.5"
                    >
                      {rec.priority}
                    </Badge>
                    <div className="flex-1">
                      <p className="text-xs font-medium text-gray-900 mb-1">{rec.suggestion}</p>
                      {rec.example && (
                        <p className="text-xs text-gray-600 italic">Example: "{rec.example}"</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}