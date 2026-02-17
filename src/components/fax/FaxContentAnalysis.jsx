import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, ChevronDown, ChevronUp, Copy, MessageSquare, Users, HeartPulse, FolderOpen } from "lucide-react";
import { toast } from "sonner";

export default function FaxContentAnalysis({ faxId, existingAnalysis }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(existingAnalysis || null);
  const [expanded, setExpanded] = useState(true);
  const [analysisType, setAnalysisType] = useState('full');

  const analyze = async (type) => {
    setLoading(true);
    setAnalysisType(type);

    const { data } = await base44.functions.invoke('analyzeFaxContent', {
      fax_log_id: faxId,
      analysis_type: type
    });

    if (data?.success) {
      setAnalysis(data);
      toast.success("Analysis complete");
    } else {
      toast.error(data?.error || "Analysis failed");
    }
    setLoading(false);
  };

  const URGENCY_STYLES = {
    critical: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-green-100 text-green-700"
  };

  const SENTIMENT_STYLES = {
    urgent_demand: { bg: "bg-red-100 text-red-700", label: "Urgent Demand", icon: "🔴" },
    concerned: { bg: "bg-amber-100 text-amber-700", label: "Concerned", icon: "⚠️" },
    informational: { bg: "bg-blue-100 text-blue-700", label: "Informational", icon: "ℹ️" },
    request: { bg: "bg-purple-100 text-purple-700", label: "Request", icon: "📋" },
    follow_up: { bg: "bg-slate-100 text-slate-700", label: "Follow-Up", icon: "🔄" },
    escalation: { bg: "bg-orange-100 text-orange-700", label: "Escalation", icon: "⬆️" },
    positive: { bg: "bg-green-100 text-green-700", label: "Positive", icon: "✅" }
  };

  const AGENCY_CATEGORY_LABELS = {
    patient_care: { label: "Patient Care", color: "bg-blue-100 text-blue-700" },
    referrals_intake: { label: "Referrals & Intake", color: "bg-purple-100 text-purple-700" },
    billing_insurance: { label: "Billing / Insurance", color: "bg-emerald-100 text-emerald-700" },
    compliance_regulatory: { label: "Compliance", color: "bg-red-100 text-red-700" },
    lab_diagnostics: { label: "Lab / Diagnostics", color: "bg-cyan-100 text-cyan-700" },
    physician_orders: { label: "Physician Orders", color: "bg-indigo-100 text-indigo-700" },
    discharge_transfer: { label: "Discharge / Transfer", color: "bg-orange-100 text-orange-700" },
    supplies_equipment: { label: "Supplies / DME", color: "bg-teal-100 text-teal-700" },
    scheduling_coordination: { label: "Scheduling", color: "bg-yellow-100 text-yellow-700" },
    general_administrative: { label: "Administrative", color: "bg-slate-100 text-slate-700" }
  };

  if (!analysis && !loading) {
    return (
      <div className="flex gap-1.5 flex-wrap mt-2">
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => analyze('full')}>
          <Brain className="w-3 h-3" /> AI Analysis
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => analyze('reply')}>
          <MessageSquare className="w-3 h-3" /> Draft Reply
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => analyze('contacts')}>
          <Users className="w-3 h-3" /> Suggest Contacts
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 mt-2 p-2 bg-blue-50 rounded-lg">
        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
        <span className="text-xs text-blue-700">Analyzing fax content...</span>
      </div>
    );
  }

  return (
    <div className="mt-2 border border-blue-100 rounded-lg p-2 bg-blue-50/50 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-blue-500" />
          <span className="text-[10px] font-semibold text-blue-700">AI Analysis</span>
          {analysis.urgency && (
            <Badge className={`text-[8px] px-1 py-0 ${URGENCY_STYLES[analysis.urgency] || ""}`}>
              {analysis.urgency}
            </Badge>
          )}
          {analysis.category && (
            <Badge className="text-[8px] px-1 py-0 bg-slate-100 text-slate-600">
              {analysis.category}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 text-xs">
          {analysis.summary && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Summary</p>
              <p className="text-slate-700">{analysis.summary.topic}</p>
              {analysis.summary.key_points?.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-slate-600">
                  {analysis.summary.key_points.map((p, i) => (
                    <li key={i} className="text-[10px]">• {p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {analysis.summary?.action_items?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Action Items</p>
              <ul className="space-y-0.5">
                {analysis.summary.action_items.map((a, i) => (
                  <li key={i} className="text-[10px] text-amber-700">→ {a}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.reply_draft && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[10px] font-semibold text-slate-500">Reply Draft</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[9px] gap-0.5"
                  onClick={() => {
                    navigator.clipboard.writeText(analysis.reply_draft);
                    toast.success("Reply copied");
                  }}
                >
                  <Copy className="w-2.5 h-2.5" /> Copy
                </Button>
              </div>
              <p className="text-[10px] text-slate-600 bg-white rounded p-2 border">{analysis.reply_draft}</p>
            </div>
          )}

          {analysis.suggested_contacts?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Suggested Contacts</p>
              {analysis.suggested_contacts.map((c, i) => (
                <div key={i} className="text-[10px] text-slate-600">
                  <span className="font-medium">{c.name}</span> — {c.reason}
                </div>
              ))}
            </div>
          )}

          {analysis.alerts?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-600 mb-0.5">Alerts</p>
              {analysis.alerts.map((a, i) => (
                <div key={i} className="text-[10px] text-red-600 bg-red-50 rounded p-1.5">
                  {a.message}
                </div>
              ))}
            </div>
          )}

          <Button variant="ghost" size="sm" className="text-[10px] h-5" onClick={() => { setAnalysis(null); }}>
            New Analysis
          </Button>
        </div>
      )}
    </div>
  );
}