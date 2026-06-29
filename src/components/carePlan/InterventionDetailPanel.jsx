import { useState, useEffect } from "react";
import { useAICall } from "@/hooks/useAICall";
import { CheckCircle2, Link, BookOpen, Shield, ChevronDown, ChevronUp, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCategoryForItem } from "./InterventionLibrary";

const CLINICAL_PATHWAYS = [
  "CHF Management Protocol",
  "COPD Exacerbation Pathway",
  "Wound Care Protocol",
  "Diabetic Management Pathway",
  "Fall Prevention Protocol",
  "Stroke Recovery Pathway",
  "Orthopedic Rehab Protocol",
  "Oncology Supportive Care Pathway",
  "Sepsis Recovery Protocol",
  "Hypertension Management Pathway",
];

const MEDICARE_GUIDELINES = {
  "wc-1": { rule: "OASIS M1340", text: "Document wound characteristics at every visit. Homebound status must be justified in clinical notes.", link: "CoP 484.55" },
  "wc-2": { rule: "Skilled Nursing", text: "Dressing changes require a physician order and must demonstrate need for skilled nursing. Document technique used.", link: "Medicare Benefit Policy Manual Ch.7" },
  "mm-1": { rule: "Medication Mgmt", text: "Reconcile all medications at SOC, ROC, and any visit where a discrepancy is identified. Document complete med list.", link: "OASIS M2001-M2010" },
  "fp-1": { rule: "OASIS M1910", text: "Fall risk assessment must use a standardized tool. Document safety interventions taught and patient/caregiver response.", link: "CoP 484.60" },
  "cv-1": { rule: "Vital Signs", text: "Trending blood pressure values required. Notify physician of values outside established parameters per care plan.", link: "Skilled Nursing Documentation Standards" },
  "resp-1": { rule: "OASIS M1400", text: "Document shortness of breath on exertion, at rest, and when lying flat. Correlate with functional assessment.", link: "OASIS C2 Guidance" },
  "dm-1": { rule: "Blood Glucose", text: "Document blood glucose values, timing relative to meals, and patient's ability to self-monitor. Report critical values per protocol.", link: "Medicare LCD L35062" },
  "ps-1": { rule: "OASIS M1730", text: "Use standardized PHQ-2/PHQ-9 screening. Document results and follow-up plan if positive screen.", link: "OASIS M1730 Guidance" },
  "pe-2": { rule: "Emergency Plan", text: "Emergency contact and action plan must be documented and reviewed with patient/caregiver each visit.", link: "CoP 484.80(a)" },
};

export default function InterventionDetailPanel({ item, onLinkPathway, linkedPathway, _onClose }) {
  const [selectedPathway, setSelectedPathway] = useState(linkedPathway || "");
  const [aiInsight, setAiInsight] = useState(null);
  const ai = useAICall();
  const [expanded, setExpanded] = useState({ pathway: true, guideline: true, ai: false });

  const category = item ? getCategoryForItem(item.id) : null;
  const guideline = item ? MEDICARE_GUIDELINES[item.id] : null;

  useEffect(() => {
    setSelectedPathway(linkedPathway || "");
    setAiInsight(null);
  }, [item?.id, linkedPathway]);

  const handlePathwayLink = () => {
    if (selectedPathway) onLinkPathway(item.id, selectedPathway);
  };

  const fetchAIInsight = async () => {
    if (!item) return;
    setExpanded(prev => ({ ...prev, ai: true }));
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a Medicare home health compliance expert. For the clinical intervention "${item.name}" (${item.description}), provide:
1. A 2-sentence clinical rationale for why this intervention is Medicare-reimbursable
2. One key documentation tip to ensure compliance
3. One common documentation mistake to avoid

Format as JSON: { "rationale": "...", "tip": "...", "avoid": "..." }`,
        response_json_schema: {
          type: "object",
          properties: {
            rationale: { type: "string" },
            tip: { type: "string" },
            avoid: { type: "string" }
          }
        }
      });
      setAiInsight(result);
    } catch {
      setAiInsight({ error: true });
    }
  };

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  if (!item) {
    return (
      <div className="w-72 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-3">
          <BookOpen className="w-7 h-7 text-indigo-400" />
        </div>
        <p className="text-sm font-semibold text-slate-400">Select an intervention</p>
        <p className="text-xs text-slate-300 mt-1">Click any card in the plan to view details, link pathways, and review compliance</p>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-indigo-200">{category?.category}</p>
            <h3 className="text-base font-bold mt-0.5 leading-tight">{item.name}</h3>
          </div>
        </div>
        <p className="text-xs text-indigo-200 mt-2 leading-relaxed">{item.description}</p>
        <div className="flex gap-2 mt-3">
          <span className="text-xs bg-white/20 rounded-full px-2.5 py-0.5 font-medium">{item.frequency}</span>
          {item.complianceTag && (
            <span className="text-xs bg-white/20 rounded-full px-2.5 py-0.5 font-medium">{item.complianceTag}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Pathway Linking */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggle("pathway")}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Link className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-semibold text-slate-700">Link Clinical Pathway</span>
            </div>
            {expanded.pathway ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expanded.pathway && (
            <div className="px-4 pb-4">
              <select
                value={selectedPathway}
                onChange={(e) => setSelectedPathway(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
              >
                <option value="">Select a pathway...</option>
                {CLINICAL_PATHWAYS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button
                size="sm"
                className="w-full mt-2"
                disabled={!selectedPathway}
                onClick={handlePathwayLink}
              >
                <Link className="w-3.5 h-3.5 mr-1.5" />
                {linkedPathway ? 'Update Link' : 'Link Pathway'}
              </Button>
              {linkedPathway && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Linked: {linkedPathway}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Medicare Guideline */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggle("guideline")}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-slate-700">Medicare Compliance</span>
            </div>
            {expanded.guideline ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expanded.guideline && (
            <div className="px-4 pb-4">
              {guideline ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5">{guideline.rule}</span>
                    <span className="text-xs text-slate-400">{guideline.link}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                    {guideline.text}
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>Document skilled need and clinical response at each visit per standard home health CoP requirements.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI Compliance Insight */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => { toggle("ai"); if (!aiInsight && !ai.loading) fetchAIInsight(); }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-navy-500" />
              <span className="text-sm font-semibold text-slate-700">AI Documentation Guide</span>
              <span className="text-[10px] text-navy-600 bg-navy-50 border border-navy-200 rounded-full px-1.5 py-0.5 font-medium">AI</span>
            </div>
            {expanded.ai ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expanded.ai && (
            <div className="px-4 pb-4">
              {ai.loading ? (
                <div className="flex items-center gap-2 text-xs text-navy-600 bg-navy-50 rounded-lg p-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating compliance insights...
                </div>
              ) : aiInsight?.error ? (
                <div className="text-xs text-red-500 bg-red-50 rounded-lg p-2.5">Could not load insights. Please retry.</div>
              ) : aiInsight ? (
                <div className="space-y-3">
                  <div className="bg-navy-50 rounded-lg p-2.5 border border-navy-100">
                    <p className="text-[10px] font-bold text-navy-700 uppercase mb-1">Clinical Rationale</p>
                    <p className="text-xs text-navy-900 leading-relaxed">{aiInsight.rationale}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                    <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">💡 Documentation Tip</p>
                    <p className="text-xs text-emerald-900 leading-relaxed">{aiInsight.tip}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                    <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">⚠️ Avoid This</p>
                    <p className="text-xs text-amber-900 leading-relaxed">{aiInsight.avoid}</p>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={fetchAIInsight}>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5 text-navy-500" />
                  Generate AI Insights
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}