import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, CheckCircle2, Clock, FileText, Zap, Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export default function SmartDocumentationAssistant({ 
  patientId, 
  documentType = "care_plan", // care_plan, oasis, visit_note, admission
  onDataGenerated,
  autoFillEnabled = true,
  visitType = null,
  identifiedProblems = []
}) {
  const ai = useAICall();
  const [generatedData, setGeneratedData] = useState(null);
  const [appliedSections, setAppliedSections] = useState(new Set());
  const [editingSection, setEditingSection] = useState(null);

  // Fetch patient data
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000).then(patients => 
      patients.find(p => p.id === patientId)
    ),
    enabled: !!patientId
  });

  // Fetch recent visits
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 10),
    enabled: !!patientId,
    initialData: []
  });

  // Fetch clinical events
  const { data: clinicalEvents = [] } = useQuery({
    queryKey: ['clinicalEvents', patientId],
    queryFn: () => base44.entities.ClinicalEvent.filter({ patient_id: patientId }, '-event_date', 20),
    enabled: !!patientId,
    initialData: []
  });

  // Fetch care plans
  const { data: carePlans = [] } = useQuery({
    queryKey: ['carePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }, '-created_date', 10),
    enabled: !!patientId,
    initialData: []
  });

  const generateSmartDocumentation = useCallback(async () => {
    if (!patient) return;

    try {
      const context = {
        patient: {
          name: `${patient.first_name} ${patient.last_name}`,
          age: patient.date_of_birth,
          diagnosis: patient.primary_diagnosis,
          medications: patient.current_medications || [],
          allergies: patient.allergies,
          functional_status: patient.functional_status,
          baseline_vitals: patient.baseline_vitals
        },
        recentVisits: recentVisits.slice(0, 3).map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes,
          vitals: v.vital_signs
        })),
        clinicalEvents: clinicalEvents.slice(0, 5).map(e => ({
          type: e.event_type,
          date: e.event_date,
          description: e.event_description
        })),
        activeCarePlans: carePlans.filter(cp => cp.status === 'active')
      };

      let prompt = "";
      if (documentType === "care_plan") {
        const problemsContext = identifiedProblems.length > 0 
          ? `\n\nIDENTIFIED PROBLEMS TO ADDRESS:\n${identifiedProblems.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
          : '';
        
        prompt = `You are an expert Medicare-compliant care plan specialist. For each identified problem/nursing diagnosis, generate comprehensive care plan components.

Patient Context: ${JSON.stringify(context, null, 2)}${problemsContext}

For EACH problem, generate:
1. **Problem Statement**: Nursing diagnosis (not medical diagnosis) - use NANDA format
2. **SMART Goal**: Specific, Measurable, Achievable, Relevant, Time-bound goal (30-60 days)
3. **Interventions**: 4-6 evidence-based skilled nursing interventions that:
   - Require skilled nursing judgment and assessment
   - Are specific and measurable
   - Include patient/caregiver education
   - Address monitoring and coordination
4. **Baseline Measurement**: What to measure at start
5. **Frequency**: How often to assess (e.g., "Each visit", "Weekly")
6. **Expected Outcomes**: What success looks like
7. **Clinical Rationale**: Why this care plan is needed

Return detailed, ready-to-implement care plans that nurses can review and confirm.`;
      } else if (documentType === "visit_note") {
        const visitContext = visitType ? `\nVISIT TYPE: ${visitType}` : '';
        
        prompt = `You are an expert home health documentation specialist. Generate comprehensive visit note sections based on diagnosis, recent events, and visit type.

Patient Context: ${JSON.stringify(context, null, 2)}${visitContext}

Generate the following documentation sections:
1. **Subjective**: Patient/caregiver reported symptoms, concerns, changes since last visit
2. **Objective - Systems Assessment**: 
   - Cardiovascular
   - Respiratory
   - Integumentary (skin, wounds)
   - Musculoskeletal/Functional
   - Neurological/Cognitive
   - Gastrointestinal/Nutrition
   - Genitourinary
3. **Assessment**: Clinical interpretation of findings, progress toward goals, changes in condition
4. **Plan**: Specific interventions performed, patient/caregiver education provided, coordination activities, plan for next visit
5. **Homebound Status Documentation**: Specific reasons patient is confined to home
6. **Skilled Need Justification**: Why skilled nursing is required

Each section should be:
- Specific to this patient's diagnosis and recent events
- Medicare-compliant with clear skilled need
- Professional and detailed
- Include measurable observations

Provide suggestions with confidence levels and reasoning.`;
      } else if (documentType === "oasis") {
        prompt = `Generate preliminary OASIS assessment responses based on patient data:
- M1800 Grooming, M1810 Dressing, M1820 Bathing, M1830 Toileting, M1840 Transferring, M1850 Ambulation
- Suggest appropriate scores based on functional status and recent visit notes
- Include clinical reasoning for each suggestion

Patient Context: ${JSON.stringify(context, null, 2)}

Format as JSON with item_number, suggested_response, confidence_level, rationale`;
      } else if (documentType === "admission") {
        prompt = `Generate admission documentation sections:
1. Admission assessment summary
2. Current medications reconciliation
3. Initial care plan priorities
4. Patient/family education needs
5. Risk assessments (falls, pressure injury, readmission)

Patient Context: ${JSON.stringify(context, null, 2)}

Format as JSON with clear sections`;
      }

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_id: { type: "string" },
                  section_name: { type: "string" },
                  content: { type: "object" },
                  confidence: { type: "number" },
                  ai_reasoning: { type: "string" }
                }
              }
            }
          }
        }
      });

      setGeneratedData(response);
      if (onDataGenerated) {
        onDataGenerated(response);
      }
    } catch (error) {
      console.error("Smart documentation generation failed:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [carePlans, clinicalEvents, documentType, identifiedProblems, onDataGenerated, patient, recentVisits, visitType]);

  const applySection = (sectionId) => {
    setAppliedSections(prev => new Set([...prev, sectionId]));
    const section = generatedData.sections.find(s => s.section_id === sectionId);
    if (onDataGenerated) {
      onDataGenerated({ appliedSection: section });
    }
  };

  const handleEditSection = (section) => {
    setEditingSection({ ...section });
  };

  const handleSaveEdit = () => {
    if (editingSection) {
      const updatedSections = generatedData.sections.map(s => 
        s.section_id === editingSection.section_id ? editingSection : s
      );
      setGeneratedData({ ...generatedData, sections: updatedSections });
      setEditingSection(null);
    }
  };

  const handleApplyAll = () => {
    generatedData.sections.forEach(section => {
      if (!appliedSections.has(section.section_id)) {
        applySection(section.section_id);
      }
    });
  };

  useEffect(() => {
    if (autoFillEnabled && patient && !generatedData && !ai.loading) {
      generateSmartDocumentation();
    }
  }, [patient, autoFillEnabled, generateSmartDocumentation, generatedData, ai.loading]);

  if (!patient) return null;

  const getDocumentTypeLabel = () => {
    const labels = {
      care_plan: "Care Plan Components",
      visit_note: "Visit Note Sections",
      oasis: "OASIS Assessment Items",
      admission: "Admission Documentation"
    };
    return labels[documentType] || "Documentation";
  };

  return (
    <Card className="ai-card border-2 border-navy-300">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="w-5 h-5 text-navy-600" />
          Smart Documentation Assistant
          <Badge className="ai-badge ml-auto">{getDocumentTypeLabel()}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {ai.loading && (
          <Alert className="bg-blue-50 border-blue-300">
            <Clock className="w-4 h-4 text-blue-600 animate-spin" />
            <AlertDescription className="text-blue-900">
              <strong>Analyzing patient data...</strong>
              <p className="text-sm mt-1">Generating smart documentation based on {recentVisits.length} recent visits and {clinicalEvents.length} clinical events.</p>
            </AlertDescription>
          </Alert>
        )}

        {!ai.loading && !generatedData && (
          <Button 
            onClick={generateSmartDocumentation}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            <Zap className="w-4 h-4 mr-2" />
            Generate Smart Pre-Fill
          </Button>
        )}

        {generatedData?.sections && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">
                {generatedData.sections.length} sections generated - Review & Apply:
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleApplyAll}
                disabled={appliedSections.size === generatedData.sections.length}
                className="btn-ai text-xs"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Apply All
              </Button>
            </div>
            
            {generatedData.sections.map((section) => (
              <Card 
                key={section.section_id}
                className={cn(
                  "modern-card-interactive transition-all",
                  appliedSections.has(section.section_id) && 'bg-green-50 border-green-300'
                )}
              >
                <CardContent className="p-4">
                  {editingSection?.section_id === section.section_id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="section-name" className="text-xs font-medium text-slate-600">Section Name</label>
                        <input
                          id="section-name"
                          type="text"
                          value={editingSection.section_name}
                          onChange={(e) => setEditingSection({...editingSection, section_name: e.target.value})}
                          className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md"
                        />
                      </div>
                      <div>
                        <label htmlFor="section-content" className="text-xs font-medium text-slate-600">Content</label>
                        <textarea
                          id="section-content"
                          value={JSON.stringify(editingSection.content, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              setEditingSection({...editingSection, content: parsed});
                            } catch {
                              // Keep typing
                            }
                          }}
                          className="w-full mt-1 px-3 py-2 text-xs font-mono border rounded-md"
                          rows={8}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingSection(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" className="btn-success" onClick={handleSaveEdit}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="flex items-start gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-navy-600" />
                          <span className="font-semibold text-sm">{section.section_name}</span>
                          <Badge 
                            className={
                              section.confidence >= 0.9 ? "badge-success" :
                              section.confidence >= 0.7 ? "badge-info" :
                              "badge-warning"
                            }
                          >
                            {Math.round(section.confidence * 100)}% confident
                          </Badge>
                          {appliedSections.has(section.section_id) && (
                            <Badge className="badge-success">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Applied
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-xs text-slate-600 italic">
                          💡 {section.ai_reasoning}
                        </p>
                        
                        <div className="bg-white rounded-lg p-3 border border-slate-200 text-sm space-y-2">
                          {typeof section.content === 'object' && !Array.isArray(section.content) ? (
                            Object.entries(section.content).map(([key, value]) => (
                              <div key={key}>
                                <span className="font-medium text-slate-700 capitalize">
                                  {key.replace(/_/g, ' ')}:
                                </span>
                                {Array.isArray(value) ? (
                                  <ul className="ml-4 mt-1 space-y-1">
                                    {value.map((item, idx) => (
                                      <li key={idx} className="text-slate-600 flex items-start gap-2">
                                        <span className="text-navy-500 mt-1">•</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-slate-600 ml-2">{value}</p>
                                )}
                              </div>
                            ))
                          ) : (
                            <pre className="text-xs font-mono whitespace-pre-wrap text-slate-600">
                              {JSON.stringify(section.content, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        {!appliedSections.has(section.section_id) && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditSection(section)}
                              className="h-8 w-8 p-0"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => applySection(section.section_id)}
                              className="btn-ai h-8"
                            >
                              Apply
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            
            {appliedSections.size === generatedData.sections.length && (
              <Alert className="bg-green-50 border-green-300 mt-3">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <strong>All sections applied!</strong> Documentation has been pre-filled with AI-generated content.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}