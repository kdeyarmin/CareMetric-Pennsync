import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ShieldCheck, CheckCircle2, AlertTriangle, XCircle, 
  ChevronDown, ChevronUp, ArrowRight 
} from "lucide-react";
import { toast } from "sonner";

const CATEGORY_ICONS = {
  medication: "💊",
  diagnosis: "🩺",
  procedure: "🔧",
  anatomy: "🦴",
  vital_sign: "❤️",
  abbreviation: "📝",
};

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-red-100 text-red-800 border-red-300",
};

export default function MedicalTermCorrector({
  corrections = [],
  safetyAlerts = [],
  accuracyScore,
  confidenceSummary,
  onApplyCorrection,
  onApplyAll,
  transcription = ""
}) {
  const [expanded, setExpanded] = useState(true);
  const [appliedCorrections, setAppliedCorrections] = useState(new Set());

  if (corrections.length === 0 && safetyAlerts.length === 0) return null;

  const handleApplySingle = (correction, idx) => {
    if (onApplyCorrection) {
      onApplyCorrection(correction);
      setAppliedCorrections(prev => new Set([...prev, idx]));
      toast.success(`Corrected: "${correction.original}" → "${correction.corrected}"`);
    }
  };

  const handleApplyAll = () => {
    const unapplied = corrections.filter((_, idx) => !appliedCorrections.has(idx));
    if (onApplyAll && unapplied.length > 0) {
      onApplyAll(unapplied);
      setAppliedCorrections(new Set(corrections.map((_, idx) => idx)));
      toast.success(`Applied ${unapplied.length} correction${unapplied.length > 1 ? 's' : ''}`);
    }
  };

  const highConfidence = corrections.filter(c => c.confidence === 'high');
  const safetyCritical = corrections.filter(c => c.is_safety_concern);

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            Medical Term Verification
            {accuracyScore && (
              <Badge className={accuracyScore >= 90 ? "bg-green-600" : accuracyScore >= 75 ? "bg-yellow-600" : "bg-red-600"}>
                {accuracyScore}% accuracy
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {corrections.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleApplyAll}
                disabled={appliedCorrections.size === corrections.length}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Apply All ({corrections.length - appliedCorrections.size})
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Confidence summary */}
        {confidenceSummary && (
          <div className="flex gap-2 mt-2">
            {confidenceSummary.high_confidence > 0 && (
              <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">
                {confidenceSummary.high_confidence} high confidence
              </Badge>
            )}
            {confidenceSummary.medium_confidence > 0 && (
              <Badge variant="outline" className="text-[10px] border-yellow-300 text-yellow-700">
                {confidenceSummary.medium_confidence} medium
              </Badge>
            )}
            {confidenceSummary.low_confidence > 0 && (
              <Badge variant="outline" className="text-[10px] border-red-300 text-red-700">
                {confidenceSummary.low_confidence} low
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {/* Safety Alerts */}
          {safetyAlerts.length > 0 && (
            <div className="space-y-2">
              {safetyAlerts.map((alert, idx) => (
                <Alert key={idx} className="bg-red-50 border-red-300">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <AlertDescription>
                    <span className="font-semibold text-red-800 text-xs">
                      ⚠️ {alert.alert_type}:
                    </span>{' '}
                    <span className="text-xs text-red-700">{alert.description}</span>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {/* Safety-critical corrections first */}
          {safetyCritical.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">
                Safety-Critical Corrections
              </p>
              {safetyCritical.map((correction, idx) => {
                const globalIdx = corrections.indexOf(correction);
                const isApplied = appliedCorrections.has(globalIdx);
                return (
                  <CorrectionRow
                    key={`safety-${idx}`}
                    correction={correction}
                    isApplied={isApplied}
                    onApply={() => handleApplySingle(correction, globalIdx)}
                    isSafety
                  />
                );
              })}
            </div>
          )}

          {/* Regular corrections */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {corrections.filter(c => !c.is_safety_concern).map((correction, idx) => {
              const globalIdx = corrections.indexOf(correction);
              const isApplied = appliedCorrections.has(globalIdx);
              return (
                <CorrectionRow
                  key={idx}
                  correction={correction}
                  isApplied={isApplied}
                  onApply={() => handleApplySingle(correction, globalIdx)}
                />
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function CorrectionRow({ correction, isApplied, onApply, isSafety = false }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
      isApplied ? "bg-green-50 border-green-200 opacity-60" :
      isSafety ? "bg-red-50 border-red-200" :
      "bg-slate-50 border-slate-200"
    }`}>
      <span className="text-base flex-shrink-0">
        {CATEGORY_ICONS[correction.category] || "📋"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="line-through text-red-600 font-mono">{correction.original}</span>
          <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
          <span className="text-green-700 font-semibold font-mono">{correction.corrected}</span>
          <Badge className={`text-[9px] h-4 ${CONFIDENCE_COLORS[correction.confidence] || CONFIDENCE_COLORS.low}`}>
            {correction.confidence}
          </Badge>
        </div>
        {correction.context && (
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{correction.context}</p>
        )}
      </div>
      {!isApplied && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] flex-shrink-0"
          onClick={onApply}
        >
          Apply
        </Button>
      )}
      {isApplied && (
        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
      )}
    </div>
  );
}