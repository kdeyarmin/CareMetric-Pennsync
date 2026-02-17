import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function VitalSignsQuickButton({ patientId, onApply }) {
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: async () => {
      if (!patientId) return [];
      const visits = await base44.entities.Visit.filter({ patient_id: patientId });
      return visits.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date)).slice(0, 5);
    },
    enabled: !!patientId && patientId !== 'anonymous',
  });

  const lastVitals = recentVisits[0]?.vital_signs;

  if (!lastVitals) return null;

  const handleCopyVitals = () => {
    const vitalsText = `BP: ${lastVitals.blood_pressure || 'N/A'}, HR: ${lastVitals.heart_rate || 'N/A'}, Temp: ${lastVitals.temperature || 'N/A'}°F, RR: ${lastVitals.respiratory_rate || 'N/A'}, O2: ${lastVitals.oxygen_saturation || 'N/A'}%`;
    
    if (onApply) {
      onApply(lastVitals);
    }
    
    toast.success('Vital signs copied from last visit');
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopyVitals}
      className="w-full text-xs h-9 border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900"
    >
      <Copy className="w-3 h-3 mr-1" />
      Copy Last Vitals
    </Button>
  );
}