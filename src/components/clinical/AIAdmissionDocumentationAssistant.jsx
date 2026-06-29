import { useState } from "react";
import { invokeLLM } from "@/lib/invokeLLM";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Edit,
  Save
} from "lucide-react";
import { toast } from 'sonner';

export default function AIAdmissionDocumentationAssistant({ 
  referralData, 
  oasisSuggestions, 
  patientData,
  onSaveSection 
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [documentationSections, setDocumentationSections] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [editingSection, setEditingSection] = useState(null);
  const [subjectiveInputs, setSubjectiveInputs] = useState({});
  const [showInputPrompts, setShowInputPrompts] = useState(false);

  const generateDocumentation = async () => {
    setIsGenerating(true);
    try {
      const response = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health nurse creating comprehensive admission documentation. Using the provided referral data, OASIS analysis, and patient information, draft detailed clinical documentation sections.

**REFERRAL DATA:**
${JSON.stringify(referralData, null, 2)}

**OASIS SUGGESTIONS:**
${JSON.stringify(oasisSuggestions, null, 2)}

**PATIENT DATA:**
${JSON.stringify(patientData, null, 2)}

**CRITICAL INSTRUCTIONS:**

1. **Draft Complete Sections:** Create detailed, Medicare-compliant documentation for each section below
2. **Incorporate All Data:** Pull relevant information from referral, OASIS, and patient records
3. **Identify Gaps:** For each section, identify what subjective nursing observations are REQUIRED but not available in the data
4. **Prompt for Input:** Create specific prompts asking the nurse for the missing subjective information

**SECTIONS TO GENERATE:**

1. **CHIEF COMPLAINT & REASON FOR ADMISSION**
   - Why patient needs home health
   - Referring diagnosis
   - Recent hospitalization summary (if applicable)

2. **HOMEBOUND STATUS JUSTIFICATION**
   - Specific mobility limitations
   - Safety concerns
   - Support needs for leaving home
   - CRITICAL: This must be detailed and specific for Medicare compliance

3. **PAST MEDICAL HISTORY**
   - All diagnoses from referral
   - Comorbidities affecting care
   - Previous surgeries/hospitalizations

4. **CURRENT MEDICATIONS**
   - List all medications from referral
   - Note any high-risk medications
   - Identify medication management concerns

5. **FUNCTIONAL ASSESSMENT**
   - ADL status (bathing, dressing, toileting, etc.)
   - Mobility status
   - Cognitive status
   - Fall risk assessment

6. **PSYCHOSOCIAL ASSESSMENT**
   - Living situation
   - Support system
   - Safety concerns
   - Patient/caregiver understanding

7. **SKIN ASSESSMENT**
   - Any wounds from referral
   - Pressure injury risk
   - General skin condition

8. **SYSTEMS REVIEW**
   - Cardiovascular
   - Respiratory
   - Gastrointestinal
   - Genitourinary
   - Neurological
   - Musculoskeletal

9. **SKILLED NEED JUSTIFICATION**
   - Why skilled nursing is required
   - Why patient cannot self-manage
   - Expected outcomes

10. **SUBJECTIVE NURSING PROMPTS**
    - List of specific questions the nurse MUST answer based on gaps in data
    - Format: {prompt: "Question", section: "Which section", reason: "Why it's needed for compliance"}

For each section, provide:
- **content**: The drafted documentation text (use data when available, or indicate [REQUIRES NURSE INPUT: specific prompt])
- **data_sources**: What data sources were used (referral, OASIS, patient record)
- **confidence**: "high" (complete data), "medium" (partial data), or "low" (mostly needs nurse input)
- **compliance_notes**: Any specific Medicare/CMS requirements for this section
- **missing_info**: Specific items that need nurse observation/assessment`,
        response_json_schema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" },
                  data_sources: { type: "array", items: { type: "string" } },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  compliance_notes: { type: "string" },
                  missing_info: { type: "array", items: { type: "string" } }
                }
              }
            },
            subjective_prompts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string" },
                  section: { type: "string" },
                  reason: { type: "string" },
                  example_response: { type: "string" }
                }
              }
            },
            overall_completeness: { type: "number" },
            critical_gaps: { type: "array", items: { type: "string" } }
          }
        }
      });

      setDocumentationSections(response);
      setShowInputPrompts(response.subjective_prompts?.length > 0);
    } catch (error) {
      console.error("Error generating documentation:", error);
      toast.error("Failed to generate documentation. Please try again.");
    }
    setIsGenerating(false);
  };

  const toggleSection = (index) => {
    setExpandedSections(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleCopySection = (content) => {
    navigator.clipboard.writeText(content);
  };

  const handleEditSection = (index, currentContent) => {
    setEditingSection({ index, content: currentContent });
  };

  const handleSaveEdit = (index) => {
    const updatedSections = [...documentationSections.sections];
    updatedSections[index].content = editingSection.content;
    setDocumentationSections({
      ...documentationSections,
      sections: updatedSections
    });
    setEditingSection(null);
  };

  const handleSubjectiveInput = (promptIndex, value) => {
    setSubjectiveInputs(prev => ({
      ...prev,
      [promptIndex]: value
    }));
  };

  const incorporateSubjectiveInputs = async () => {
    setIsGenerating(true);
    try {
      // Merge subjective inputs into the documentation
      const updatedSections = await Promise.all(
        documentationSections.sections.map(async (section, _idx) => {
          const relevantInputs = documentationSections.subjective_prompts
            .map((prompt, pIdx) => ({
              prompt: prompt.prompt,
              response: subjectiveInputs[pIdx],
              section: prompt.section
            }))
            .filter(input => input.section === section.title && input.response);

          if (relevantInputs.length === 0) return section;

          // Use AI to incorporate the subjective inputs into the section
          const enhancedContent = await invokeLLM({
            model: "claude_opus_4_8",
            prompt: `Enhance this clinical documentation section by incorporating the nurse's subjective observations and assessments.

**ORIGINAL SECTION (${section.title}):**
${section.content}

**NURSE'S SUBJECTIVE INPUTS:**
${relevantInputs.map(input => `Q: ${input.prompt}\nA: ${input.response}`).join('\n\n')}

**INSTRUCTIONS:**
1. Seamlessly integrate the subjective observations into the existing documentation
2. Maintain professional nursing language and Medicare compliance
3. Ensure all statements are clinically appropriate
4. Replace any [REQUIRES NURSE INPUT] placeholders with the actual information
5. Maintain the overall structure and flow

Return ONLY the enhanced documentation text.`
          });

          return {
            ...section,
            content: enhancedContent,
            confidence: "high"
          };
        })
      );

      setDocumentationSections({
        ...documentationSections,
        sections: updatedSections
      });
      setShowInputPrompts(false);
    } catch (error) {
      console.error("Error incorporating inputs:", error);
      toast.error("Failed to incorporate subjective inputs. Please try again.");
    }
    setIsGenerating(false);
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence) {
      case "high": return "bg-green-100 text-green-800 border-green-300";
      case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "low": return "bg-red-100 text-red-800 border-red-300";
      default: return "bg-slate-100 text-slate-800 border-slate-300";
    }
  };

  if (!referralData && !oasisSuggestions && !patientData) {
    return (
      <Card className="border-yellow-300 bg-yellow-50">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-900">No Data Available</p>
              <p className="text-sm text-yellow-800 mt-1">
                Please process referral data or generate OASIS suggestions first before using the documentation assistant.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-2 border-blue-500 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            AI Admission Documentation Assistant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-blue-100 border-blue-300 mb-4">
            <AlertDescription className="text-blue-900 text-sm">
              <strong>Intelligent Documentation Drafting:</strong> This AI assistant analyzes referral data, OASIS suggestions, 
              and patient records to draft comprehensive admission documentation. It will identify areas requiring your subjective 
              nursing assessment and prompt you for that critical information.
            </AlertDescription>
          </Alert>

          {!documentationSections ? (
            <Button
              onClick={generateDocumentation}
              disabled={isGenerating}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Data & Drafting Documentation...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate AI-Powered Admission Documentation
                </>
              )}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={generateDocumentation}
                disabled={isGenerating}
                variant="outline"
                className="flex-1"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate
              </Button>
              <Button
                onClick={() => {
                  const allContent = documentationSections.sections
                    .map(s => `${s.title}\n${'='.repeat(s.title.length)}\n${s.content}\n\n`)
                    .join('\n');
                  navigator.clipboard.writeText(allContent);
                }}
                variant="outline"
                className="flex-1"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy All
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {documentationSections && (
        <>
          {/* Overall Summary */}
          <Card>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Overall Completeness</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${documentationSections.overall_completeness}%` }}
                      />
                    </div>
                    <span className="font-bold text-slate-900">
                      {documentationSections.overall_completeness}%
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Sections</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {documentationSections.sections.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Critical Gaps</p>
                  <p className="text-2xl font-bold text-red-600">
                    {documentationSections.critical_gaps?.length || 0}
                  </p>
                </div>
              </div>

              {documentationSections.critical_gaps?.length > 0 && (
                <Alert className="bg-red-50 border-red-300 mt-4">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-900 text-sm">
                    <strong>Critical Gaps Identified:</strong>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      {documentationSections.critical_gaps.map((gap, idx) => (
                        <li key={idx}>{gap}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Subjective Input Prompts */}
          {showInputPrompts && documentationSections.subjective_prompts?.length > 0 && (
            <Card className="border-2 border-orange-400 bg-orange-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-900">
                  <AlertCircle className="w-5 h-5" />
                  Your Subjective Assessment Needed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="bg-orange-100 border-orange-400">
                  <AlertDescription className="text-orange-900 text-sm">
                    The following areas require your professional nursing observations and subjective assessment. 
                    Please provide detailed responses to complete the documentation.
                  </AlertDescription>
                </Alert>

                {documentationSections.subjective_prompts.map((prompt, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-lg border border-orange-300">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <Badge className="bg-orange-600 mb-2">{prompt.section}</Badge>
                        <p className="font-semibold text-slate-900">{prompt.prompt}</p>
                        <p className="text-xs text-slate-600 mt-1">{prompt.reason}</p>
                      </div>
                    </div>
                    <Textarea
                      placeholder={prompt.example_response}
                      value={subjectiveInputs[idx] || ""}
                      onChange={(e) => handleSubjectiveInput(idx, e.target.value)}
                      className="mt-3 min-h-[100px]"
                    />
                  </div>
                ))}

                <Button
                  onClick={incorporateSubjectiveInputs}
                  disabled={isGenerating || Object.keys(subjectiveInputs).length === 0}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Incorporating Your Assessments...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Incorporate Subjective Assessments into Documentation
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Documentation Sections */}
          <div className="space-y-4">
            {documentationSections.sections.map((section, idx) => (
              <Card key={idx} className={`border-2 ${expandedSections[idx] ? 'border-blue-400' : ''}`}>
                <CardHeader className="cursor-pointer" onClick={() => toggleSection(idx)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{section.title}</CardTitle>
                        <Badge className={getConfidenceColor(section.confidence)}>
                          {section.confidence} confidence
                        </Badge>
                      </div>
                      {section.data_sources?.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {section.data_sources.map((source, sIdx) => (
                            <Badge key={sIdx} variant="outline" className="text-xs">
                              {source}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    {expandedSections[idx] ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </CardHeader>

                {expandedSections[idx] && (
                  <CardContent className="space-y-4">
                    {section.compliance_notes && (
                      <Alert className="bg-blue-50 border-blue-300">
                        <AlertDescription className="text-blue-900 text-sm">
                          <strong>Compliance Note:</strong> {section.compliance_notes}
                        </AlertDescription>
                      </Alert>
                    )}

                    {editingSection?.index === idx ? (
                      <div className="space-y-3">
                        <Textarea
                          value={editingSection.content}
                          onChange={(e) => setEditingSection({ ...editingSection, content: e.target.value })}
                          className="min-h-[200px] font-mono text-sm"
                        />
                        <div className="flex gap-2">
                          <Button onClick={() => handleSaveEdit(idx)} size="sm">
                            <Save className="w-4 h-4 mr-2" />
                            Save Changes
                          </Button>
                          <Button onClick={() => setEditingSection(null)} size="sm" variant="outline">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 whitespace-pre-wrap font-mono text-sm">
                          {section.content}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleCopySection(section.content)}
                            size="sm"
                            variant="outline"
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy
                          </Button>
                          <Button
                            onClick={() => handleEditSection(idx, section.content)}
                            size="sm"
                            variant="outline"
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          {onSaveSection && (
                            <Button
                              onClick={() => onSaveSection(section.title, section.content)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              Save to Chart
                            </Button>
                          )}
                        </div>
                      </>
                    )}

                    {section.missing_info?.length > 0 && (
                      <Alert className="bg-yellow-50 border-yellow-300">
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                        <AlertDescription className="text-yellow-900 text-sm">
                          <strong>Still Needs:</strong>
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            {section.missing_info.map((info, mIdx) => (
                              <li key={mIdx}>{info}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}