import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Send
} from "lucide-react";

export default function OASISDataEntryAssistant({ onDataConfirmed }) {
  const [file, setFile] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [error, setError] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const ai = useAICall();
  const [flaggedFields, setFlaggedFields] = useState([]);
  const [carePathways, setCarePathways] = useState([]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && (selectedFile.type === "application/pdf" || 
        selectedFile.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      setFile(selectedFile);
      setError(null);
      setExtractedData(null);
      setEditedData(null);
    } else {
      setError("Please select a valid PDF or DOCX file.");
      setFile(null);
    }
  };

  const handleExtract = async () => {
    if (!file) return;

    setIsExtracting(true);
    setError(null);

    try {
      // Upload file
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const uploadedFileUrl = uploadResult.file_url;
      setFileUrl(uploadedFileUrl);

      // Extract OASIS data with comprehensive schema
      const extractResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: uploadedFileUrl,
        json_schema: {
          type: "object",
          properties: {
            // Patient Info
            patient_name: { type: "string", description: "Full patient name" },
            patient_first_name: { type: "string" },
            patient_last_name: { type: "string" },
            patient_dob: { type: "string", description: "Date of birth MM/DD/YYYY" },
            patient_gender: { type: "string", description: "M or F" },
            patient_phone: { type: "string" },
            medical_record_number: { type: "string" },

            // Assessment Info
            m0090_assessment_date: { type: "string" },
            m0100_assessment_reason: { type: "string" },
            assessment_type: { type: "string", description: "SOC, ROC, Recert, Discharge, etc" },
            
            // Episode Timing
            m0110_episode_timing: { type: "string", description: "1=Early, 2=Late" },
            m0030_soc_date: { type: "string" },
            
            // Primary Diagnosis
            m1021_primary_dx_code: { type: "string", description: "ICD-10 code" },
            m1021_primary_dx_description: { type: "string" },
            
            // Other Diagnoses
            m1023_other_diagnoses: { type: "string", description: "All other ICD-10 codes with descriptions, comma separated" },

            // Functional Status (ADLs)
            m1800_grooming: { type: "string", description: "0-3" },
            m1810_dress_upper: { type: "string", description: "0-3" },
            m1820_dress_lower: { type: "string", description: "0-3" },
            m1830_bathing: { type: "string", description: "0-6" },
            m1840_toilet_transfer: { type: "string", description: "0-4" },
            m1850_transferring: { type: "string", description: "0-5" },
            m1860_ambulation: { type: "string", description: "0-6" },

            // GG Items
            gg0130_eating: { type: "string" },
            gg0130_oral_hygiene: { type: "string" },
            gg0130_toileting: { type: "string" },
            gg0170_sit_to_lying: { type: "string" },
            gg0170_lying_to_sit: { type: "string" },
            gg0170_sit_to_stand: { type: "string" },

            // Clinical Items
            m1242_pain_frequency: { type: "string", description: "0-4" },
            m1306_pressure_ulcer: { type: "string", description: "0=No, 1=Yes" },
            m1307_pressure_ulcer_stage: { type: "string" },
            m1400_dyspnea: { type: "string", description: "0-4" },
            m1620_urinary_incontinence: { type: "string" },
            m1700_cognitive_functioning: { type: "string" },
            m1710_confusion_frequency: { type: "string" },
            m1730_depression_phq2: { type: "string" },

            // Therapy
            therapy_pt: { type: "string", description: "Physical therapy needed yes/no" },
            therapy_ot: { type: "string", description: "Occupational therapy needed yes/no" },
            therapy_slp: { type: "string", description: "Speech therapy needed yes/no" }
          }
        }
      });

      if (extractResult.status === "error") {
        throw new Error(extractResult.details || "Failed to extract data from document");
      }

      setExtractedData(extractResult.output);
      setEditedData({ ...extractResult.output });

      // Trigger AI insights analysis
      await analyzeExtractedData(extractResult.output);
    } catch (err) {
      console.error("Extraction error:", err);
      setError(`Failed to extract data: ${err.message}`);
    }

    setIsExtracting(false);
  };

  const analyzeExtractedData = async (data) => {

    try {
      // AI-powered validation and insights
      const insights = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this extracted OASIS data for compliance issues, clinical concerns, and care opportunities.

EXTRACTED OASIS DATA:
${JSON.stringify(data, null, 2)}

Analyze and provide:
1. COMPLIANCE ISSUES: Identify any missing required fields, inconsistent data, or potential coding errors
2. CLINICAL CONCERNS: Flag any clinical red flags (e.g., high fall risk, pressure ulcer, severe functional decline)
3. CARE PATHWAYS: Recommend specific care pathways or interventions based on diagnosis and functional status
4. FIELDS REQUIRING REVIEW: List specific fields that need clinician verification or additional documentation

Return structured JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  issue: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  recommendation: { type: "string" }
                }
              }
            },
            clinical_concerns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concern_type: { type: "string" },
                  description: { type: "string" },
                  risk_level: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  recommended_actions: { type: "array", items: { type: "string" } }
                }
              }
            },
            recommended_care_pathways: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pathway_name: { type: "string" },
                  reason: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  key_interventions: { type: "array", items: { type: "string" } }
                }
              }
            },
            flagged_fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field_name: { type: "string" },
                  flag_reason: { type: "string" },
                  action_needed: { type: "string" }
                }
              }
            },
            overall_assessment: { type: "string" }
          }
        }
      });

      setAiInsights(insights);
      
      // Extract flagged fields for UI highlighting
      const flaggedFieldsList = insights.flagged_fields?.map(f => f.field_name) || [];
      setFlaggedFields(flaggedFieldsList);
      setCarePathways(insights.recommended_care_pathways || []);

    } catch (err) {
      console.error("AI insights error:", err);
      // Don't fail the whole process if insights fail
    }

  };

  const handleFieldChange = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  const handleConfirm = () => {
    if (onDataConfirmed && editedData && fileUrl) {
      onDataConfirmed({
        extractedData: editedData,
        originalData: extractedData,
        fileUrl,
        file
      });
    }
  };

  const renderField = (label, field, placeholder = "") => {
    const wasExtracted = extractedData?.[field] && extractedData[field] !== "Not found" && extractedData[field] !== "";
    const wasEdited = editedData?.[field] !== extractedData?.[field];
    const isFlagged = flaggedFields.includes(field);
    const flagInfo = aiInsights?.flagged_fields?.find(f => f.field_name === field);

    return (
      <div className="space-y-1">
        <Label className="text-xs flex items-center gap-2 flex-wrap">
          {label}
          {wasExtracted && <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">AI Found</Badge>}
          {wasEdited && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700">Edited</Badge>}
          {isFlagged && <Badge className="text-[10px] bg-red-500 text-white">⚠ Needs Review</Badge>}
        </Label>
        <Input
          value={editedData?.[field] || ""}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          placeholder={placeholder}
          className={`text-sm ${isFlagged ? 'border-red-300 bg-red-50 focus:border-red-500' : ''}`}
        />
        {flagInfo && (
          <p className="text-xs text-red-700 mt-1">
            ⚠ {flagInfo.flag_reason} - {flagInfo.action_needed}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card className="border-2 border-navy-200 bg-gradient-to-r from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Data Entry Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!extractedData ? (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 text-sm">
                Upload your OASIS document and AI will automatically extract and pre-fill all data fields for you to review.
              </AlertDescription>
            </Alert>

            <div className="border-2 border-dashed border-navy-300 rounded-lg p-6 text-center bg-white">
              <input
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                className="hidden"
                id="oasis-assistant-upload"
              />
              <FileText className="w-10 h-10 text-navy-400 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-2">
                {file ? file.name : "No file selected"}
              </p>
              <p className="text-xs text-slate-400 mb-4">PDF or DOCX format</p>
              <Button 
                variant="outline"
                onClick={() => document.getElementById('oasis-assistant-upload').click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Choose File
              </Button>
            </div>

            {file && (
              <Button
                onClick={handleExtract}
                disabled={isExtracting}
                className="w-full bg-navy-600 hover:bg-navy-700"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    AI is extracting data...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Extract OASIS Data with AI
                  </>
                )}
              </Button>
            )}

            {error && (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800 text-sm">{error}</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 text-sm">
                <strong>Data extracted successfully!</strong> Review the fields below and make any corrections before confirming.
              </AlertDescription>
            </Alert>

            {/* AI Insights - Compliance Issues */}
            {ai.loading && (
              <Card className="border-navy-200 bg-navy-50">
                <CardContent className="p-4 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-navy-600" />
                  <p className="text-sm text-navy-900">AI is analyzing data for compliance issues and clinical insights...</p>
                </CardContent>
              </Card>
            )}

            {aiInsights && (
              <div className="space-y-3">
                {/* Overall Assessment */}
                {aiInsights.overall_assessment && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-900 text-sm">
                      <strong>AI Assessment:</strong> {aiInsights.overall_assessment}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Compliance Issues */}
                {aiInsights.compliance_issues?.length > 0 && (
                  <Card className="border-red-200 bg-red-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        Compliance Issues Found ({aiInsights.compliance_issues.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {aiInsights.compliance_issues.map((issue, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border border-red-200">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={
                              issue.severity === 'critical' ? 'bg-red-600' :
                              issue.severity === 'high' ? 'bg-orange-500' :
                              issue.severity === 'medium' ? 'bg-yellow-500' :
                              'bg-blue-500'
                            }>
                              {issue.severity}
                            </Badge>
                            <span className="text-xs font-semibold">{issue.field}</span>
                          </div>
                          <p className="text-xs text-slate-700">{issue.issue}</p>
                          <p className="text-xs text-green-700 mt-1">💡 {issue.recommendation}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Clinical Concerns */}
                {aiInsights.clinical_concerns?.length > 0 && (
                  <Card className="border-orange-200 bg-orange-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600" />
                        Clinical Concerns ({aiInsights.clinical_concerns.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {aiInsights.clinical_concerns.map((concern, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border border-orange-200">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={
                              concern.risk_level === 'critical' ? 'bg-red-600' :
                              concern.risk_level === 'high' ? 'bg-orange-500' :
                              'bg-yellow-500'
                            }>
                              {concern.risk_level} risk
                            </Badge>
                            <span className="text-xs font-semibold">{concern.concern_type}</span>
                          </div>
                          <p className="text-xs text-slate-700 mb-1">{concern.description}</p>
                          {concern.recommended_actions?.length > 0 && (
                            <ul className="text-xs text-green-700 space-y-0.5">
                              {concern.recommended_actions.map((action, aidx) => (
                                <li key={aidx}>✓ {action}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Recommended Care Pathways */}
                {carePathways.length > 0 && (
                  <Card className="border-green-200 bg-green-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Recommended Care Pathways ({carePathways.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {carePathways.map((pathway, idx) => (
                        <div key={idx} className="bg-white p-3 rounded border border-green-200">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={
                              pathway.priority === 'critical' ? 'bg-red-600' :
                              pathway.priority === 'high' ? 'bg-orange-500' :
                              pathway.priority === 'medium' ? 'bg-blue-500' :
                              'bg-slate-500'
                            }>
                              {pathway.priority}
                            </Badge>
                            <span className="text-sm font-semibold text-green-900">{pathway.pathway_name}</span>
                          </div>
                          <p className="text-xs text-slate-700 mb-2">{pathway.reason}</p>
                          {pathway.key_interventions?.length > 0 && (
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="text-xs font-semibold text-green-800 mb-1">Key Interventions:</p>
                              <ul className="text-xs text-green-700 space-y-0.5">
                                {pathway.key_interventions.map((intervention, iidx) => (
                                  <li key={iidx}>• {intervention}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            <Tabs defaultValue="patient" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="patient">Patient</TabsTrigger>
                <TabsTrigger value="assessment">Assessment</TabsTrigger>
                <TabsTrigger value="functional">Functional</TabsTrigger>
                <TabsTrigger value="clinical">Clinical</TabsTrigger>
              </TabsList>

              <TabsContent value="patient" className="space-y-3 mt-4">
                {renderField("Patient Name", "patient_name")}
                {renderField("First Name", "patient_first_name")}
                {renderField("Last Name", "patient_last_name")}
                {renderField("Date of Birth", "patient_dob", "MM/DD/YYYY")}
                {renderField("Gender", "patient_gender", "M or F")}
                {renderField("Phone", "patient_phone")}
                {renderField("Medical Record Number", "medical_record_number")}
              </TabsContent>

              <TabsContent value="assessment" className="space-y-3 mt-4">
                {renderField("M0090 Assessment Date", "m0090_assessment_date", "MM/DD/YYYY")}
                {renderField("Assessment Type", "assessment_type", "SOC, ROC, Recert, etc")}
                {renderField("M0100 Assessment Reason", "m0100_assessment_reason")}
                {renderField("M0110 Episode Timing", "m0110_episode_timing", "1=Early, 2=Late")}
                {renderField("M0030 SOC Date", "m0030_soc_date", "MM/DD/YYYY")}
                {renderField("M1021 Primary Dx Code", "m1021_primary_dx_code", "ICD-10")}
                {renderField("M1023 Other Diagnoses", "m1023_other_diagnoses")}
              </TabsContent>

              <TabsContent value="functional" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  {renderField("M1800 Grooming (0-3)", "m1800_grooming")}
                  {renderField("M1810 Upper Dressing (0-3)", "m1810_dress_upper")}
                  {renderField("M1820 Lower Dressing (0-3)", "m1820_dress_lower")}
                  {renderField("M1830 Bathing (0-6)", "m1830_bathing")}
                  {renderField("M1840 Toilet Transfer (0-4)", "m1840_toilet_transfer")}
                  {renderField("M1850 Transferring (0-5)", "m1850_transferring")}
                  {renderField("M1860 Ambulation (0-6)", "m1860_ambulation")}
                </div>
                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2">GG Items</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("GG0130 Eating", "gg0130_eating")}
                    {renderField("GG0130 Oral Hygiene", "gg0130_oral_hygiene")}
                    {renderField("GG0130 Toileting", "gg0130_toileting")}
                    {renderField("GG0170 Sit to Lying", "gg0170_sit_to_lying")}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="clinical" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  {renderField("M1242 Pain Frequency (0-4)", "m1242_pain_frequency")}
                  {renderField("M1306 Pressure Ulcer (0-1)", "m1306_pressure_ulcer")}
                  {renderField("M1307 Pressure Ulcer Stage", "m1307_pressure_ulcer_stage")}
                  {renderField("M1400 Dyspnea (0-4)", "m1400_dyspnea")}
                  {renderField("M1620 Urinary Incontinence", "m1620_urinary_incontinence")}
                  {renderField("M1700 Cognitive Function", "m1700_cognitive_functioning")}
                  {renderField("M1710 Confusion Frequency", "m1710_confusion_frequency")}
                  {renderField("M1730 Depression PHQ-2", "m1730_depression_phq2")}
                </div>
                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2">Therapy Needs</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {renderField("PT Needed", "therapy_pt", "Yes/No")}
                    {renderField("OT Needed", "therapy_ot", "Yes/No")}
                    {renderField("SLP Needed", "therapy_slp", "Yes/No")}
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setExtractedData(null);
                  setEditedData(null);
                  setFile(null);
                  setFileUrl(null);
                  setAiInsights(null);
                  setFlaggedFields([]);
                  setCarePathways([]);
                }}
                className="flex-1"
              >
                Start Over
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={ai.loading}
                className="flex-1 bg-navy-600 hover:bg-navy-700"
              >
                <Send className="w-4 h-4 mr-2" />
                Confirm & Analyze
              </Button>
            </div>

            {/* Summary of AI Findings */}
            <div className="bg-navy-50 p-3 rounded border border-navy-200">
              <p className="text-xs text-navy-800 mb-2">
                <strong>AI Pre-Analysis Summary:</strong>
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-white p-2 rounded text-center">
                  <p className="text-red-600 font-bold">{aiInsights?.compliance_issues?.length || 0}</p>
                  <p className="text-slate-600">Compliance Issues</p>
                </div>
                <div className="bg-white p-2 rounded text-center">
                  <p className="text-orange-600 font-bold">{aiInsights?.clinical_concerns?.length || 0}</p>
                  <p className="text-slate-600">Clinical Concerns</p>
                </div>
                <div className="bg-white p-2 rounded text-center">
                  <p className="text-green-600 font-bold">{carePathways.length}</p>
                  <p className="text-slate-600">Care Pathways</p>
                </div>
              </div>
              <p className="text-xs text-navy-700 mt-2">
                Review flagged fields (highlighted in red) before confirming.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}