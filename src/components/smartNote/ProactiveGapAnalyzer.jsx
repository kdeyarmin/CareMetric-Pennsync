import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, ShieldAlert, ChevronDown, ChevronUp, Zap, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function ProactiveGapAnalyzer({ patient, visitType, diagnosis, roughNotes, vitalSigns, providerType, careSetting, onResolveGap }) {
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [resolvedIds, setResolvedIds] = useState(new Set());
  const lastAnalyzedRef = useRef("");

  // Auto-analyze when notes change significantly (debounced)
  useEffect(() => {
    if (!roughNotes || roughNotes.length < 80 || !visitType || !diagnosis) return;
    // Only re-analyze when content changes by at least 100 chars
    if (Math.abs(roughNotes.length - lastAnalyzedRef.current.length) < 100 && lastAnalyzedRef.current) return;

    const timer = setTimeout(() => {
      analyze();
      lastAnalyzedRef.current = roughNotes;
    }, 3000);
    return () => clearTimeout(timer);
  }, [roughNotes, visitType, diagnosis]);

  const analyze = async () => {
    setLoading(true);

    const conditions = [patient?.primary_diagnosis, ...(patient?.secondary_diagnoses || [])].filter(Boolean);
    const meds = (patient?.current_medications || []).map(m => `${m.name} ${m.dosage || ""}`).filter(Boolean);
    const vitalsStr = Object.entries(vitalSigns || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a Medicare/Medicaid compliance documentation auditor for home health.

VISIT TYPE: ${visitType}
PROVIDER: ${providerType}
CARE SETTING: ${careSetting || "home_health"}
DIAGNOSIS: ${diagnosis}
PATIENT: ${patient?.first_name || "Unknown"} ${patient?.last_name || ""}
CONDITIONS: ${conditions.join(", ")}
MEDICATIONS: ${meds.join("; ")}
VITAL SIGNS ENTERED: ${vitalsStr || "None"}
FUNCTIONAL STATUS: ${JSON.stringify(patient?.functional_status || {})}

CURRENT NOTE CONTENT:
${roughNotes}

Analyze the current documentation and identify specific gaps that could cause:
1. Medicare claim denial
2. Compliance audit failure
3. Missing required elements for this visit type
4. Clinical safety concerns not addressed
5. Missing assessments based on patient's conditions

For each gap, provide the specific text that should be added. Be very specific — not generic. 
Only flag TRUE gaps — items NOT already covered in the note.
Limit to the 5 most critical gaps.`,
      response_json_schema: {
        type: "object",
        properties: {
          gaps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                element: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium"] },
                reason: { type: "string" },
                category: { type: "string", enum: ["medicare_required", "compliance", "clinical_safety", "assessment", "documentation"] },
                suggested_text: { type: "string" }
              }
            }
          },
          overall_completeness: { type: "number" }
        }
      }
    });
    setGaps(res.gaps || []);
    setLoading(false);
  };

  const handleResolve = (gap, idx) => {
    onResolveGap(gap.suggested_text);
    setResolvedIds(prev => new Set(prev).add(idx));
    toast.success(`Added: ${gap.element}`);
  };

  const SEVERITY_STYLES = {
    critical: "bg-red-100 text-red-700 border-red-200",
    high: "bg-orange-100 text-orange-700 border-orange-200",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
  };

  const CATEGORY_ICONS = {
    medicare_required: "🏥",
    compliance: "📋",
    clinical_safety: "⚠️",
    assessment: "🔍",
    documentation: "📝",
  };

  if (!visitType || !diagnosis) return null;

  const unresolvedCount = gaps ? gaps.filter((_, i) => !resolvedIds.has(i)).length : 0;

  return (
    <Card className={`border-amber-200/60 ${gaps && unresolvedCount > 0 ? "ring-1 ring-amber-200" : ""}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            Documentation Gap Detection
            {loading && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
          </div>
          <div className="flex items-center gap-1">
            {gaps && unresolvedCount > 0 && (
              <Badge className="bg-amber-100 text-amber-700 text-[9px]">{unresolvedCount} gap{unresolvedCount !== 1 ? "s" : ""}</Badge>
            )}
            {gaps && unresolvedCount === 0 && gaps.length > 0 && (
              <Badge className="bg-green-100 text-green-700 text-[9px]">All resolved</Badge>
            )}
            {gaps && (
              <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}
          </div>
        </div>

        {!gaps && !loading && roughNotes && roughNotes.length >= 80 && (
          <p className="text-[10px] text-slate-400">Analyzing documentation completeness...</p>
        )}

        {!gaps && !loading && (!roughNotes || roughNotes.length < 80) && (
          <p className="text-[10px] text-slate-400">Start typing notes to detect documentation gaps</p>
        )}

        {gaps && expanded && (
          <div className="space-y-1.5">
            {gaps.length === 0 && (
              <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <p className="text-xs text-green-700">No critical gaps detected — documentation looks complete for this visit type.</p>
              </div>
            )}
            {gaps.map((gap, i) => (
              <div key={i} className={`p-2 rounded-lg border text-xs transition-all ${resolvedIds.has(i) ? "bg-green-50 border-green-200 opacity-60" : SEVERITY_STYLES[gap.severity] || "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span>{CATEGORY_ICONS[gap.category] || "📝"}</span>
                      <span className="font-medium text-slate-800">{gap.element}</span>
                      <Badge className={`${gap.severity === "critical" ? "bg-red-500 text-white" : gap.severity === "high" ? "bg-orange-500 text-white" : "bg-amber-200 text-amber-800"} text-[8px] px-1 py-0`}>
                        {gap.severity}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-slate-500">{gap.reason}</p>
                  </div>
                  {!resolvedIds.has(i) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1 flex-shrink-0 border-amber-300 hover:bg-amber-50"
                      onClick={() => handleResolve(gap, i)}
                    >
                      <Zap className="w-2.5 h-2.5" /> Fix
                    </Button>
                  )}
                  {resolvedIds.has(i) && (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  )}
                </div>
              </div>
            ))}
            <Button onClick={() => { setGaps(null); setResolvedIds(new Set()); lastAnalyzedRef.current = ""; analyze(); }} variant="ghost" size="sm" className="text-[10px] h-6">
              Re-analyze
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}