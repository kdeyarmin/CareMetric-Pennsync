import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain, Loader2, FileText, ClipboardCheck, BarChart3,
  ChevronDown, ChevronUp, Sparkles, AlertTriangle,
  CheckCircle2, TrendingUp, TrendingDown, Minus, RefreshCw, Copy,
  ShieldAlert, Stethoscope
} from "lucide-react";
import { toast } from "sonner";
import HistorySummaryView from "./assistant/HistorySummaryView";
import DraftNoteView from "./assistant/DraftNoteView";
import AssessmentSuggestionsView from "./assistant/AssessmentSuggestionsView";
import QualityFeedbackView from "./assistant/QualityFeedbackView";
import DrugInteractionView from "./assistant/DrugInteractionView";
import DiagnosticReferralView from "./assistant/DiagnosticReferralView";

export default function AIClinicalAssistantPanel({
  patientId,
  patientName,
  noteContent,
  visitType,
  diagnosis,
  providerType,
  careSetting,
  vitalSigns,
  onInsertDraft,
  onApplyFix,
}) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState("history");
  const [loading, setLoading] = useState({});
  const [results, setResults] = useState({});

  const callAssistant = async (action, extraParams = {}) => {
    setLoading(prev => ({ ...prev, [action]: true }));
    const { data } = await base44.functions.invoke("aiClinicalAssistant", {
      action,
      patient_id: patientId,
      note_content: noteContent,
      visit_type: visitType,
      diagnosis,
      provider_type: providerType,
      care_setting: careSetting,
      vital_signs: vitalSigns,
      ...extraParams,
    });
    setResults(prev => ({ ...prev, [action]: data.data }));
    setLoading(prev => ({ ...prev, [action]: false }));
    return data.data;
  };

  const tabConfig = [
    { id: "history", label: "History", icon: FileText, action: "summarize_history", needsPatient: true },
    { id: "draft", label: "Draft", icon: Sparkles, action: "generate_draft_note", needsPatient: false },
    { id: "assess", label: "Assess", icon: ClipboardCheck, action: "suggest_assessments", needsPatient: false },
    { id: "drugs", label: "Drugs", icon: ShieldAlert, action: "drug_interaction_check", needsPatient: true },
    { id: "dx_ref", label: "Dx/Ref", icon: Stethoscope, action: "diagnostic_referral_suggestions", needsPatient: false },
    { id: "quality", label: "Quality", icon: BarChart3, action: "quality_feedback", needsNote: true },
  ];

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    const tab = tabConfig.find(t => t.id === tabId);
    if (tab && !results[tab.action] && !loading[tab.action]) {
      if (tab.needsPatient && !patientId) return;
      if (tab.needsNote && (!noteContent || noteContent.length < 20)) return;
      callAssistant(tab.action);
    }
  };

  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-indigo-500" />
            AI Clinical Assistant
            {patientName && (
              <Badge variant="outline" className="text-[10px] font-normal">{patientName}</Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 sm:p-4 pt-0">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full grid grid-cols-6 h-8">
              {tabConfig.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="text-[10px] sm:text-xs gap-1 px-1 data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-800"
                  disabled={
                    (tab.needsPatient && !patientId) ||
                    (tab.needsNote && (!noteContent || noteContent.length < 20))
                  }
                >
                  <tab.icon className="w-3 h-3" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {/* History Summary */}
            <TabsContent value="history" className="mt-3">
              {!patientId ? (
                <EmptyTab message="Select a patient to view history summary" />
              ) : loading.summarize_history ? (
                <LoadingView label="Summarizing patient history..." />
              ) : results.summarize_history ? (
                <HistorySummaryView data={results.summarize_history} onRefresh={() => callAssistant("summarize_history")} />
              ) : (
                <ActionPrompt
                  label="Summarize this patient's medical history"
                  onClick={() => callAssistant("summarize_history")}
                />
              )}
            </TabsContent>

            {/* Draft Note */}
            <TabsContent value="draft" className="mt-3">
              {loading.generate_draft_note ? (
                <LoadingView label="Generating draft clinical note..." />
              ) : results.generate_draft_note ? (
                <DraftNoteView
                  data={results.generate_draft_note}
                  onInsert={onInsertDraft}
                  onRefresh={() => callAssistant("generate_draft_note")}
                />
              ) : (
                <ActionPrompt
                  label={`Generate a ${visitType || 'clinical'} note draft${diagnosis ? ` for ${diagnosis}` : ''}`}
                  onClick={() => callAssistant("generate_draft_note")}
                />
              )}
            </TabsContent>

            {/* Assessment Suggestions */}
            <TabsContent value="assess" className="mt-3">
              {loading.suggest_assessments ? (
                <LoadingView label="Analyzing assessment needs..." />
              ) : results.suggest_assessments ? (
                <AssessmentSuggestionsView
                  data={results.suggest_assessments}
                  onRefresh={() => callAssistant("suggest_assessments")}
                />
              ) : (
                <ActionPrompt
                  label="Get OASIS & assessment suggestions"
                  onClick={() => callAssistant("suggest_assessments")}
                />
              )}
            </TabsContent>

            {/* Drug Interactions */}
            <TabsContent value="drugs" className="mt-3">
              {!patientId ? (
                <EmptyTab message="Select a patient to check drug interactions" />
              ) : loading.drug_interaction_check ? (
                <LoadingView label="Analyzing medications for interactions..." />
              ) : results.drug_interaction_check ? (
                <DrugInteractionView data={results.drug_interaction_check} onRefresh={() => callAssistant("drug_interaction_check")} />
              ) : (
                <ActionPrompt
                  label="Check drug interactions & contraindications"
                  onClick={() => callAssistant("drug_interaction_check")}
                />
              )}
            </TabsContent>

            {/* Diagnostic & Referral Suggestions */}
            <TabsContent value="dx_ref" className="mt-3">
              {loading.diagnostic_referral_suggestions ? (
                <LoadingView label="Analyzing for diagnostic tests & referrals..." />
              ) : results.diagnostic_referral_suggestions ? (
                <DiagnosticReferralView data={results.diagnostic_referral_suggestions} onRefresh={() => callAssistant("diagnostic_referral_suggestions")} />
              ) : (
                <ActionPrompt
                  label="Get diagnostic test & referral suggestions"
                  onClick={() => callAssistant("diagnostic_referral_suggestions")}
                />
              )}
            </TabsContent>

            {/* Quality Feedback */}
            <TabsContent value="quality" className="mt-3">
              {!noteContent || noteContent.length < 20 ? (
                <EmptyTab message="Write at least 20 characters of clinical notes to get quality feedback" />
              ) : loading.quality_feedback ? (
                <LoadingView label="Analyzing documentation quality..." />
              ) : results.quality_feedback ? (
                <QualityFeedbackView
                  data={results.quality_feedback}
                  onApplyFix={onApplyFix}
                  onRefresh={() => callAssistant("quality_feedback")}
                />
              ) : (
                <ActionPrompt
                  label="Analyze note quality & completeness"
                  onClick={() => callAssistant("quality_feedback")}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

function EmptyTab({ message }) {
  return (
    <div className="text-center py-6 text-slate-400">
      <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
      <p className="text-[11px]">{message}</p>
    </div>
  );
}

function LoadingView({ label }) {
  return (
    <div className="text-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto mb-2" />
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function ActionPrompt({ label, onClick }) {
  return (
    <div className="text-center py-6">
      <Button size="sm" onClick={onClick} className="bg-indigo-600 hover:bg-indigo-700 text-xs">
        <Sparkles className="w-3 h-3 mr-1" />
        {label}
      </Button>
    </div>
  );
}