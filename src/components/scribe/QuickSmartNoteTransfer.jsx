import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function QuickSmartNoteTransfer({ 
  generatedNote, 
  selectedPatientId, 
  visitType, 
  diagnosis,
  isLoading = false 
}) {
  const navigate = useNavigate();

  const handleTransfer = () => {
    if (generatedNote) {
      // Store all data in sessionStorage for Smart Note Assistant to pick up
      sessionStorage.setItem('preFilledNote', generatedNote);
      sessionStorage.setItem('fromScribe', 'true');
      if (selectedPatientId && selectedPatientId !== 'anonymous') {
        sessionStorage.setItem('selectedPatientId', selectedPatientId);
      }
      if (visitType) {
        sessionStorage.setItem('visitType', visitType);
      }
      if (diagnosis) {
        sessionStorage.setItem('diagnosis', diagnosis);
      }

      navigate(createPageUrl("SmartNoteAssistant"));
    }
  };

  if (!generatedNote) return null;

  return (
    <Button
      onClick={handleTransfer}
      disabled={isLoading}
      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-10 text-sm font-medium"
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Transferring...
        </>
      ) : (
        <>
          Smart Note Assistant
          <ArrowRight className="w-4 h-4 ml-2" />
        </>
      )}
    </Button>
  );
}