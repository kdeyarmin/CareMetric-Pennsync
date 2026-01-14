import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import DetailedComplianceFeedback from "../compliance/DetailedComplianceFeedback";
import { getProviderCompliancePrompt } from "../utils/providerSpecificConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export default function ClinicalNoteAnalyzer({ onDataExtracted }) {
  const [roughNotes, setRoughNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const extractData = async () => {
    if (!roughNotes.trim()) {
      toast.error("Please enter clinical notes");
      return;
    }

    setExtracting(true);
    try {
      const result = await base44.functions.invoke('extractClinicalDataFromNotes', {
        roughNotes,
      });

      setExtractedData(result);
      onDataExtracted?.(result);
      toast.success("Data extracted successfully");
    } catch (error) {
      toast.error("Failed to extract data");
      console.error(error);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card className="border-indigo-200 bg-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-indigo-600" />
          Clinical Note Analyzer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          value={roughNotes}
          onChange={(e) => setRoughNotes(e.target.value)}
          placeholder="Paste your rough clinical notes here..."
          className="w-full h-32 p-2 border rounded text-sm"
        />

        <Button
          onClick={extractData}
          disabled={extracting}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {extracting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Extracting...
            </>
          ) : (
            "Extract & Auto-Fill"
          )}
        </Button>

        {extractedData && (
          <>
            <div className="bg-white p-4 rounded border space-y-3 text-sm">
              {extractedData.diagnoses?.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-700">Diagnoses:</p>
                  <p className="text-gray-600">{extractedData.diagnoses.join(", ")}</p>
                </div>
              )}
              {extractedData.medications?.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-700">Medications:</p>
                  <p className="text-gray-600">{extractedData.medications.join(", ")}</p>
                </div>
              )}
              {extractedData.symptoms?.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-700">Symptoms:</p>
                  <p className="text-gray-600">{extractedData.symptoms.join(", ")}</p>
                </div>
              )}
            </div>

            {/* Detailed Compliance Feedback */}
            <div className="mt-4">
              <DetailedComplianceFeedback 
                note={roughNotes}
                providerType={currentUser?.provider_type || 'RN'}
                visitType={extractedData?.visit_type || 'routine_visit'}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}