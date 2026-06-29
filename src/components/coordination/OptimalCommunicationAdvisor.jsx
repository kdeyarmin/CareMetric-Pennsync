import React, { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  MessageSquare, 
  Brain, 
  Loader2,
  Phone,
  Mail,
  Calendar,
  Clock
} from "lucide-react";

export default function OptimalCommunicationAdvisor({ 
  _patientId,
  patientData,
  recentVisits,
  upcomingVisits,
  outreachPurpose
}) {
  const ai = useAICall();
  const [recommendation, setRecommendation] = useState(null);

  const analyzeCommunicationStrategy = async () => {
    if (!patientData) return;

    try {
      const lastVisit = recentVisits?.[0];
      const nextVisit = upcomingVisits?.[0];

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a patient communication expert. Recommend optimal communication strategy for patient outreach.

PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Age: ${patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
- Primary Language: ${patientData.social_history?.primary_language || 'English'}
- Interpreter Needed: ${patientData.social_history?.interpreter_needed ? 'Yes' : 'No'}
- Living Situation: ${patientData.social_history?.living_situation || 'Unknown'}
- Cognitive Status: ${patientData.functional_status?.cognitive_status || 'Unknown'}
- Hearing Status: ${patientData.baseline_vitals?.hearing || 'Unknown'}
- Vision Status: ${patientData.baseline_vitals?.vision || 'Unknown'}

CONTACT INFORMATION:
- Phone: ${patientData.phone ? 'Available' : 'Not on file'}
- Email: ${patientData.email ? 'Available' : 'Not on file'}
- Caregiver: ${patientData.caregiver_name ? 'Available' : 'Not on file'}

OUTREACH PURPOSE: ${outreachPurpose || 'General care coordination'}

RECENT ENGAGEMENT:
- Last Visit: ${lastVisit ? `${lastVisit.visit_date} (${lastVisit.visit_type})` : 'No recent visits'}
- Next Scheduled: ${nextVisit ? `${nextVisit.visit_date}` : 'None scheduled'}

Based on patient characteristics, recommend:
1. Optimal communication channel (phone call, text, email, in-person, via caregiver)
2. Best time of day for contact
3. Best day of week
4. Communication style adjustments (consider cognitive status, language, hearing/vision)
5. Whether to include caregiver/family
6. Estimated conversation duration
7. Key talking points to prepare

Consider patient preferences, accessibility needs, and likelihood of successful contact.`,
        response_json_schema: {
          type: "object",
          properties: {
            primary_channel: { type: "string" },
            alternative_channel: { type: "string" },
            best_time_of_day: { type: "string" },
            best_day_of_week: { type: "string" },
            estimated_duration: { type: "string" },
            include_caregiver: { type: "boolean" },
            communication_adjustments: { type: "array", items: { type: "string" } },
            talking_points: { type: "array", items: { type: "string" } },
            accessibility_notes: { type: "string" },
            rationale: { type: "string" },
            success_likelihood: { type: "string" }
          }
        }
      });

      setRecommendation(result);
    } catch (error) {
      console.error('Communication analysis error:', error);
      setRecommendation({ error: error.message });
    }
  };

  const getChannelIcon = (channel) => {
    if (channel?.toLowerCase().includes('phone')) return Phone;
    if (channel?.toLowerCase().includes('email')) return Mail;
    if (channel?.toLowerCase().includes('text')) return MessageSquare;
    return MessageSquare;
  };

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-navy-50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-navy-600" />
          AI Communication Strategy Advisor
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <Alert className="bg-navy-50 border-navy-200">
          <Brain className="w-4 h-4 text-navy-600" />
          <AlertDescription className="text-sm text-navy-900">
            Get AI-powered recommendations for optimal patient contact timing and method
          </AlertDescription>
        </Alert>

        {!recommendation && !ai.loading && (
          <Button
            onClick={analyzeCommunicationStrategy}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            <Brain className="w-4 h-4 mr-2" />
            Analyze Communication Strategy
          </Button>
        )}

        {ai.loading && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 text-navy-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-600">Analyzing optimal outreach strategy...</p>
          </div>
        )}

        {recommendation && !recommendation.error && (
          <>
            {/* Rationale */}
            {recommendation.rationale && (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-sm text-blue-900">
                  {recommendation.rationale}
                </AlertDescription>
              </Alert>
            )}

            {/* Primary Channel */}
            <div className="p-3 bg-navy-50 border border-navy-200 rounded-lg">
              <p className="text-xs font-semibold text-navy-900 mb-2">Recommended Channel</p>
              <div className="flex items-center gap-2">
                {React.createElement(getChannelIcon(recommendation.primary_channel), { 
                  className: "w-5 h-5 text-navy-600" 
                })}
                <span className="font-semibold text-navy-900">{recommendation.primary_channel}</span>
              </div>
              {recommendation.alternative_channel && (
                <p className="text-xs text-navy-700 mt-1">
                  Backup: {recommendation.alternative_channel}
                </p>
              )}
            </div>

            {/* Timing */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-navy-50 border border-navy-200 rounded-lg">
                <Clock className="w-4 h-4 text-navy-600 mb-1" />
                <p className="text-xs font-semibold text-navy-900">Best Time</p>
                <p className="text-xs text-navy-800">{recommendation.best_time_of_day}</p>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Calendar className="w-4 h-4 text-blue-600 mb-1" />
                <p className="text-xs font-semibold text-blue-900">Best Day</p>
                <p className="text-xs text-blue-800">{recommendation.best_day_of_week}</p>
              </div>
            </div>

            {/* Include Caregiver */}
            {recommendation.include_caregiver && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertDescription className="text-sm text-yellow-900">
                  <strong>Include Caregiver:</strong> {patientData.caregiver_name || 'Contact via family'}
                </AlertDescription>
              </Alert>
            )}

            {/* Communication Adjustments */}
            {recommendation.communication_adjustments?.length > 0 && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm font-semibold text-orange-900 mb-2">Communication Adjustments</p>
                <ul className="text-xs space-y-1 text-orange-800">
                  {recommendation.communication_adjustments.map((adj, idx) => (
                    <li key={idx}>• {adj}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Talking Points */}
            {recommendation.talking_points?.length > 0 && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-semibold text-green-900 mb-2">Key Talking Points</p>
                <ul className="text-xs space-y-1 text-green-800">
                  {recommendation.talking_points.map((point, idx) => (
                    <li key={idx}>✓ {point}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Accessibility Notes */}
            {recommendation.accessibility_notes && (
              <div className="p-2 bg-slate-50 border rounded text-xs text-slate-700">
                <strong>Accessibility:</strong> {recommendation.accessibility_notes}
              </div>
            )}

            {/* Success Likelihood */}
            {recommendation.success_likelihood && (
              <div className="flex items-center justify-between p-2 bg-blue-50 rounded">
                <span className="text-xs font-semibold text-blue-900">Success Likelihood</span>
                <Badge className="bg-blue-600">{recommendation.success_likelihood}</Badge>
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => setRecommendation(null)}
              className="w-full"
            >
              Close
            </Button>
          </>
        )}

        {recommendation?.error && (
          <Alert className="bg-red-50 border-red-300">
            <AlertDescription className="text-sm text-red-800">
              Analysis failed: {recommendation.error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}