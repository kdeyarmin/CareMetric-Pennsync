import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Code2, ClipboardCheck, CheckCircle2, AlertTriangle,
  Loader2, ChevronDown, ChevronUp, Zap, Copy, Check, FileText,
  Mic, MicOff, Square, Activity, Star, AlertCircle, Shield
} from "lucide-react";
import { toast } from "sonner";

// ── Voice-to-SOAP Tab ───────────────────────────────────────────────────────
function VoiceToSOAPPanel({ visitType, diagnosis, patientData, onSOAPGenerated }) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [soap, setSOAP] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState({});
  const recognitionRef = useRef(null);
  const supported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const startRecording = () => {
    if (!supported) { toast.error("Speech recognition not supported in this browser"); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let full = "";
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript + " ";
      }
      setTranscript(full.trim());
    };
    recognition.onerror = (e) => {
      toast.error("Voice recognition error: " + e.error);
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    toast.info("Recording… speak your clinical notes");
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const generateSOAP = async () => {
    if (!transcript.trim()) { toast.error("Record or type a transcript first"); return; }
    setLoading(true);
    try {
      const patCtx = patientData
        ? `Patient: ${patientData.first_name} ${patientData.last_name}, Primary Dx: ${patientData.primary_diagnosis || "N/A"}`
        : "";
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical documentation specialist. Convert the following voice transcript into a structured SOAP note.

${patCtx}
Visit Type: ${visitType || "N/A"}
Primary Diagnosis: ${diagnosis || "N/A"}

Voice Transcript:
${transcript}

Generate a complete, professional SOAP note with all four sections. Include homebound status and skilled need justification where applicable. Be thorough and clinically precise.`,
        response_json_schema: {
          type: "object",
          properties: {
            subjective: { type: "string" },
            objective: { type: "string" },
            assessment: { type: "string" },
            plan: { type: "string" },
            homebound_status: { type: "string" },
            skilled_need: { type: "string" },
            full_note: { type: "string" }
          }
        }
      });
      setSOAP(res);
      toast.success("SOAP note generated from voice");
    } catch (e) {
      toast.error("Failed to generate SOAP note");
    } finally {
      setLoading(false);
    }
  };

  const copySection = (key, value) => {
    navigator.clipboard.writeText(value);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 1500);
  };

  const SOAP_LABELS = {
    subjective: "S — Subjective",
    objective: "O — Objective",
    assessment: "A — Assessment",
    plan: "P — Plan",
    homebound_status: "Homebound Status",
    skilled_need: "Skilled Need Justification"
  };

  const SOAP_COLORS = {
    subjective: "border-blue-200 bg-blue-50",
    objective: "border-purple-200 bg-purple-50",
    assessment: "border-orange-200 bg-orange-50",
    plan: "border-green-200 bg-green-50",
    homebound_status: "border-slate-200 bg-slate-50",
    skilled_need: "border-indigo-200 bg-indigo-50"
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Dictate notes; AI structures them into SOAP format</p>
        <div className="flex gap-2">
          {!recording ? (
            <Button size="sm" onClick={startRecording} className={`h-8 text-xs ${supported ? "bg-red-600 hover:bg-red-700" : "bg-slate-400"}`}>
              <Mic className="w-3 h-3 mr-1" /> Start Recording
            </Button>
          ) : (
            <Button size="sm" onClick={stopRecording} className="bg-slate-700 hover:bg-slate-800 h-8 text-xs animate-pulse">
              <Square className="w-3 h-3 mr-1" /> Stop
            </Button>
          )}
        </div>
      </div>

      {!supported && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700">⚠️ Voice recording requires Chrome or Edge. You can type your transcript below instead.</p>
        </div>
      )}

      {/* Transcript box */}
      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">
          {recording ? "🔴 Live Transcript" : "Transcript"}
        </label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Your spoken words will appear here, or type your notes directly…"
          className="w-full h-24 p-2.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none bg-white"
        />
      </div>

      <Button
        size="sm"
        onClick={generateSOAP}
        disabled={loading || !transcript.trim()}
        className="w-full bg-indigo-600 hover:bg-indigo-700 h-8 text-xs"
      >
        {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Activity className="w-3 h-3 mr-1" />}
        {soap ? "Re-Generate SOAP" : "Generate SOAP Note"}
      </Button>

      {soap && (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {Object.keys(SOAP_LABELS).filter(k => soap[k]).map(key => (
            <div key={key} className={`p-2.5 rounded-lg border ${SOAP_COLORS[key] || "bg-slate-50 border-slate-200"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{SOAP_LABELS[key]}</span>
                <button onClick={() => copySection(key, soap[key])} className="text-slate-400 hover:text-blue-600">
                  {copied[key] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{soap[key]}</p>
            </div>
          ))}
          <Button
            size="sm"
            className="w-full bg-green-600 hover:bg-green-700 h-8 text-xs mt-1"
            onClick={() => {
              const fullNote = Object.keys(SOAP_LABELS)
                .filter(k => soap[k])
                .map(k => `${SOAP_LABELS[k]}:\n${soap[k]}`)
                .join("\n\n");
              onSOAPGenerated?.(fullNote);
              toast.success("SOAP note transferred to clinical notes");
            }}
          >
            <ClipboardCheck className="w-3 h-3 mr-1" /> Use This SOAP Note
          </Button>
        </div>
      )}
    </div>
  );
}

