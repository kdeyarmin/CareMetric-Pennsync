import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { generateDiagnosisCodes, codeLabel } from "@/components/referral/diagnosisCodeGenerator";
import { sanitizeAiItems, sanitizeAiText, NO_AI_PREFILL_NOTICE } from "@/components/oasis/responseSchema/aiResponseSanitizer.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';

export default function AIGeneratedOASISAssessment({ patientId, visitType = "Start of Care", referralData }) {
  const [assessment, setAssessment] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedItems, setExpandedItems] = useState([]);
  const [copiedItems, setCopiedItems] = useState([]);

  // Deterministic diagnosis sequence from the referral (codes documented in
  // the referral only, never generated). Feeds M1021/M1023 review and the
  // divergence check below. Clinical view only — no payment mechanics here.
  const referralCoding = useMemo(
    () => (referralData ? generateDiagnosisCodes(referralData) : null),
    [referralData]
  );

  // After generation, flag when the AI's M1021 doesn't reflect the referral's
  // documented primary so the clinician verifies before locking the OASIS.
  const m1021Divergence = useMemo(() => {
    if (!assessment?.oasis_items || !referralCoding?.primary) return null;
    const m1021 = assessment.oasis_items.find((it) => /M1021/i.test(it.item_number || ""));
    if (!m1021) return null;
    // Reads the surviving narrative fields. `suggested_response` no longer
    // exists — the sanitiser strips it — and this is a DISCREPANCY check, which
    // needs the model's reasoning, not a code.
    const text = `${m1021.rationale || ""} ${m1021.evidence || ""}`.toUpperCase().replace(/\./g, "");
    const code = referralCoding.primary.code; // normalized, no dot
    const desc = (referralCoding.primary.description || "").toUpperCase();
    const mentions = text.includes(code) || (desc && text.includes(desc.replace(/\./g, "")));
    return mentions ? null : referralCoding.primary;
  }, [assessment, referralCoding]);

  const generateAssessment = async () => {
    setIsGenerating(true);
    try {
      const payload = {
        visit_type: visitType
      };

      if (patientId) {
        payload.patient_id = patientId;
      } else if (referralData) {
        payload.referral_data = referralData;
      }

      const { data } = await base44.functions.invoke('generateOASISAssessment', payload);
      
      // Filter out administrative items
      if (data.oasis_items) {
        data.oasis_items = data.oasis_items.filter(item => {
          const itemNum = item.item_number?.toUpperCase() || '';
          const numMatch = itemNum.match(/M(\d+)/);
          if (numMatch) {
            const num = parseInt(numMatch[1]);
            // M1021 (Primary Diagnosis) and M1023 (Other Diagnoses) fall in this
            // range but are clinical diagnosis items, not administrative — keep
            // them so the primary diagnosis is saved and the referral-divergence
            // safety check can run.
            if (num >= 1000 && num <= 1060 && num !== 1021 && num !== 1023) return false;
          }
          return true;
        });
      }
      
      // Defensive sanitisation at the boundary. Even with the prompt changed,
      // a model can still emit a code — through a field nobody planned for, or
      // inside prose. Stripping it here is what makes it inert: nothing below
      // can display, copy, save or score a model-chosen response.
      if (Array.isArray(data?.oasis_items)) {
        // Every restored field goes through `sanitizeAiText`. Reattaching the
        // ORIGINAL values here would have undone the sanitiser for exactly the
        // fields a model is most likely to put an answer in: a
        // "questions_to_ask" entry reading "Is M1830 = 6 correct?" would have
        // reached the panel and the clipboard.
        const original = data.oasis_items;
        data.oasis_items = sanitizeAiItems(original).clean.map((clean, i) => ({
          ...clean,
          item_name: sanitizeAiText(original[i]?.item_name),
          confidence_level: sanitizeAiText(original[i]?.confidence_level),
          category: sanitizeAiText(original[i]?.category),
          questions_to_ask: sanitizeAiText(original[i]?.questions_to_ask),
          documentation_tips: sanitizeAiText(original[i]?.documentation_tips),
        }));
      }
      setAssessment(data);
    } catch (error) {
      console.error('Error generating OASIS assessment:', error);
      toast.error('Failed to generate OASIS assessment. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // `saveAssessment` is REMOVED.
  //
  // It mapped each item's `suggested_response` onto `response`, stamped
  // `ai_suggested: true`, and called `OASISAssessment.create` — writing
  // model-chosen values into the field every downstream consumer reads as a
  // clinician's OASIS response, and marking the assessment "completed" when
  // enough of them were present.
  //
  // Every final official OASIS response must be selected explicitly by a
  // clinician, through the protected write path. This panel is guidance only
  // and no longer writes anything.

  const toggleItemExpand = (index) => {
    setExpandedItems(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const copyItemToClipboard = (item) => {
    const text = `${item.item_number}: ${item.item_name}
PennSync does not select OASIS responses — answer this item from the wording in your EMR.
${item.evidence ? `Evidence from the record: "${item.evidence}"` : ""}
Notes: ${item.rationale || ""}

Questions to Ask:
${item.questions_to_ask?.map(q => `• ${q}`).join('\n')}

Documentation Tips:
${item.documentation_tips?.map(t => `• ${t}`).join('\n')}`;

    navigator.clipboard.writeText(text);
    setCopiedItems(prev => [...prev, item.item_number]);
    setTimeout(() => {
      setCopiedItems(prev => prev.filter(i => i !== item.item_number));
    }, 2000);
  };

  const getConfidenceBadgeColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':
        return 'bg-green-600';
      case 'medium':
        return 'bg-yellow-600';
      case 'low':
        return 'bg-orange-600';
      default:
        return 'bg-slate-600';
    }
  };

  if (!assessment) {
    return (
      <Card className="border-2 border-indigo-300 bg-indigo-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <ClipboardList className="w-4 h-4" />
            AI-Generated OASIS Assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-indigo-800 mb-3">
            Generate intelligent OASIS assessment suggestions based on patient data, diagnoses, and care plans.
          </p>
          {referralCoding?.sequenced?.length > 0 && (
            <div className="bg-white border border-indigo-200 rounded p-2 mb-3 text-xs text-slate-700">
              <p className="font-semibold text-indigo-900 mb-1">Documented in the referral (M1021/M1023 reference):</p>
              {referralCoding.primary && <p>Primary: {codeLabel(referralCoding.primary)}</p>}
              {referralCoding.secondaries.length > 0 && (
                <p>Other: {referralCoding.secondaries.map((d) => d.displayCode).join(", ")}</p>
              )}
            </div>
          )}
          <Button
            onClick={generateAssessment}
            disabled={isGenerating}
            className="bg-indigo-600 hover:bg-indigo-700 w-full"
          >
            {isGenerating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Generating Assessment...
              </>
            ) : (
              <>
                <ClipboardList className="w-4 h-4 mr-2" />
                Generate OASIS Assessment
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-indigo-300 bg-indigo-50">
      {m1021Divergence && (
        <Alert className="m-3 mb-0 bg-amber-50 border-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <AlertDescription className="text-xs text-amber-900">
            The generated M1021 may not reflect the referral's documented primary diagnosis
            ({codeLabel(m1021Divergence)}). Verify the primary diagnosis against the referral before finalizing.
          </AlertDescription>
        </Alert>
      )}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <ClipboardList className="w-4 h-4" />
            AI-Generated OASIS Assessment
          </CardTitle>
          <Badge className="bg-indigo-600 text-white">
            {assessment.oasis_items?.length || 0} items
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Clinical Summary */}
        {assessment.clinical_summary && (
          <Alert className="bg-blue-50 border-blue-300">
            <FileText className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-900">
              <strong>Clinical Summary:</strong> {assessment.clinical_summary}
            </AlertDescription>
          </Alert>
        )}

        {/* PDGM Estimate */}
        {assessment.estimated_pdgm_group && (
          <Alert className="bg-navy-50 border-navy-300">
            <TrendingUp className="w-4 h-4 text-navy-600" />
            <AlertDescription className="text-xs text-navy-900">
              <strong>Estimated PDGM Group:</strong> {assessment.estimated_pdgm_group}
            </AlertDescription>
          </Alert>
        )}

        {/* Assessment Priorities */}
        {assessment.assessment_priorities?.length > 0 && (
          <Card className="bg-white">
            <CardContent className="p-3">
              <h4 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-600" />
                Assessment Priorities
              </h4>
              <div className="space-y-2">
                {assessment.assessment_priorities.map((priority, idx) => (
                  <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-orange-600 text-white text-xs">{priority.priority}</Badge>
                      <span className="text-xs font-semibold text-slate-900">{priority.area}</span>
                    </div>
                    <p className="text-xs text-slate-700">{priority.rationale}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Missing Data Alert */}
        {assessment.missing_critical_data?.length > 0 && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription>
              <p className="text-xs font-semibold text-red-900 mb-1">Critical Missing Data:</p>
              <ul className="space-y-1">
                {assessment.missing_critical_data.map((item, idx) => (
                  <li key={idx} className="text-xs text-red-800">• {item}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* OASIS Items */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-auto">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="functional" className="text-xs">Functional</TabsTrigger>
            <TabsTrigger value="clinical" className="text-xs">Clinical</TabsTrigger>
            <TabsTrigger value="cognitive" className="text-xs">Cognitive</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(item => {
              // Filter out administrative items M1000-M1060, but keep the diagnosis
              // items M1021/M1023 the generator deliberately retains — hiding them
              // left the AI primary diagnosis saved yet impossible to review or edit.
              const itemNum = item.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060 && num !== 1021 && num !== 1023) return false;
              }
              return true;
            }).map((item, idx) => {
              const isExpanded = expandedItems.includes(idx);
              const isCopied = copiedItems.includes(item.item_number);

              return (
                <div
                  key={idx}
                  className="bg-white border border-indigo-200 rounded-lg overflow-hidden"
                >
                  <div
                    className="p-3 cursor-pointer hover:bg-indigo-50 transition-colors"
                    onClick={() => toggleItemExpand(idx)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">{item.item_number}</Badge>
                          <Badge className={`${getConfidenceBadgeColor(item.confidence_level)} text-white text-xs`}>
                            {item.confidence_level}
                          </Badge>
                          {item.category && (
                            <Badge className="bg-slate-600 text-white text-xs">{item.category}</Badge>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-slate-900 mb-1">{item.item_name}</p>
                        {item.evidence && (
                          <p className="text-xs text-slate-700 italic">“{item.evidence}”</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyItemToClipboard(item);
                          }}
                          className="h-8 w-8 p-0"
                        >
                          {isCopied ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-indigo-200 bg-indigo-50 p-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-900 mb-1">Rationale:</p>
                        <p className="text-xs text-slate-700">{item.rationale}</p>
                      </div>

                      {item.questions_to_ask?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-900 mb-1 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            Questions to Ask:
                          </p>
                          <ul className="space-y-1">
                            {item.questions_to_ask.map((q, qidx) => (
                              <li key={qidx} className="text-xs text-slate-700 bg-white p-2 rounded">• {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {item.documentation_tips?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-900 mb-1">Documentation Tips:</p>
                          <ul className="space-y-1">
                            {item.documentation_tips.map((tip, tidx) => (
                              <li key={tidx} className="text-xs text-slate-700">• {tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {item.pdgm_impact && (
                        <div className="bg-navy-100 border border-navy-300 rounded p-2">
                          <p className="text-xs font-semibold text-navy-900 mb-1">PDGM Impact:</p>
                          <p className="text-xs text-navy-800">{item.pdgm_impact}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="functional" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060 && num !== 1021 && num !== 1023) return false;
              }
              return i.category?.toLowerCase().includes('functional');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="clinical" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060 && num !== 1021 && num !== 1023) return false;
              }
              return i.category?.toLowerCase().includes('clinical');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="cognitive" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060 && num !== 1021 && num !== 1023) return false;
              }
              return i.category?.toLowerCase().includes('cognitive');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name}
              </div>
            ))}
          </TabsContent>
        </Tabs>

        {/* The "PDGM Optimization" panel is REMOVED. It surfaced model notes on
            how to raise the PDGM result, which is an instruction to code for
            payment rather than for the patient. */}

        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription className="text-xs">{NO_AI_PREFILL_NOTICE}</AlertDescription>
        </Alert>

      </CardContent>
    </Card>
  );
}