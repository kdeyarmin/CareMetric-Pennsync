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

  const handleDecision = (interactionId, decision) => {
    setDecisions(prev => ({
      ...prev,
      [interactionId]: decision
    }));
    if (decision === 'accept') {
      setRationaleInput(prev => ({
        ...prev,
        [interactionId]: ''
      }));
    }
  };

  const saveRationale = (interactionId) => {
    const rationale = rationaleInput[interactionId];
    if (!rationale?.trim()) {
      toast.error("Please provide a rationale");
      return;
    }
    toast.success(`Decision recorded with rationale`);
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
          <div className="bg-white p-4 rounded border space-y-4">
            {(typeof interactions === 'string' ? interactions.split('\n\n') : []).filter(block => block.trim()).map((block, idx) => {
              const interactionId = `interaction-${idx}`;
              const isDecided = decisions[interactionId];
              
              return (
                <div key={idx} className={`p-3 rounded border-l-4 ${
                  isDecided === 'dismiss' ? 'border-l-gray-400 bg-gray-50' : 
                  isDecided === 'accept' ? 'border-l-green-400 bg-green-50' : 
                  'border-l-orange-400 bg-orange-50'
                }`}>
                  <p className="text-sm font-semibold text-gray-700 mb-2">{block.split('\n')[0]}</p>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap mb-3">{block}</p>
                  
                  {!isDecided && (
                    <div className="flex gap-2 mb-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDecision(interactionId, 'dismiss')}
                        className="text-xs"
                      >
                        <X className="w-3 h-3 mr-1" /> Dismiss
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleDecision(interactionId, 'accept')}
                        className="text-xs bg-green-600 hover:bg-green-700"
                      >
                        <Check className="w-3 h-3 mr-1" /> Accept
                      </Button>
                    </div>
                  )}
                  
                  {isDecided === 'accept' && (
                    <div className="space-y-2 mt-3">
                      <textarea
                        placeholder="Enter clinical rationale for accepting this interaction..."
                        value={rationaleInput[interactionId] || ''}
                        onChange={(e) => setRationaleInput(prev => ({
                          ...prev,
                          [interactionId]: e.target.value
                        }))}
                        className="w-full h-16 p-2 border text-xs rounded"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveRationale(interactionId)}
                        className="w-full bg-green-600 hover:bg-green-700 text-xs"
                      >
                        Save Rationale
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}