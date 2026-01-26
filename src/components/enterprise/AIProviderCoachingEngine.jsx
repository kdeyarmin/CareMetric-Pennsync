import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { 
  Brain, Target, TrendingUp, AlertTriangle, CheckCircle2, 
  Loader2, Sparkles, Award, MessageSquare, Send 
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";

export default function AIProviderCoachingEngine({ agencyCode, providers }) {
  const [generating, setGenerating] = useState(false);
  const [coachingRecommendations, setCoachingRecommendations] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [customMessage, setCustomMessage] = useState("");
  const queryClient = useQueryClient();

  const sendCoachingMessageMutation = useMutation({
    mutationFn: async ({ providerEmail, message }) => {
      await base44.integrations.Core.SendEmail({
        to: providerEmail,
        subject: 'Personalized Coaching Recommendations',
        body: message
      });
    },
    onSuccess: () => {
      toast.success('Coaching message sent successfully');
      setSelectedProvider(null);
      setCustomMessage("");
    }
  });

  const generateCoachingRecommendations = async () => {
    setGenerating(true);
    try {
      // Fetch performance data for each provider
      const providerAnalysis = await Promise.all(providers.map(async (provider) => {
        try {
          const audits = await base44.entities.ComplianceAudit.filter(
            { nurse_email: provider.email },
            '-audit_date',
            20
          );

          const notes = await base44.entities.NoteConversion.filter(
            { nurse_email: provider.email },
            '-created_date',
            20
          );

          const violations = await base44.entities.ComplianceViolation.filter(
            { user_email: provider.email, status: 'open' },
            '-created_date',
            20
          );

          const training = await base44.entities.TrainingCompletion.filter(
            { nurse_email: provider.email },
            '-completion_date',
            10
          );

          const avgCompliance = audits.length > 0
            ? audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
            : 0;

          const avgQuality = notes.length > 0
            ? notes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / notes.length
            : 0;

          // Identify common violation categories
          const violationCategories = violations.reduce((acc, v) => {
            acc[v.rule_category] = (acc[v.rule_category] || 0) + 1;
            return acc;
          }, {});

          const topViolation = Object.entries(violationCategories)
            .sort((a, b) => b[1] - a[1])[0];

          return {
            provider_email: provider.email,
            provider_name: provider.full_name,
            credential_type: provider.credential_type,
            avgCompliance: Math.round(avgCompliance),
            avgQuality: Math.round(avgQuality),
            totalNotes: notes.length,
            openViolations: violations.length,
            topViolationCategory: topViolation?.[0],
            topViolationCount: topViolation?.[1] || 0,
            trainingCompleted: training.filter(t => t.status === 'completed').length,
            recentTrainingScores: training.map(t => t.score).filter(s => s)
          };
        } catch (error) {
          console.error(`Error analyzing ${provider.email}:`, error);
          return null;
        }
      }));

      const validAnalysis = providerAnalysis.filter(a => a !== null);

      // Use AI to generate personalized coaching recommendations
      const aiPrompt = `As an expert healthcare performance coach, analyze these provider performance metrics and generate personalized, actionable coaching recommendations for each provider.

Provider Performance Data:
${validAnalysis.map(p => `
Provider: ${p.provider_name} (${p.credential_type || 'Provider'})
- Compliance Score: ${p.avgCompliance}%
- Quality Score: ${p.avgQuality}%
- Documentation Volume: ${p.totalNotes} notes
- Open Violations: ${p.openViolations}
- Top Issue: ${p.topViolationCategory || 'None'} (${p.topViolationCount} occurrences)
- Training Completed: ${p.trainingCompleted} modules
`).join('\n')}

For each provider, provide:
1. Overall performance assessment
2. Specific strengths to celebrate
3. Top 2-3 areas for improvement with concrete action steps
4. Personalized coaching tips based on their credential type
5. Recommended next steps

Return in this JSON format:
{
  "recommendations": [
    {
      "provider_email": "email",
      "provider_name": "name",
      "performance_level": "excellent|good|needs_improvement|critical",
      "overall_assessment": "brief assessment",
      "strengths": ["strength 1", "strength 2"],
      "areas_for_improvement": [
        {
          "area": "area name",
          "current_issue": "what's happening",
          "action_steps": ["step 1", "step 2"]
        }
      ],
      "coaching_tips": ["tip 1", "tip 2"],
      "priority_focus": "the #1 thing to work on"
    }
  ]
}`;

      const aiResponse = await base44.integrations.Core.InvokeLLM({
        prompt: aiPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  provider_email: { type: "string" },
                  provider_name: { type: "string" },
                  performance_level: { type: "string" },
                  overall_assessment: { type: "string" },
                  strengths: { type: "array", items: { type: "string" } },
                  areas_for_improvement: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        area: { type: "string" },
                        current_issue: { type: "string" },
                        action_steps: { type: "array", items: { type: "string" } }
                      }
                    }
                  },
                  coaching_tips: { type: "array", items: { type: "string" } },
                  priority_focus: { type: "string" }
                }
              }
            }
          }
        }
      });

      setCoachingRecommendations(aiResponse.recommendations || []);
      toast.success('AI coaching recommendations generated!');
    } catch (error) {
      toast.error('Failed to generate coaching recommendations');
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const getLevelColor = (level) => {
    switch (level) {
      case 'excellent': return 'bg-green-100 text-green-800 border-green-200';
      case 'good': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'needs_improvement': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const handleSendCoaching = (rec) => {
    const message = `Dear ${rec.provider_name},

I wanted to share some personalized coaching recommendations based on your recent performance:

OVERALL ASSESSMENT:
${rec.overall_assessment}

YOUR STRENGTHS:
${rec.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')}

AREAS FOR IMPROVEMENT:
${rec.areas_for_improvement.map((area, i) => `
${i + 1}. ${area.area}
   Current Challenge: ${area.current_issue}
   Action Steps:
   ${area.action_steps.map((step, j) => `   - ${step}`).join('\n')}
`).join('\n')}

COACHING TIPS:
${rec.coaching_tips.map((tip, i) => `• ${tip}`).join('\n')}

PRIORITY FOCUS:
${rec.priority_focus}

Keep up the great work! We're here to support your continued growth and success.

Best regards,
Your Agency Leadership Team`;

    setSelectedProvider(rec);
    setCustomMessage(message);
  };

  return (
    <>
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Provider Coaching Engine
          </CardTitle>
          <CardDescription>
            Generate personalized, actionable coaching recommendations for each provider based on performance metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Target className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              AI analyzes compliance scores, documentation quality, violation patterns, and training history to create tailored coaching plans.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
            <div>
              <p className="font-semibold text-slate-900">Generate Coaching Recommendations</p>
              <p className="text-sm text-slate-600">
                Analyze {providers?.length || 0} providers and create personalized development plans
              </p>
            </div>
            <Button
              onClick={generateCoachingRecommendations}
              disabled={generating || !providers || providers.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Recommendations
                </>
              )}
            </Button>
          </div>

          {/* Coaching Recommendations */}
          {coachingRecommendations.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Award className="w-5 h-5 text-blue-600" />
                  Personalized Coaching Plans ({coachingRecommendations.length})
                </h3>
              </div>

              <div className="space-y-4">
                {coachingRecommendations.map((rec, idx) => (
                  <Card key={idx} className="bg-white border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                              {rec.provider_name}
                              <Badge className={getLevelColor(rec.performance_level)}>
                                {rec.performance_level.replace('_', ' ')}
                              </Badge>
                            </h4>
                            <p className="text-sm text-slate-600 mt-1">{rec.overall_assessment}</p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSendCoaching(rec)}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Send className="w-4 h-4 mr-1" />
                            Send
                          </Button>
                        </div>

                        <div className="border-t pt-3 space-y-3">
                          <div>
                            <p className="text-sm font-semibold text-green-700 mb-1 flex items-center gap-1">
                              <CheckCircle2 className="w-4 h-4" />
                              Strengths:
                            </p>
                            <ul className="space-y-1">
                              {rec.strengths.map((strength, i) => (
                                <li key={i} className="text-sm text-slate-700 ml-5">• {strength}</li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-orange-700 mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-4 h-4" />
                              Areas for Improvement:
                            </p>
                            <div className="space-y-2">
                              {rec.areas_for_improvement.map((area, i) => (
                                <div key={i} className="ml-5 p-2 bg-slate-50 rounded">
                                  <p className="text-sm font-medium text-slate-900">{area.area}</p>
                                  <p className="text-xs text-slate-600 mb-1">{area.current_issue}</p>
                                  <div className="text-xs text-slate-700">
                                    {area.action_steps.map((step, j) => (
                                      <div key={j} className="flex items-start gap-1 mt-1">
                                        <span className="text-blue-600">→</span>
                                        <span>{step}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-sm font-semibold text-blue-900 mb-1 flex items-center gap-1">
                              <Target className="w-4 h-4" />
                              Priority Focus:
                            </p>
                            <p className="text-sm text-blue-800">{rec.priority_focus}</p>
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-purple-700 mb-1 flex items-center gap-1">
                              <MessageSquare className="w-4 h-4" />
                              Coaching Tips:
                            </p>
                            <ul className="space-y-1">
                              {rec.coaching_tips.map((tip, i) => (
                                <li key={i} className="text-sm text-slate-700 ml-5">• {tip}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {coachingRecommendations.length === 0 && !generating && (
            <Alert className="bg-slate-50 border-slate-200">
              <Brain className="w-4 h-4 text-slate-600" />
              <AlertDescription className="text-slate-700">
                Click "Generate Recommendations" to analyze provider performance and create personalized coaching plans.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Send Coaching Message Dialog */}
      <Dialog open={!!selectedProvider} onOpenChange={(open) => !open && setSelectedProvider(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Coaching Recommendations</DialogTitle>
            <DialogDescription>
              Review and customize the coaching message for {selectedProvider?.provider_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Email Message
              </label>
              <Textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={16}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedProvider(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => sendCoachingMessageMutation.mutate({
                providerEmail: selectedProvider?.provider_email,
                message: customMessage
              })}
              disabled={sendCoachingMessageMutation.isPending || !customMessage}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {sendCoachingMessageMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}