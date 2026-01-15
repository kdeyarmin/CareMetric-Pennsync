import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Brain,
  Wand2,
  Users,
  X,
  AlertTriangle,
  Loader2,
  Plus,
} from "lucide-react";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";
import { toast } from "sonner";
import { getProviderCompliancePrompt } from "@/components/utils/providerSpecificConfig";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CarePlanSuggestionsPanel from "@/components/smartNote/CarePlanSuggestionsPanel";
import NoteTemplateSelector from "@/components/smartNote/NoteTemplateSelector";

export default function SmartNoteAssistant() {
  const [selectedPatient, setSelectedPatient] = useState("no_patient");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [visitType, setVisitType] = useState("");
  const [selectedDiagnosis, setSelectedDiagnosis] = useState("");
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [roughNotes, setRoughNotes] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedNote, setEnhancedNote] = useState(null);
  const [complianceResults, setComplianceResults] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ["allPatients"],
    queryFn: async () => {
      return await base44.entities.Patient.list('-updated_date', 500);
    },
  });

  const createNewPatient = async () => {
    if (!newPatientData.first_name.trim() || !newPatientData.last_name.trim()) {
      toast.error("First and last name are required");
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await base44.entities.Patient.create({
        first_name: newPatientData.first_name,
        last_name: newPatientData.last_name,
        date_of_birth: newPatientData.date_of_birth || null,
        medical_record_number: newPatientData.medical_record_number || "",
      });

      setSelectedPatient(created.id);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: "",
      });
      toast.success("Patient created successfully");
    } catch (error) {
      toast.error("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
  };

  const enhanceNote = async () => {
    if (!roughNotes.trim()) {
      toast.error("Please enter clinical notes");
      return;
    }

    if (!visitType) {
      toast.error("Please select a visit type");
      return;
    }

    if (!selectedDiagnosis) {
      toast.error("Please select a diagnosis");
      return;
    }

    setEnhancing(true);
    setEnhancedNote(null);
    setComplianceResults(null);
    setShowResults(false);
    
    try {
      const compliancePrompt = getProviderCompliancePrompt(currentUser?.provider_type || 'RN', visitType);

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a healthcare documentation specialist. Analyze the following rough clinical note and:

1. Extract key clinical data (diagnoses, medications, symptoms, vital signs)
2. Enhance it into a Medicare-compliant, professional clinical note
3. Perform comprehensive compliance checks based on the visit type and diagnosis
4. Provide specific compliance feedback and suggestions

Visit Type: ${visitType}
Primary Diagnosis: ${selectedDiagnosis}
Provider Type: ${currentUser?.provider_type || 'RN'}
Compliance Requirements: ${compliancePrompt}

Rough Note:
${roughNotes}

Return your analysis in the following JSON format:
{
  "extracted_data": {
    "diagnoses": ["list of diagnoses found"],
    "medications": ["list of medications"],
    "symptoms": ["list of symptoms"],
    "vitals": {"temperature": "", "blood_pressure": "", "heart_rate": "", etc}
  },
  "enhanced_note": "The full Medicare-compliant enhanced clinical note with proper formatting",
  "compliance_check": {
    "compliance_score": 0-100,
    "status": "passed" | "flagged" | "critical",
    "issues": [{"element": "", "severity": "", "problem": "", "suggestion": ""}],
    "compliant_elements": ["list of elements that passed"]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            extracted_data: {
              type: "object",
              properties: {
                diagnoses: { type: "array", items: { type: "string" } },
                medications: { type: "array", items: { type: "string" } },
                symptoms: { type: "array", items: { type: "string" } },
                vitals: { type: "object" }
              }
            },
            enhanced_note: { type: "string" },
            compliance_check: {
              type: "object",
              properties: {
                compliance_score: { type: "number" },
                status: { type: "string" },
                issues: { type: "array" },
                compliant_elements: { type: "array" }
              }
            }
          }
        }
      });

      setExtractedData(result.extracted_data);
      setEnhancedNote(result.enhanced_note);
      setComplianceResults(result.compliance_check);
      setShowResults(true);
      
      toast.success("Note enhanced and compliance checked");
    } catch (error) {
      toast.error("Failed to enhance note");
      console.error(error);
    } finally {
      setEnhancing(false);
    }
  };

  const availableVisitTypes = currentUser?.provider_type 
    ? getVisitTypesForProvider(currentUser.provider_type)
    : [];

  // Common diagnoses list
  const commonDiagnoses = [
    "Congestive Heart Failure (CHF)",
    "Chronic Obstructive Pulmonary Disease (COPD)",
    "Diabetes Mellitus Type 2",
    "Hypertension",
    "Pneumonia",
    "Urinary Tract Infection (UTI)",
    "Wound Care - Pressure Ulcer",
    "Post-Surgical Care",
    "Chronic Kidney Disease",
    "Dementia/Alzheimer's Disease",
    "Stroke/CVA Recovery",
    "Cancer Care",
    "Palliative Care",
    "Chronic Pain Management",
    "Sepsis",
    "Cellulitis",
    "Dehydration",
    "Fall Risk/Fall Injury",
    "Malnutrition",
    "Depression"
  ];

  const filteredDiagnoses = diagnosisSearch.trim()
    ? commonDiagnoses.filter(d => 
        d.toLowerCase().includes(diagnosisSearch.toLowerCase())
      )
    : commonDiagnoses;

  const getSelectedPatientData = () => {
    if (selectedPatient === "no_patient" || selectedPatient === "create_new") return null;
    return allPatients.find(p => p.id === selectedPatient);
  };

  const patientData = getSelectedPatientData();

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-6 overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-4 w-full">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Smart Note Assistant</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            AI-powered documentation with compliance checking
          </p>
        </div>

        {!showResults ? (
          <>
            {/* Streamlined Input Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5" />
                  Clinical Documentation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Patient Selection Dropdown */}
                <div>
                  <Label className="text-sm font-medium">Patient *</Label>
                  <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select patient..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="no_patient">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span>No Patient Data (Anonymous)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="create_new">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4 text-blue-500" />
                          <span>Create New Patient</span>
                        </div>
                      </SelectItem>
                      {allPatients.map((patient) => (
                        <SelectItem key={patient.id} value={patient.id}>
                          {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPatient === "no_patient" && (
                    <p className="text-xs text-orange-600 mt-1">
                      ⚠️ Note will not be saved to patient records
                    </p>
                  )}
                  {patientData && (
                    <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-sm">
                      <strong>Selected:</strong> {patientData.first_name} {patientData.last_name}
                      {patientData.primary_diagnosis && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          Primary: {patientData.primary_diagnosis}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Visit Type & Diagnosis */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Visit Type *</Label>
                    <Select value={visitType} onValueChange={setVisitType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visit type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableVisitTypes.map((vt) => (
                          <SelectItem key={vt.id} value={vt.id}>
                            {vt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Primary Diagnosis *</Label>
                    <Select value={selectedDiagnosis} onValueChange={setSelectedDiagnosis}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select diagnosis..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {commonDiagnoses.map((diagnosis, idx) => (
                          <SelectItem key={idx} value={diagnosis}>
                            {diagnosis}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Template Selector */}
                {visitType && currentUser?.provider_type && (
                  <NoteTemplateSelector
                    visitType={visitType}
                    providerType={currentUser.provider_type}
                    onSelectTemplate={(formattedNote, template) => {
                      setRoughNotes(formattedNote);
                      setSelectedTemplate(template);
                    }}
                  />
                )}

                {/* Vital Signs */}
                <div>
                  <Label className="text-sm font-medium">Vital Signs</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Temperature (°F)</label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="98.6"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Heart Rate (bpm)</label>
                      <Input
                        type="number"
                        placeholder="72"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Resp Rate</label>
                      <Input
                        type="number"
                        placeholder="16"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Systolic</label>
                      <Input
                        type="number"
                        placeholder="120"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Diastolic</label>
                      <Input
                        type="number"
                        placeholder="80"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">O2 Sat (%)</label>
                      <Input
                        type="number"
                        placeholder="98"
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>

                {/* Rough Notes Input */}
                <div>
                  <Label className="text-sm font-medium">Clinical Notes *</Label>
                  <textarea
                    value={roughNotes}
                    onChange={(e) => setRoughNotes(e.target.value)}
                    placeholder="Enter your rough clinical notes here...

Example: Patient reports feeling better, pain level 2/10. Medications reviewed, compliant. Wound healing well, no signs of infection. Patient ambulating with walker..."
                    className="w-full h-48 p-3 border rounded-lg text-sm resize-none"
                  />
                </div>

                {/* Enhance Button */}
                <Button
                  onClick={enhanceNote}
                  disabled={enhancing || !visitType || !selectedDiagnosis || !roughNotes.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 h-12"
                  size="lg"
                >
                  {enhancing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Enhancing Note & Running Compliance Checks...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5 mr-2" />
                      Enhance Note
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* Results Page */}
            <div className="space-y-4">
              {/* Enhanced Note Display */}
              <Card className="border-green-300 bg-green-50 dark:bg-green-950">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Enhanced Compliant Note
                    </span>
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(enhancedNote);
                        toast.success("Enhanced note copied");
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Copy Note
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-lg text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {enhancedNote}
                  </div>
                </CardContent>
              </Card>

              {/* Compliance Results */}
              {complianceResults && (
                <Card className={
                  complianceResults.status === 'passed' ? 'border-green-300 bg-green-50' :
                  complianceResults.status === 'critical' ? 'border-red-300 bg-red-50' :
                  'border-yellow-300 bg-yellow-50'
                }>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Compliance Analysis</span>
                      <span className={`text-3xl font-bold ${
                        complianceResults.compliance_score >= 90 ? 'text-green-600' :
                        complianceResults.compliance_score >= 70 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {complianceResults.compliance_score}%
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {complianceResults.compliant_elements?.length > 0 && (
                      <div>
                        <h5 className="font-semibold text-green-800 mb-2">✓ Compliant Elements</h5>
                        <ul className="space-y-1">
                          {complianceResults.compliant_elements.map((element, idx) => (
                            <li key={idx} className="text-sm text-green-700">• {element}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {complianceResults.issues?.length > 0 && (
                      <div>
                        <h5 className="font-semibold text-red-800 mb-2">⚠ Issues Found</h5>
                        <div className="space-y-3">
                          {complianceResults.issues.map((issue, idx) => (
                            <div key={idx} className="bg-white p-3 rounded border border-red-200">
                              <div className="flex items-start gap-2 mb-1">
                                <Badge className={
                                  issue.severity === 'critical' ? 'bg-red-600' :
                                  issue.severity === 'high' ? 'bg-orange-500' :
                                  'bg-yellow-500'
                                }>
                                  {issue.severity}
                                </Badge>
                                <p className="font-medium text-sm">{issue.element}</p>
                              </div>
                              <p className="text-sm text-red-700 mb-2">{issue.problem}</p>
                              <p className="text-sm text-green-700 bg-green-50 p-2 rounded">
                                💡 {issue.suggestion}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Care Plan Suggestions */}
              {patientData && (currentUser?.provider_type === 'RN' || currentUser?.provider_type === 'MSW') && (
                <CarePlanSuggestionsPanel
                  patientId={patientData.id}
                  visitType={visitType}
                  diagnosis={selectedDiagnosis}
                  noteContent={enhancedNote}
                />
              )}

              {/* Start Over Button */}
              <Button
                onClick={() => {
                  setShowResults(false);
                  setEnhancedNote(null);
                  setComplianceResults(null);
                  setRoughNotes("");
                }}
                variant="outline"
                className="w-full"
              >
                Create Another Note
              </Button>
            </div>
          </>
        )}

        {/* Create Patient Dialog */}
        {(showCreatePatient || selectedPatient === "create_new") && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Create New Patient</CardTitle>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setShowCreatePatient(false);
                      setSelectedPatient("no_patient");
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>First Name *</Label>
                  <Input
                    value={newPatientData.first_name}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        first_name: e.target.value,
                      })
                    }
                    placeholder="John"
                  />
                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input
                    value={newPatientData.last_name}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        last_name: e.target.value,
                      })
                    }
                    placeholder="Doe"
                  />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={newPatientData.date_of_birth}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        date_of_birth: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Medical Record Number</Label>
                  <Input
                    value={newPatientData.medical_record_number}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        medical_record_number: e.target.value,
                      })
                    }
                    placeholder="MRN-12345"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowCreatePatient(false);
                      setSelectedPatient("no_patient");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={createNewPatient}
                    disabled={creatingPatient}
                  >
                    {creatingPatient ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Patient"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
                    </div>
                    </div>
                    );
                    }