import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function MedicationCrossChecker({ medications, diagnoses }) {
  const [interactions, setInteractions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [decisions, setDecisions] = useState({});
  const [rationaleInput, setRationaleInput] = useState({});

  const checkInteractions = async () => {
    if (!medications?.trim()) {
      toast.error("Please enter medications");
      return;
    }

    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medication safety specialist. Analyze potential drug interactions and contraindications.

Current Medications: ${medications}
Patient Diagnoses: ${diagnoses || "Not provided"}

Check for:
1. Drug-drug interactions
2. Drug-disease interactions
3. Contraindications
4. Dosing concerns

Format as a structured safety report with:
- Interaction name
- Severity (critical/major/moderate/minor)
- Clinical significance
- Recommendation

Be specific and clinical.`,
        add_context_from_internet: false,
      });

      setInteractions(result);
    } catch (error) {
      toast.error("Failed to check medication interactions");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600" />
          Medication Cross-Checker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          placeholder="Enter current medications (one per line)..."
          className="w-full h-24 p-2 border rounded text-sm"
          defaultValue={medications}
        />
        
        <Button
          onClick={checkInteractions}
          disabled={loading}
          className="w-full bg-orange-600 hover:bg-orange-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking...
            </>
          ) : (
            "Check Interactions"
          )}
        </Button>

        {interactions && (
          <div className="bg-white p-4 rounded border text-sm whitespace-pre-wrap">
            {interactions}
          </div>
        )}
      </CardContent>
    </Card>
  );
}