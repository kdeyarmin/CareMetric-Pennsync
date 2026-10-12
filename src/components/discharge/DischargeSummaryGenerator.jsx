import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import DischargeSummaryWorkflow from './DischargeSummaryWorkflow';

export default function DischargeSummaryGenerator({ patientId, onComplete }) {
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [previousPatientId, setPreviousPatientId] = useState(patientId);
  if (previousPatientId !== patientId) {
    setPreviousPatientId(patientId);
    setShowWorkflow(false);
  }

  return (
    <>
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => setShowWorkflow(true)}
      >
        <FileText className="w-4 h-4 mr-2" />
        Generate Discharge Summary
      </Button>

      {showWorkflow && (
        <DischargeSummaryWorkflow
          key={patientId}
          patientId={patientId}
          onClose={() => setShowWorkflow(false)}
          onComplete={() => {
            setShowWorkflow(false);
            onComplete?.();
          }}
        />
      )}
    </>
  );
}