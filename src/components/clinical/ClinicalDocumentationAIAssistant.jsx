import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Code2, ClipboardCheck, CheckCircle2, AlertTriangle,
  Loader2, ChevronDown, ChevronUp, Zap, Copy, Check, FileText
} from "lucide-react";
import { toast } from "sonner";

// ── Sub-panel: ICD-10 / Medical Code Suggestions ───────────────────────────
function CodeSuggestionsPanel({ noteContent, diagnosis, visitType, onCodesSelected }) {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [ran, setRan] = useState(false);

  const run = async () => {
    if (!noteContent?.trim()) { toast.error("Add clinical notes first"); return; }
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical coding expert. Based on the clinical note below, suggest the most relevant ICD-10-CM codes.

Visit Type: ${visitType || "N/A"}
Primary Diagnosis: ${diagnosis || "N/A"}
Clinical Note:
${noteContent.substring(0, 1500)}

Return JSON with the most relevant codes. Include primary diagnosis code, relevant comorbidity codes, and procedure/symptom codes.`,
        response_json_schema: {
          type: "object",
          properties: {
            codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  type: { type: "string" },
                  confidence: { type: "number" }
                }
              }
            }
          }
        }
      });
      setCodes(res.codes || []);
      setRan(true);
    } catch (e) {
      toast.error("Failed to suggest codes");
    } finally {
      setLoading(false);
    }
  };

  const toggleCode = (code) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const applySelected = () => {
    const selectedCodes = codes.filter(c => selected.has(c.code));
    onCodesSelected?.(selectedCodes);
    toast.success(`${selectedCodes.length} code(s) applied`);
  };

  const typeColor = (type) => ({
    primary: "bg-blue-100 text-blue-800",
    secondary: "bg-purple-100 text-purple-800",
    symptom: "bg-yellow-100 text-yellow-700",
    procedure: "bg-green-100 text-green-800",
  }[type] || "bg-slate-100 text-slate-700");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Auto-detect ICD-10 codes from your clinical notes</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
          {ran ? "Re-Analyze" : "Suggest Codes"}
        </Button>
      </div>

      {ran && codes.length > 0 && (
        <>
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {codes.map((c, i) => (
              <div
                key={i}
                onClick={() => toggleCode(c.code)}
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  selected.has(c.code) ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${selected.has(c.code) ? "bg-blue-600 border-blue-600" : "border-slate-300"}`}>
                  {selected.has(c.code) && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-800">{c.code}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 ${typeColor(c.type)}`}>{c.type}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 truncate">{c.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-slate-500">{Math.round((c.confidence || 0.8) * 100)}%</p>
                </div>
              </div>
            ))}
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={applySelected} className="w-full bg-blue-600 hover:bg-blue-700 h-8 text-xs">
              Apply {selected.size} Code{selected.size > 1 ? "s" : ""}
            </Button>
          )}
        </>
      )}

      {ran && codes.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-4">No codes identified — add more clinical detail</p>
      )}
    </div>
  );
}

