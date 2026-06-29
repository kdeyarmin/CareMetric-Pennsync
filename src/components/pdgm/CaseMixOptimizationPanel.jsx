import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  AlertTriangle,
  Loader2,
  Lightbulb
} from "lucide-react";

export default function CaseMixOptimizationPanel({
  _patientId,
  currentNote,
  diagnosis,
  onApplyRecommendation
}) {
  const [optimization, setOptimization] = useState(null);
  const ai = useAICall();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const analyzeOptimization = async () => {
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Review this home health patient's documentation for accuracy and completeness, and identify clinically-supported documentation that may also affect PDGM case-mix.

CURRENT DOCUMENTATION:
${currentNote}

PRIMARY DIAGNOSIS: ${diagnosis}

Provide specific, actionable recommendations to make the documentation complete and accurately reflect the patient's condition. Only recommend documentation that is clinically supported; where it is, note its case-mix relevance. Never recommend wording that overstates the patient's condition.

Focus on:
1. Functional impairment documentation (mobility, ADLs, IADLs)
2. Comorbidity capture (active conditions supported by the record)
3. Clinical severity indicators
4. Therapy justification (if applicable)

For each recommendation, provide the clinical basis, the exact text to add (only if clinically accurate), and any case-mix relevance.

Return JSON:
{
  "current_case_mix_estimate": {
    "score": number (0.5-3.0),
    "payment_estimate": "string ($X,XXX - $Y,YYY)"
  },
  "optimized_case_mix_estimate": {
    "score": number,
    "payment_estimate": "string"
  },
  "recommendations": [
    {
      "category": "functional" | "comorbidity" | "clinical_severity" | "therapy",
      "title": "brief title",
      "current_state": "what's documented now",
      "opportunity": "what could be added",
      "documentation_text": "exact text to insert",
      "payment_impact": "$XXX increase",
      "case_mix_impact": "+0.X points",
      "compliance_rating": "high" | "medium" | "low",
      "effort": "low" | "medium" | "high",
      "oasis_items": ["M1XXX"],
      "priority": number (1-5)
    }
  ],
  "quick_wins": [
    {
      "action": "simple text to add",
      "impact": "$XX",
      "low_effort": true
    }
  ],
  "risk_considerations": ["list of compliance risks to be aware of"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            current_case_mix_estimate: { type: "object" },
            optimized_case_mix_estimate: { type: "object" },
            recommendations: { type: "array", items: { type: "object" } },
            quick_wins: { type: "array", items: { type: "object" } },
            risk_considerations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setOptimization(result);
    } catch (error) {
      console.error("Error analyzing optimization:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleApply = (text) => {
    onApplyRecommendation?.(text);
  };

  const _getImpactColor = (impact) => {
    if (impact === 'high') return 'bg-green-600 text-white';
    if (impact === 'medium') return 'bg-yellow-600 text-white';
    return 'bg-blue-600 text-white';
  };

  if (!isAdmin) {
    return null; // Hide financial data from non-admins
  }

  return (
    <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader className="py-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            <span>Case-Mix Optimization</span>
          </div>
          {!optimization && (
            <Button
              size="sm"
              onClick={analyzeOptimization}
              disabled={ai.loading || !currentNote || currentNote.length < 100}
              className="h-7 bg-green-600 hover:bg-green-700"
            >
              {ai.loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>Analyze</>
              )}
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3 space-y-3">
        {ai.loading ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto mb-2" />
            <p className="text-xs text-slate-600">Calculating optimization opportunities...</p>
          </div>
        ) : optimization ? (
          <>
            {/* Payment Estimate Comparison */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-3 rounded border">
                <p className="text-[10px] text-slate-600 mb-1">Current Estimate</p>
                <p className="text-lg font-bold text-slate-900">
                  {optimization.current_case_mix_estimate?.payment_estimate}
                </p>
                <Badge variant="outline" className="text-[10px] mt-1">
                  Score: {optimization.current_case_mix_estimate?.score}
                </Badge>
              </div>
              <div className="bg-gradient-to-br from-green-100 to-emerald-100 p-3 rounded border border-green-300">
                <p className="text-[10px] text-green-700 mb-1">Optimized Estimate</p>
                <p className="text-lg font-bold text-green-900">
                  {optimization.optimized_case_mix_estimate?.payment_estimate}
                </p>
                <Badge className="text-[10px] mt-1 bg-green-600 text-white">
                  Score: {optimization.optimized_case_mix_estimate?.score}
                </Badge>
              </div>
            </div>

            {/* Quick Wins */}
            {optimization.quick_wins?.length > 0 && (
              <Alert className="bg-yellow-50 border-yellow-300">
                <Lightbulb className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-xs">
                  <strong className="text-yellow-900">Quick Wins Available!</strong>
                  <div className="mt-2 space-y-1">
                    {optimization.quick_wins.map((win, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white p-2 rounded">
                        <span className="text-[10px] flex-1">{(win.action || '').substring(0, 60)}...</span>
                        <Badge className="text-[10px] bg-green-600 text-white ml-2">
                          {win.impact}
                        </Badge>
                        <Button
                          size="sm"
                          className="h-5 text-[10px] ml-2"
                          onClick={() => handleApply(win.action)}
                        >
                          Apply
                        </Button>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Detailed Recommendations by Category */}
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="functional" className="text-xs">Functional</TabsTrigger>
                <TabsTrigger value="comorbidity" className="text-xs">Comorbid</TabsTrigger>
                <TabsTrigger value="clinical_severity" className="text-xs">Clinical</TabsTrigger>
                <TabsTrigger value="therapy" className="text-xs">Therapy</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="space-y-2 mt-3">
                {optimization.recommendations?.sort((a, b) => a.priority - b.priority).map((rec, idx) => (
                  <RecommendationCard key={idx} rec={rec} onApply={handleApply} />
                ))}
              </TabsContent>

              {['functional', 'comorbidity', 'clinical_severity', 'therapy'].map(category => (
                <TabsContent key={category} value={category} className="space-y-2 mt-3">
                  {optimization.recommendations
                    ?.filter(r => r.category === category)
                    .sort((a, b) => a.priority - b.priority)
                    .map((rec, idx) => (
                      <RecommendationCard key={idx} rec={rec} onApply={handleApply} />
                    ))}
                </TabsContent>
              ))}
            </Tabs>

            {/* Risk Considerations */}
            {optimization.risk_considerations?.length > 0 && (
              <Alert className="bg-orange-50 border-orange-300">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-xs text-orange-900">
                  <strong>Important:</strong>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {optimization.risk_considerations.slice(0, 3).map((risk, idx) => (
                      <li key={idx}>{risk}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <div className="text-center py-6 text-slate-500 text-sm">
            <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p>Click "Analyze" to identify payment optimization opportunities</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationCard({ rec, onApply }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`p-3 rounded border ${
      rec.priority === 1 ? 'bg-green-50 border-green-300' :
      rec.priority === 2 ? 'bg-yellow-50 border-yellow-300' :
      'bg-blue-50 border-blue-300'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-slate-900">{rec.title}</p>
            <Badge className="text-[10px] bg-green-600 text-white">
              {rec.payment_impact}
            </Badge>
            {rec.case_mix_impact && (
              <Badge variant="outline" className="text-[10px]">
                {rec.case_mix_impact}
              </Badge>
            )}
          </div>
          <Badge className="text-[10px] capitalize">{(rec.category || '').replace(/_/g, ' ')}</Badge>
        </div>
      </div>

      <div className="space-y-2">
        <div className="bg-white/70 p-2 rounded text-xs">
          <strong className="text-slate-700">Opportunity:</strong>
          <p className="text-slate-600 mt-0.5">{rec.opportunity}</p>
        </div>

        {expanded && (
          <>
            <div className="bg-white p-2 rounded border text-xs">
              <strong className="text-slate-700">Add to documentation:</strong>
              <p className="text-slate-900 mt-1 italic">"{rec.documentation_text}"</p>
            </div>
            
            {rec.oasis_items?.length > 0 && (
              <div className="flex gap-1">
                <span className="text-[10px] text-slate-600">OASIS Items:</span>
                {rec.oasis_items.map((item, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{item}</Badge>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <Badge className={`text-[10px] ${
              rec.compliance_rating === 'high' ? 'bg-green-100 text-green-800' :
              rec.compliance_rating === 'medium' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {rec.compliance_rating} compliance
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {rec.effort} effort
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Less' : 'Details'}
            </Button>
            {rec.documentation_text && (
              <Button
                size="sm"
                className="h-6 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => onApply(rec.documentation_text)}
              >
                Apply
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}