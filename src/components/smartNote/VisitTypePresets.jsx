import React from "react";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function VisitTypePresets({ onSelectVisitType, providerType }) {
  const visitTypes = getVisitTypesForProvider(providerType || 'RN');
  
  // Get the most common visit types (assuming standard RN visit is most common)
  const commonVisits = visitTypes.slice(0, 3);

  return (
    <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border border-purple-200 dark:border-purple-900 rounded-lg p-3 sm:p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <p className="text-xs sm:text-sm font-semibold text-purple-900 dark:text-purple-100">Quick Visit Types</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {commonVisits.map((vt) => (
          <Button
            key={vt.id}
            variant="outline"
            size="sm"
            onClick={() => onSelectVisitType(vt.id)}
            className="text-xs h-8 border-purple-300 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900"
            title={vt.description}
          >
            {vt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}