// ── Sub-panel: Auto-Populate Form Fields ───────────────────────────────────
function AutoPopulatePanel({ noteContent, visitType, diagnosis, patientData, onFieldsPopulated }) {
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState(null);
  const [copied, setCopied] = useState({});

  const run = async () => {
    if (!noteContent?.trim()) { toast.error("Add clinical notes first"); return; }
    setLoading(true);
    try {
      const patCtx = patientData
        ? `Patient: ${patientData.first_name} ${patientData.last_name}, DOB: ${patientData.date_of_birth || "N/A"}, Primary Dx: ${patientData.primary_diagnosis || "N/A"}`
        : "";

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical documentation specialist. Extract and structure the following fields from the clinical note.

${patCtx}
Visit Type: ${visitType || "N/A"}
Primary Diagnosis: ${diagnosis || "N/A"}

Clinical Note:
${noteContent.substring(0, 1500)}

Extract structured form fields for standard clinical documentation.`,
        response_json_schema: {
          type: "object",
          properties: {
            chief_complaint: { type: "string" },
            subjective: { type: "string" },
            objective: { type: "string" },
            assessment: { type: "string" },
            plan: { type: "string" },
            vital_signs_summary: { type: "string" },
            medications_mentioned: { type: "array", items: { type: "string" } },
            follow_up_needed: { type: "string" },
            homebound_status: { type: "string" }
          }
        }
      });

      setFields(res);
      onFieldsPopulated?.(res);
      toast.success("Fields extracted from notes");
    } catch (e) {
      toast.error("Failed to extract fields");
    } finally {
      setLoading(false);
    }
  };

  const copyField = (key, value) => {
    navigator.clipboard.writeText(value);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 1500);
  };

  const FIELD_LABELS = {
    chief_complaint: "Chief Complaint",
    subjective: "Subjective (S)",
    objective: "Objective (O)",
    assessment: "Assessment (A)",
    plan: "Plan (P)",
    vital_signs_summary: "Vitals Summary",
    follow_up_needed: "Follow-Up",
    homebound_status: "Homebound Status"
  };

  const textFields = Object.keys(FIELD_LABELS).filter(k => fields?.[k]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Auto-extract SOAP fields and form data from notes</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-purple-600 hover:bg-purple-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ClipboardCheck className="w-3 h-3 mr-1" />}
          {fields ? "Re-Extract" : "Auto-Populate"}
        </Button>
      </div>

      {fields && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {textFields.map((key) => (
            <div key={key} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{FIELD_LABELS[key]}</span>
                <button onClick={() => copyField(key, fields[key])} className="text-slate-400 hover:text-blue-600 transition-colors">
                  {copied[key] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{fields[key]}</p>
            </div>
          ))}

          {fields.medications_mentioned?.length > 0 && (
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Medications Mentioned</span>
              <div className="flex flex-wrap gap-1">
                {fields.medications_mentioned.map((med, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{med}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-panel: Compliance Checker ──────────────────────────────────────────
function CompliancePanel({ noteContent, visitType, diagnosis, providerType }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!noteContent?.trim()) { toast.error("Add clinical notes first"); return; }
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a home health compliance expert. Analyze this clinical note for documentation compliance issues.

Provider: ${providerType || "RN"}
Visit Type: ${visitType || "N/A"}
Diagnosis: ${diagnosis || "N/A"}

Clinical Note:
${noteContent.substring(0, 1500)}

Check for: Medicare/Medicaid compliance, homebound status documentation, skilled need justification, care plan alignment, required elements for visit type, and documentation completeness.`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_score: { type: "number" },
            status: { type: "string" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string" },
                  category: { type: "string" },
                  issue: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } },
            summary: { type: "string" }
          }
        }
      });
      setResult(res);
    } catch (e) {
      toast.error("Compliance check failed");
    } finally {
      setLoading(false);
    }
  };

  const severityColor = (s) => ({
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-blue-100 text-blue-800 border-blue-200"
  }[s] || "bg-slate-100 text-slate-700 border-slate-200");

  const scoreColor = (score) => {
    if (score >= 85) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Check Medicare, HIPAA & documentation compliance</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-green-600 hover:bg-green-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
          {result ? "Re-Check" : "Check Compliance"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          {/* Score */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <div className="text-center">
              <p className={`text-2xl font-bold ${scoreColor(result.compliance_score)}`}>{result.compliance_score}%</p>
              <p className="text-[10px] text-slate-500">Compliance</p>
            </div>
            <div className="flex-1">
              <Progress value={result.compliance_score} className="h-2 mb-1" />
              <p className="text-xs text-slate-600">{result.summary}</p>
            </div>
          </div>

          {/* Issues */}
          {result.issues?.length > 0 && (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Issues Found ({result.issues.length})</p>
              {result.issues.map((issue, i) => (
                <div key={i} className={`p-2.5 rounded-lg border ${severityColor(issue.severity)}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="text-[10px] font-semibold uppercase">{issue.severity}</span>
                    <span className="text-[10px] opacity-70">· {issue.category}</span>
                  </div>
                  <p className="text-xs font-medium">{issue.issue}</p>
                  {issue.recommendation && (
                    <p className="text-[10px] mt-1 opacity-80">→ {issue.recommendation}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Strengths */}
          {result.strengths?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Strengths</p>
              {result.strengths.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-green-700">
                  <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────
export default function ClinicalDocumentationAIAssistant({
  noteContent,
  visitType,
  diagnosis,
  providerType,
  patientData,
  onCodesSelected,
  onFieldsPopulated
}) {
  const [activeTab, setActiveTab] = useState("codes");
  const [expanded, setExpanded] = useState(true);

  const TABS = [
    { id: "codes", label: "Code Suggestions", icon: Code2, color: "text-blue-600" },
    { id: "populate", label: "Auto-Populate", icon: ClipboardCheck, color: "text-purple-600" },
    { id: "compliance", label: "Compliance Check", icon: CheckCircle2, color: "text-green-600" }
  ];

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader
        className="p-3 bg-gradient-to-r from-slate-800 to-slate-900 rounded-t-xl cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-400" />
            <CardTitle className="text-sm text-white font-semibold">Clinical Documentation AI Assistant</CardTitle>
            <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">3 Tools</Badge>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Tab Bar */}
          <div className="flex border-b border-slate-200">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? `border-current ${tab.color} bg-slate-50`
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5 hidden sm:block" />
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-3">
            {!noteContent?.trim() && (
              <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                <FileText className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">Enter clinical notes above to enable AI analysis</p>
              </div>
            )}

            {activeTab === "codes" && (
              <CodeSuggestionsPanel
                noteContent={noteContent}
                diagnosis={diagnosis}
                visitType={visitType}
                onCodesSelected={onCodesSelected}
              />
            )}
            {activeTab === "populate" && (
              <AutoPopulatePanel
                noteContent={noteContent}
                visitType={visitType}
                diagnosis={diagnosis}
                patientData={patientData}
                onFieldsPopulated={onFieldsPopulated}
              />
            )}
            {activeTab === "compliance" && (
              <CompliancePanel
                noteContent={noteContent}
                visitType={visitType}
                diagnosis={diagnosis}
                providerType={providerType}
              />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}