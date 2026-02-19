import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function MultiRegulationComplianceChecker({
  noteContent,
  visitType,
  regulations = ['medicare', 'hipaa', 'clia'],
  onComplianceAnalyzed
}) {
  const [isChecking, setIsChecking] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [selectedRegs, setSelectedRegs] = useState(regulations);
  const [lastCheckTime, setLastCheckTime] = useState(null);

  const AVAILABLE_REGULATIONS = [
    { id: 'medicare', name: 'Medicare (42 CFR 484)', color: 'bg-blue-100 text-blue-800' },
    { id: 'hipaa', name: 'HIPAA Security & Privacy', color: 'bg-green-100 text-green-800' },
    { id: 'clia', name: 'CLIA Lab Standards', color: 'bg-purple-100 text-purple-800' },
    { id: 'jcaho', name: 'Joint Commission', color: 'bg-orange-100 text-orange-800' }
  ];

  const checkCompliance = async () => {
    if (!noteContent || noteContent.length < 50) {
      toast.error("Please enter clinical note content");
      return;
    }

    setIsChecking(true);
    try {
      const result = await base44.functions.invoke('multiRegulationComplianceCheck', {
        note_content: noteContent,
        visit_type: visitType,
        regulations: selectedRegs
      });

      if (result?.data?.success) {
        setAnalysis(result.data.analysis);
        setLastCheckTime(new Date());
        onComplianceAnalyzed?.(result.data);
        toast.success("Compliance check complete");
      } else {
        toast.error("Compliance check failed");
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
      console.error(error);
    } finally {
      setIsChecking(false);
    }
  };

  // Auto-check on content change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (noteContent && noteContent.length > 100) {
        checkCompliance();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [noteContent]);

  return (
    <Card className="border-amber-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Shield className="w-4 h-4 text-amber-600" />
          Multi-Regulation Compliance
        </CardTitle>
        <p className="text-xs text-slate-600 mt-2">
          Real-time compliance checks across multiple healthcare regulations
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Regulation Selection */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Check Against:</p>
          <div className="space-y-1.5">
            {AVAILABLE_REGULATIONS.map(reg => (
              <label key={reg.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedRegs.includes(reg.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedRegs([...selectedRegs, reg.id]);
                    } else {
                      setSelectedRegs(selectedRegs.filter(r => r !== reg.id));
                    }
                  }}
                />
                <span className="text-xs text-slate-600">{reg.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Analysis Results */}
        {analysis && (
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs max-h-48 overflow-y-auto">
            {analysis.substring(0, 500)}...
          </div>
        )}

        {/* Status */}
        {isChecking && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            Checking regulations...
          </div>
        )}

        {lastCheckTime && (
          <div className="text-xs text-slate-500">
            Last checked: {lastCheckTime.toLocaleTimeString()}
          </div>
        )}

        {/* Selected Regulations Display */}
        <div className="flex flex-wrap gap-1.5">
          {selectedRegs.map(regId => {
            const reg = AVAILABLE_REGULATIONS.find(r => r.id === regId);
            return reg ? (
              <Badge key={regId} className={`text-xs ${reg.color}`}>
                {reg.name.split('(')[0].trim()}
              </Badge>
            ) : null;
          })}
        </div>
      </CardContent>
    </Card>
  );
}