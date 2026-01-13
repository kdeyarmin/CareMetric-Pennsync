import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function AdverseEventPredictor({ patientData }) {
  const [riskAnalysis, setRiskAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reasonForVisit, setReasonForVisit] = useState("");

  const analyzeRisks = async () => {
    if (!patientData?.trim()) {
      toast.error("Please provide patient data");
      return;
    }

    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an adverse event prediction specialist. Analyze the following patient data to identify potential risks and adverse events.

Patient Data:
${patientData}

${reasonForVisit ? `Reason for Visit: ${reasonForVisit}` : ''}

Provide a comprehensive risk assessment including:
1. High-risk factors identified
2. Potential adverse events by likelihood (high/medium/low)
3. Clinical warning signs to monitor
4. Preventive interventions specific to the reason for visit
5. Monitoring recommendations

Be specific and actionable.`,
        add_context_from_internet: false,
      });

      setRiskAnalysis(result);
    } catch (error) {
      toast.error("Failed to analyze adverse event risks");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-red-200 bg-red-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          Adverse Event Predictor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          placeholder="Enter patient vitals, labs, history, and current condition..."
          className="w-full h-24 p-2 border rounded text-sm"
          defaultValue={patientData}
        />
        
        <Button
          onClick={analyzeRisks}
          disabled={loading}
          className="w-full bg-red-600 hover:bg-red-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Risks...
            </>
          ) : (
            "Predict Adverse Events"
          )}
        </Button>

        {riskAnalysis && (
          <div className="bg-white p-4 rounded border text-sm whitespace-pre-wrap">
            {riskAnalysis}
          </div>
        )}
      </CardContent>
    </Card>
  );
}