// ── ICD-10 + CPT Code Suggestions ──────────────────────────────────────────
function CodeSuggestionsPanel({ noteContent, diagnosis, visitType, onCodesSelected }) {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState([]);
  const [cptCodes, setCptCodes] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [ran, setRan] = useState(false);
  const [codeType, setCodeType] = useState("icd10");

  const run = async () => {
    if (!noteContent?.trim()) { toast.error("Add clinical notes first"); return; }
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical coding expert (CPC certified). Analyze this clinical note and suggest relevant ICD-10-CM and CPT codes.

Visit Type: ${visitType || "N/A"}
Primary Diagnosis: ${diagnosis || "N/A"}
Clinical Note:
${noteContent.substring(0, 2000)}

Provide both ICD-10-CM diagnosis codes AND CPT procedure/service codes appropriate for this visit. Include confidence scores. For CPT codes, include the E&M level if applicable.`,
        response_json_schema: {
          type: "object",
          properties: {
            icd10_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  type: { type: "string" },
                  confidence: { type: "number" },
                  rationale: { type: "string" }
                }
              }
            },
            cpt_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  category: { type: "string" },
                  confidence: { type: "number" },
                  rationale: { type: "string" }
                }
              }
            },
            coding_tips: { type: "array", items: { type: "string" } }
          }
        }
      });
      setCodes(res.icd10_codes || []);
      setCptCodes(res.cpt_codes || []);
      setRan(true);
    } catch (e) {
      toast.error("Failed to suggest codes");
    } finally {
      setLoading(false);
    }
  };

  const displayCodes = codeType === "icd10" ? codes : cptCodes;

  const toggleCode = (code) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const applySelected = () => {
    const allCodes = [...codes, ...cptCodes];
    const selectedCodes = allCodes.filter(c => selected.has(c.code));
    onCodesSelected?.(selectedCodes);
    toast.success(`${selectedCodes.length} code(s) applied`);
  };

  const typeColor = (type) => ({
    primary: "bg-blue-100 text-blue-800",
    secondary: "bg-purple-100 text-purple-800",
    symptom: "bg-yellow-100 text-yellow-700",
    comorbidity: "bg-indigo-100 text-indigo-800",
    procedure: "bg-green-100 text-green-800",
    "e&m": "bg-orange-100 text-orange-800",
    service: "bg-teal-100 text-teal-800",
  }[type?.toLowerCase()] || "bg-slate-100 text-slate-700");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">AI-driven ICD-10 & CPT code suggestions</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
          {ran ? "Re-Analyze" : "Suggest Codes"}
        </Button>
      </div>

      {ran && (
        <>
          {/* Code type toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setCodeType("icd10")}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${codeType === "icd10" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              ICD-10 ({codes.length})
            </button>
            <button
              onClick={() => setCodeType("cpt")}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${codeType === "cpt" ? "bg-green-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              CPT ({cptCodes.length})
            </button>
          </div>

          {displayCodes.length > 0 ? (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {displayCodes.map((c, i) => (
                <div
                  key={i}
                  onClick={() => toggleCode(c.code)}
                  className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                    selected.has(c.code) ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 ${selected.has(c.code) ? "bg-blue-600 border-blue-600" : "border-slate-300"}`}>
                    {selected.has(c.code) && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-800">{c.code}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${typeColor(c.type || c.category)}`}>{c.type || c.category}</Badge>
                      <span className="text-[10px] text-slate-400">{Math.round((c.confidence || 0.8) * 100)}% match</span>
                    </div>
                    <p className="text-xs text-slate-700 mt-0.5">{c.description}</p>
                    {c.rationale && <p className="text-[10px] text-slate-500 mt-0.5 italic">{c.rationale}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">No {codeType === "icd10" ? "ICD-10" : "CPT"} codes identified</p>
          )}

          {selected.size > 0 && (
            <Button size="sm" onClick={applySelected} className="w-full bg-blue-600 hover:bg-blue-700 h-8 text-xs">
              Apply {selected.size} Selected Code{selected.size > 1 ? "s" : ""}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Auto-Populate SOAP Fields ───────────────────────────────────────────────
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
        prompt: `You are a clinical documentation specialist. Extract and structure SOAP fields from this clinical note.

${patCtx}
Visit Type: ${visitType || "N/A"}
Primary Diagnosis: ${diagnosis || "N/A"}

Clinical Note:
${noteContent.substring(0, 2000)}

Extract all SOAP fields comprehensively. Include homebound status and skilled need justification for Medicare compliance.`,
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
            homebound_status: { type: "string" },
            skilled_need_justification: { type: "string" }
          }
        }
      });

      setFields(res);
      onFieldsPopulated?.(res);
      toast.success("SOAP fields extracted from notes");
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
    subjective: "S — Subjective",
    objective: "O — Objective",
    assessment: "A — Assessment",
    plan: "P — Plan",
    vital_signs_summary: "Vitals Summary",
    follow_up_needed: "Follow-Up",
    homebound_status: "Homebound Status",
    skilled_need_justification: "Skilled Need Justification"
  };

  const FIELD_COLORS = {
    subjective: "border-l-blue-400",
    objective: "border-l-purple-400",
    assessment: "border-l-orange-400",
    plan: "border-l-green-400",
    homebound_status: "border-l-indigo-400",
    skilled_need_justification: "border-l-red-400",
  };

  const textFields = Object.keys(FIELD_LABELS).filter(k => fields?.[k] && typeof fields[k] === "string");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Extract SOAP fields & form data from your notes</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-purple-600 hover:bg-purple-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ClipboardCheck className="w-3 h-3 mr-1" />}
          {fields ? "Re-Extract" : "Auto-Populate"}
        </Button>
      </div>

      {fields && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {textFields.map((key) => (
            <div key={key} className={`p-2.5 bg-white rounded-lg border border-l-4 ${FIELD_COLORS[key] || "border-l-slate-300"} border-slate-200`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{FIELD_LABELS[key]}</span>
                <button onClick={() => copyField(key, fields[key])} className="text-slate-400 hover:text-blue-600">
                  {copied[key] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{fields[key]}</p>
            </div>
          ))}

          {fields.medications_mentioned?.length > 0 && (
            <div className="p-2.5 bg-white rounded-lg border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Medications Mentioned</span>
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

// ── Real-Time Quality & Compliance Check ───────────────────────────────────
function CompliancePanel({ noteContent, visitType, diagnosis, providerType }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!noteContent?.trim()) { toast.error("Add clinical notes first"); return; }
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a senior home health compliance auditor and quality reviewer. Perform a comprehensive quality and compliance check on this clinical note.

Provider Type: ${providerType || "RN"}
Visit Type: ${visitType || "N/A"}
Diagnosis: ${diagnosis || "N/A"}

Clinical Note:
${noteContent.substring(0, 2000)}

Evaluate:
1. Medicare/Medicaid documentation compliance
2. Homebound status - is it clearly documented?
3. Skilled need justification - is it sufficient?
4. SOAP structure completeness
5. Clinical detail quality and specificity
6. Medication documentation
7. Vital signs documentation
8. Patient response to interventions
9. Care plan alignment
10. Required elements for this visit type

Provide actionable feedback with specific recommendations to improve each issue.`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_score: { type: "number" },
            quality_score: { type: "number" },
            completeness_score: { type: "number" },
            status: { type: "string" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string" },
                  category: { type: "string" },
                  issue: { type: "string" },
                  recommendation: { type: "string" },
                  quick_fix: { type: "string" }
                }
              }
            },
            missing_elements: { type: "array", items: { type: "string" } },
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
    critical: "bg-red-50 text-red-800 border-red-200",
    high: "bg-orange-50 text-orange-800 border-orange-200",
    medium: "bg-yellow-50 text-yellow-800 border-yellow-200",
    low: "bg-blue-50 text-blue-800 border-blue-200"
  }[s?.toLowerCase()] || "bg-slate-50 text-slate-700 border-slate-200");

  const scoreColor = (score) => {
    if (score >= 85) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  const ScoreRing = ({ value, label, color }) => (
    <div className="flex flex-col items-center">
      <div className={`text-xl font-bold ${scoreColor(value)}`}>{value}%</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Real-time quality, completeness & compliance checks</p>
        <Button size="sm" onClick={run} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs">
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Shield className="w-3 h-3 mr-1" />}
          {result ? "Re-Check" : "Run Quality Check"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          {/* Three score cards */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <ScoreRing value={result.compliance_score} label="Compliance" />
            <ScoreRing value={result.quality_score} label="Quality" />
            <ScoreRing value={result.completeness_score} label="Complete" />
          </div>

          {/* Progress bars */}
          <div className="space-y-1.5">
            {[
              { label: "Compliance", value: result.compliance_score, color: "bg-blue-500" },
              { label: "Quality", value: result.quality_score, color: "bg-purple-500" },
              { label: "Completeness", value: result.completeness_score, color: "bg-green-500" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-20">{label}</span>
                <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value || 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200">{result.summary}</p>

          {/* Missing elements */}
          {result.missing_elements?.length > 0 && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Missing Elements
              </p>
              <div className="space-y-0.5">
                {result.missing_elements.map((el, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-red-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    {el}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issues */}
          {result.issues?.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Issues ({result.issues.length})</p>
              {result.issues.map((issue, i) => (
                <div key={i} className={`p-2.5 rounded-lg border ${severityColor(issue.severity)}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="text-[10px] font-semibold uppercase">{issue.severity}</span>
                    <span className="text-[10px] opacity-70">· {issue.category}</span>
                  </div>
                  <p className="text-xs font-medium">{issue.issue}</p>
                  {issue.recommendation && <p className="text-[10px] mt-1 opacity-80">→ {issue.recommendation}</p>}
                  {issue.quick_fix && (
                    <p className="text-[10px] mt-1 font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                      ✏️ {issue.quick_fix}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Strengths */}
          {result.strengths?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">✅ Strengths</p>
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
  onFieldsPopulated,
  onSOAPGenerated
}) {
  const [activeTab, setActiveTab] = useState("voice");
  const [expanded, setExpanded] = useState(true);

  const TABS = [
    { id: "voice", label: "Voice → SOAP", icon: Mic, color: "text-red-600" },
    { id: "codes", label: "ICD-10 / CPT", icon: Code2, color: "text-blue-600" },
    { id: "populate", label: "Auto-Populate", icon: ClipboardCheck, color: "text-purple-600" },
    { id: "compliance", label: "Quality Check", icon: Shield, color: "text-emerald-600" },
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
            <CardTitle className="text-sm text-white font-semibold">Clinical Documentation AI</CardTitle>
            <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">4 Tools</Badge>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Tab Bar */}
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? `border-current ${tab.color} bg-slate-50`
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5 hidden sm:block" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-3">
            {activeTab !== "voice" && !noteContent?.trim() && (
              <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                <FileText className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">Enter clinical notes above to enable AI analysis</p>
              </div>
            )}

            {activeTab === "voice" && (
              <VoiceToSOAPPanel
                visitType={visitType}
                diagnosis={diagnosis}
                patientData={patientData}
                onSOAPGenerated={onSOAPGenerated}
              />
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