import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Brain, CheckCircle, AlertCircle, Loader2, ExternalLink, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ComplianceBasedTrainingRecommender({ 
  complianceResults, 
  documentationGaps,
  visitType,
  providerType,
  nurseEmail
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState(null);

  // Fetch provider's historical compliance issues
  const { data: historicalIssues = [] } = useQuery({
    queryKey: ['historicalComplianceIssues', nurseEmail],
    queryFn: async () => {
      const audits = await base44.entities.ComplianceAudit.filter(
        { nurse_email: nurseEmail },
        '-audit_date',
        50
      );
      return audits;
    },
    enabled: !!nurseEmail
  });

  // Fetch existing training recommendations to avoid duplicates
  const { data: existingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendations', nurseEmail],
    queryFn: async () => {
      return await base44.entities.TrainingRecommendation.filter({
        nurse_email: nurseEmail,
        addressed: false
      });
    },
    enabled: !!nurseEmail
  });

  const analyzeAndRecommend = async () => {
    setAnalyzing(true);
    try {
      // Compile compliance issues from current check
      const currentIssues = [
        ...(complianceResults?.issues || []),
        ...(documentationGaps || [])
      ];

      // Extract patterns from historical data
      const historicalPatterns = historicalIssues
        .flatMap(audit => audit.issues || [])
        .reduce((acc, issue) => {
          const key = issue.element;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

      // Build analysis prompt
      const analysisPrompt = `Analyze this provider's compliance and documentation patterns to recommend targeted training.

Provider Type: ${providerType}
Visit Type: ${visitType}

Current Compliance Issues:
${JSON.stringify(currentIssues, null, 2)}

Documentation Gaps:
${JSON.stringify(documentationGaps, null, 2)}

Historical Issue Patterns (last 50 audits):
${JSON.stringify(historicalPatterns, null, 2)}

Based on this analysis, recommend 3-5 specific training modules that would address:
1. Recurring compliance issues
2. Critical documentation gaps
3. Provider-specific skill development needs

For each recommendation, provide:
- Training topic/module title
- Reason why this training is recommended
- Specific deficiency it addresses
- Expected impact on compliance scores
- Urgency level (critical, high, medium, low)
- Estimated completion time in minutes`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: analysisPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  training_topic: { type: "string" },
                  reason: { type: "string" },
                  addresses_deficiency: { type: "string" },
                  expected_impact: { type: "string" },
                  urgency: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  estimated_minutes: { type: "number" },
                  recommendation_category: { type: "string" }
                }
              }
            },
            summary: { type: "string" },
            compliance_improvement_potential: { type: "number" }
          }
        }
      });

      setRecommendations(response);

      // Save recommendations to database for tracking
      for (const rec of response.recommendations) {
        // Check if similar recommendation already exists
        const alreadyExists = existingRecommendations.some(
          existing => existing.recommendation_text.toLowerCase().includes(rec.training_topic.toLowerCase())
        );

        if (!alreadyExists) {
          await base44.entities.TrainingRecommendation.create({
            nurse_email: nurseEmail,
            recommendation_type: rec.recommendation_category || 'documentation',
            recommendation_text: rec.training_topic,
            source: 'compliance_checker',
            severity: rec.urgency,
            addressed: false,
            context_data: {
              element: rec.addresses_deficiency,
              full_context: rec.reason
            }
          });
        }
      }

      toast.success('Training recommendations generated');
    } catch (error) {
      console.error('Error analyzing compliance:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setAnalyzing(false);
    }
  };

  const hasIssues = (complianceResults?.issues?.length > 0 || documentationGaps?.length > 0);

  if (!hasIssues) return null;

  const getUrgencyColor = (urgency) => {
    switch(urgency) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  return (
    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-purple-600" />
          AI Compliance Training Recommendations
        </CardTitle>
        <CardDescription>
          Personalized training based on your documentation patterns
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!recommendations ? (
          <>
            <Alert className="bg-purple-100 dark:bg-purple-900 border-purple-200 dark:border-purple-800">
              <Brain className="w-4 h-4 text-purple-600" />
              <AlertDescription className="text-purple-900 dark:text-purple-100">
                AI can analyze your compliance issues and suggest targeted training to improve your documentation quality.
              </AlertDescription>
            </Alert>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={analyzeAndRecommend}
                disabled={analyzing}
                className="bg-purple-600 hover:bg-purple-700 flex-1"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing Patterns...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Get Personalized Training
                  </>
                )}
              </Button>

              <Link to={createPageUrl('MyTraining')} className="flex-1">
                <Button variant="outline" className="w-full">
                  <GraduationCap className="w-4 h-4 mr-2" />
                  View All Training
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 dark:text-green-100">
                <strong>Potential Improvement:</strong> {recommendations.summary}
                <br />
                <span className="text-sm">
                  Expected compliance score increase: +{recommendations.compliance_improvement_potential}%
                </span>
              </AlertDescription>
            </Alert>

            {/* Training Recommendations */}
            <div className="space-y-3">
              {recommendations.recommendations.map((rec, idx) => (
                <div 
                  key={idx}
                  className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-purple-200 dark:border-purple-800"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                          {rec.training_topic}
                        </h4>
                        <Badge className={getUrgencyColor(rec.urgency)}>
                          {rec.urgency}
                        </Badge>
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-slate-700 dark:text-slate-300">Why:</span>
                          <p className="text-slate-600 dark:text-slate-400">{rec.reason}</p>
                        </div>
                        
                        <div>
                          <span className="font-medium text-slate-700 dark:text-slate-300">Addresses:</span>
                          <p className="text-slate-600 dark:text-slate-400">{rec.addresses_deficiency}</p>
                        </div>
                        
                        <div>
                          <span className="font-medium text-slate-700 dark:text-slate-300">Expected Impact:</span>
                          <p className="text-green-600 dark:text-green-400">{rec.expected_impact}</p>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>⏱️ {rec.estimated_minutes} minutes</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Link to={createPageUrl('MyTraining')} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        <GraduationCap className="w-4 h-4 mr-1" />
                        Start Training
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          const existing = await base44.entities.TrainingRecommendation.filter({
                            nurse_email: nurseEmail,
                            recommendation_text: rec.training_topic,
                            addressed: false
                          });
                          
                          if (existing.length > 0) {
                            await base44.entities.TrainingRecommendation.update(existing[0].id, {
                              addressed: true
                            });
                            toast.success('Marked as addressed');
                          }
                        } catch (error) {
                          console.error(error);
                        }
                      }}
                    >
                      Mark as Done
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              onClick={() => setRecommendations(null)}
              className="w-full"
            >
              Generate New Recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}