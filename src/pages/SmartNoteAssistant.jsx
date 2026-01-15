import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Brain,
  Pill,
  Heart,
  ListTodo,
  Wand2,
  Users,
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";
import { toast } from "sonner";
import ClinicalNoteAnalyzer from "@/components/smartNote/ClinicalNoteAnalyzer";
import DifferentialDiagnosisSuggester from "@/components/smartNote/DifferentialDiagnosisSuggester";
import MedicationCrossChecker from "@/components/smartNote/MedicationCrossChecker";
import AdverseEventPredictor from "@/components/smartNote/AdverseEventPredictor";
import FollowUpTasksSuggester from "@/components/smartNote/FollowUpTasksSuggester";
import AIRealTimeDecisionSupport from "@/components/ai/AIRealTimeDecisionSupport";
import ComplianceBillingOptimizer from "@/components/compliance/ComplianceBillingOptimizer";
import InvoiceGenerator from "@/components/billing/InvoiceGenerator";
import CarePlanSuggestionsPanel from "@/components/smartNote/CarePlanSuggestionsPanel";
import { hasPageAccess } from "@/components/utils/providerAccessControl";
import SpecializationContextualSuggestions from "@/components/smartNote/SpecializationContextualSuggestions";
import SpecializationDocumentationTemplate from "@/components/smartNote/SpecializationDocumentationTemplate";
import SpecializationComplianceChecker from "@/components/smartNote/SpecializationComplianceChecker";

export default function SmartNoteAssistant() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchPatient, setSearchPatient] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState([]);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState("");
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState({});
  const [activeTab, setActiveTab] = useState("patient");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [visitType, setVisitType] = useState("");
  const [vitals, setVitals] = useState({
    temperature: "",
    blood_pressure_systolic: "",
    blood_pressure_diastolic: "",
    heart_rate: "",
    respiratory_rate: "",
    oxygen_saturation: "",
  });
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients", searchPatient],
    queryFn: async () => {
      if (!searchPatient.trim()) return [];
      const results = await base44.entities.Patient.filter(
        {
          $or: [
            { first_name: { $regex: searchPatient, $options: "i" } },
            { last_name: { $regex: searchPatient, $options: "i" } },
            { medical_record_number: searchPatient },
          ],
        },
        "-updated_date",
        10
      );
      return results;
    },
  });

  const handleDataExtracted = (data) => {
    setExtractedData(data);
    if (data.diagnoses) {
      setSelectedDiagnoses(data.diagnoses);
    }
    setActiveTab("clinical");
  };

  const toggleDiagnosis = (diagnosis) => {
    setSelectedDiagnoses((prev) =>
      prev.includes(diagnosis)
        ? prev.filter((d) => d !== diagnosis)
        : [...prev, diagnosis]
    );
  };

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

      setSelectedPatient(created);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: "",
      });
      toast.success("Patient created successfully");
      setActiveTab("extraction");
    } catch (error) {
      toast.error("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
  };

  const toggleSection = (section) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const isAnalysisReady = () => {
    return visitType && selectedDiagnoses.length > 0;
  };

  const getMissingRequirements = () => {
    const missing = [];
    if (!visitType) missing.push("Visit type");
    if (selectedDiagnoses.length === 0) missing.push("At least one diagnosis");
    return missing;
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

  const SectionHeader = ({ icon: Icon, title, badge, section }) => (
    <button
      onClick={() => toggleSection(section)}
      className="flex items-center justify-between w-full p-4 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-t-lg"
      >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-slate-700 dark:text-slate-400" />
        <span className="font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        {badge && <Badge variant="secondary">{badge}</Badge>}
      </div>
      {collapsedSections[section] ? (
        <ChevronDown className="w-5 h-5" />
      ) : (
        <ChevronUp className="w-5 h-5" />
      )}
    </button>
  );

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-6 overflow-x-hidden">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 w-full">
        {/* Header */}
         <div className="space-y-2">
           <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100">Smart Note Assistant</h1>
             <p className="text-sm sm:text-base md:text-lg text-slate-600 dark:text-slate-400">
            AI-powered clinical decision support for comprehensive patient analysis
          </p>
        </div>

        {/* Progress indicator */}
        {extractedData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <Card className="border-slate-300 bg-slate-200 dark:bg-slate-800 dark:border-slate-600">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Step 1</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Data Extracted</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-300 bg-slate-200 dark:bg-slate-800 dark:border-slate-600">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Step 2</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Diagnoses</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-300 bg-slate-200 dark:bg-slate-800 dark:border-slate-600">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Pill className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Step 3</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Medications</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-300 bg-slate-200 dark:bg-slate-800 dark:border-slate-600">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Heart className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Step 4</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Risks</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabbed interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="patient">
              <Users className="w-4 h-4 mr-2" />
              Patient
            </TabsTrigger>
            <TabsTrigger value="extraction">
              <Wand2 className="w-4 h-4 mr-2" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="clinical" disabled={!extractedData}>
              <Brain className="w-4 h-4 mr-2" />
              Analysis
            </TabsTrigger>
          </TabsList>

          {/* Patient Selection Tab */}
          <TabsContent value="patient" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Select Patient
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Search Patient
                  </label>
                  <input
                    type="text"
                    placeholder="Search by name or MRN..."
                    value={searchPatient}
                    onChange={(e) => setSearchPatient(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>

                {patients.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border rounded-lg">
                    {patients.map((patient) => (
                      <button
                        key={patient.id}
                        onClick={() => {
                          setSelectedPatient(patient);
                          setActiveTab("extraction");
                        }}
                        className={`w-full text-left p-3 border-b hover:bg-slate-100 dark:hover:bg-slate-700 transition ${
                          selectedPatient?.id === patient.id
                            ? "bg-slate-200 dark:bg-slate-700 border-l-4 border-l-slate-600"
                            : ""
                        }`}
                      >
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {patient.first_name} {patient.last_name}
                        </p>
                         <p className="text-xs text-slate-600 dark:text-slate-400">
                           MRN: {patient.medical_record_number} | DOB:{" "}
                           {patient.date_of_birth}
                         </p>
                         {patient.primary_diagnosis && (
                           <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            Primary: {patient.primary_diagnosis}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2 border-dashed"
                  onClick={() => setShowCreatePatient(true)}
                >
                  + Create New Patient
                </Button>

                {selectedPatient && (
                  <div className="bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-4">
                     <div className="flex items-start justify-between">
                       <div>
                         <p className="font-semibold text-slate-900 dark:text-slate-100">
                           Selected: {selectedPatient.first_name}{" "}
                           {selectedPatient.last_name}
                         </p>
                         <p className="text-sm text-slate-600 dark:text-slate-400">
                          MRN: {selectedPatient.medical_record_number}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedPatient(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t">
                  <p className="text-xs text-gray-600 text-center">Or analyze without saving to a patient:</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setSelectedPatient(null);
                      setActiveTab("extraction");
                    }}
                  >
                    Analyze Anonymously
                  </Button>
                  <Button
                    className="w-full"
                    disabled={!selectedPatient}
                    onClick={() => setActiveTab("extraction")}
                  >
                    Continue to Clinical Notes
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Create Patient Dialog */}
            {showCreatePatient && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="w-full max-w-md mx-4">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Create New Patient</CardTitle>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setShowCreatePatient(false)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        First Name *
                      </label>
                      <input
                        type="text"
                        value={newPatientData.first_name}
                        onChange={(e) =>
                          setNewPatientData({
                            ...newPatientData,
                            first_name: e.target.value,
                          })
                        }
                        placeholder="John"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        value={newPatientData.last_name}
                        onChange={(e) =>
                          setNewPatientData({
                            ...newPatientData,
                            last_name: e.target.value,
                          })
                        }
                        placeholder="Doe"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        Date of Birth
                      </label>
                      <input
                        type="date"
                        value={newPatientData.date_of_birth}
                        onChange={(e) =>
                          setNewPatientData({
                            ...newPatientData,
                            date_of_birth: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        Medical Record Number
                      </label>
                      <input
                        type="text"
                        value={newPatientData.medical_record_number}
                        onChange={(e) =>
                          setNewPatientData({
                            ...newPatientData,
                            medical_record_number: e.target.value,
                          })
                        }
                        placeholder="MRN-12345"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setShowCreatePatient(false)}
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
          </TabsContent>

          {/* Extraction Tab */}
          <TabsContent value="extraction" className="space-y-6">
            {selectedPatient ? (
              <Card className="bg-slate-200 border-slate-300 dark:bg-slate-800 dark:border-slate-600">
                <CardContent className="pt-6">
                  <p className="text-sm text-slate-900 dark:text-slate-100">
                    <strong>Patient:</strong> {selectedPatient.first_name}{" "}
                    {selectedPatient.last_name} • MRN:{" "}
                    {selectedPatient.medical_record_number}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-slate-200 border-slate-300 dark:bg-slate-800 dark:border-slate-600">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-slate-700 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-slate-900 dark:text-slate-100 font-semibold mb-1">Anonymous Mode</p>
                      <p className="text-sm text-slate-800 dark:text-slate-200">
                        No patient information will be saved. The note can be checked for compliance and enhanced, but won't be stored in patient records.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Visit Type Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5" />
                  Visit Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-900 dark:text-slate-100 block mb-2">
                       Visit Type *
                     </label>
                    <select
                      value={visitType}
                      onChange={(e) => setVisitType(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="">Select visit type...</option>
                      {availableVisitTypes.map((vt) => (
                        <option key={vt.id} value={vt.id}>
                          {vt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-900 dark:text-slate-100 block mb-2">
                      Primary Diagnosis *
                    </label>
                    <input
                      type="text"
                      placeholder="Search diagnoses..."
                      value={diagnosisSearch}
                      onChange={(e) => setDiagnosisSearch(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
                    />
                    {diagnosisSearch && (
                      <div className="max-h-48 overflow-y-auto border rounded-lg bg-white dark:bg-slate-900">
                        {filteredDiagnoses.map((diagnosis, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedDiagnosis(diagnosis);
                              setDiagnosisSearch("");
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm border-b last:border-b-0"
                          >
                            {diagnosis}
                          </button>
                        ))}
                        {filteredDiagnoses.length === 0 && (
                          <div className="px-3 py-2 text-sm text-slate-500">No matches found</div>
                        )}
                      </div>
                    )}
                    {selectedDiagnosis && (
                      <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 mt-2">
                        <span className="text-sm text-slate-900 dark:text-slate-100">{selectedDiagnosis}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedDiagnosis("")}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vitals Input */}
                <div>
                  <label className="text-sm font-medium text-slate-900 dark:text-slate-100 block mb-2">
                     Vital Signs (at least one required) *
                   </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">Temperature (°F)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={vitals.temperature}
                        onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                        placeholder="98.6"
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">Heart Rate (bpm)</label>
                      <input
                        type="number"
                        value={vitals.heart_rate}
                        onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })}
                        placeholder="72"
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-slate-600 dark:text-slate-400">Blood Pressure (mmHg)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={vitals.blood_pressure_systolic}
                          onChange={(e) => setVitals({ ...vitals, blood_pressure_systolic: e.target.value })}
                          placeholder="120"
                          className="flex-1 px-2 py-1.5 border rounded text-sm"
                        />
                        <span className="flex items-center">/</span>
                        <input
                          type="number"
                          value={vitals.blood_pressure_diastolic}
                          onChange={(e) => setVitals({ ...vitals, blood_pressure_diastolic: e.target.value })}
                          placeholder="80"
                          className="flex-1 px-2 py-1.5 border rounded text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">Respiratory Rate</label>
                      <input
                        type="number"
                        value={vitals.respiratory_rate}
                        onChange={(e) => setVitals({ ...vitals, respiratory_rate: e.target.value })}
                        placeholder="16"
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">O2 Saturation (%)</label>
                      <input
                        type="number"
                        value={vitals.oxygen_saturation}
                        onChange={(e) => setVitals({ ...vitals, oxygen_saturation: e.target.value })}
                        placeholder="98"
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Specialization-Based Documentation Template */}
            {currentUser?.provider_type && selectedPatient && (
              <SpecializationDocumentationTemplate
                providerEmail={currentUser?.email}
                specialtyCode={currentUser?.primary_specialty_code || currentUser?.provider_type?.toLowerCase()}
                diagnosis={extractedData?.diagnoses?.[0] || selectedDiagnoses[0] || ''}
                visitType={visitType}
                onTemplateApplied={(content) => setGeneratedNote(prev => `${prev}\n\n${content}`)}
              />
            )}

            <ClinicalNoteAnalyzer onDataExtracted={handleDataExtracted} />
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="clinical" className="space-y-6">
            {!isAnalysisReady() ? (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-6">
                  <div className="flex gap-4 items-start">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-amber-900 mb-2">Missing Requirements</h4>
                      <p className="text-sm text-amber-800 mb-3">
                        Before analysis, please complete the following:
                      </p>
                      <ul className="space-y-1">
                        {getMissingRequirements().map((req, idx) => (
                          <li key={idx} className="text-sm text-slate-800 dark:text-slate-200">
                            • {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {extractedData && (
                  <>
                    {/* Diagnoses Confirmation Section */}
                <Card className="bg-slate-200 border-slate-300 dark:bg-slate-800 dark:border-slate-600">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                      Confirm Diagnoses
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-900 dark:text-slate-100">
                      Select the diagnoses applicable to this patient:
                    </p>
                    <div className="space-y-2">
                      {extractedData.diagnoses?.map((diagnosis, idx) => (
                        <label
                          key={idx}
                          className="flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-white/50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDiagnoses.includes(diagnosis)}
                            onChange={() => toggleDiagnosis(diagnosis)}
                            className="w-4 h-4 rounded"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {diagnosis}
                          </span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Differential Diagnosis Section */}
                <Card>
                  <SectionHeader
                    icon={Brain}
                    title="Differential Diagnosis Analysis"
                    badge={extractedData.diagnoses?.length}
                    section="diagnosis"
                  />
                  {!collapsedSections.diagnosis && (
                    <CardContent className="pt-0">
                      <DifferentialDiagnosisSuggester
                        symptoms={extractedData.symptoms?.join(", ") || ""}
                        patientHistory={extractedData.patient_history}
                      />
                    </CardContent>
                  )}
                </Card>

                {/* Medication Cross-Check Section */}
                <Card>
                  <SectionHeader
                    icon={Pill}
                    title="Medication Safety Check"
                    badge={extractedData.medications?.length}
                    section="medications"
                  />
                  {!collapsedSections.medications && (
                    <CardContent className="pt-0">
                      <MedicationCrossChecker
                        medications={extractedData.medications?.join("\n") || ""}
                        diagnoses={selectedDiagnoses.join(", ") || extractedData.diagnoses?.join(", ") || ""}
                      />
                    </CardContent>
                  )}
                </Card>

                {/* Adverse Event Prediction Section */}
                <Card>
                  <SectionHeader
                    icon={AlertCircle}
                    title="Adverse Event Risk Assessment"
                    section="adverse"
                  />
                  {!collapsedSections.adverse && (
                    <CardContent className="pt-0">
                      <AdverseEventPredictor
                        patientData={`Vitals: ${JSON.stringify(extractedData.vitals)}\nDiagnoses: ${extractedData.diagnoses?.join(", ")}\nMedications: ${extractedData.medications?.join(", ")}`}
                      />
                    </CardContent>
                  )}
                </Card>

                {/* Real-Time Clinical Support & Compliance */}
                <div className="grid md:grid-cols-2 gap-6">
                  <AIRealTimeDecisionSupport
                    patient={selectedPatient}
                    currentNotes={generatedNote}
                    visitType={visitType}
                    diagnosis={selectedDiagnoses.join(", ")}
                    medications={extractedData.medications || []}
                  />

                  <ComplianceBillingOptimizer
                    currentNotes={generatedNote}
                    visitType={visitType}
                    diagnosis={selectedDiagnoses.join(", ")}
                    patient={selectedPatient}
                  />
                </div>

                {/* Specialization Contextual Suggestions */}
            <SpecializationContextualSuggestions
              patientDiagnosis={selectedDiagnoses.join(", ")}
              providerEmail={currentUser?.email}
              noteContent={generatedNote}
              onSuggestionApplied={(text) => setGeneratedNote(prev => `${prev}\n\n${text}`)}
            />

            {/* Real-Time Specialization Compliance Checker */}
            <SpecializationComplianceChecker
              specialtyCode={currentUser?.primary_specialty_code || currentUser?.provider_type?.toLowerCase()}
              noteContent={generatedNote}
              diagnosis={selectedDiagnoses.join(", ")}
              visitType={visitType}
              providerEmail={currentUser?.email}
            />

                {/* Care Plan Suggestions for RN and MSW */}
                {(currentUser?.provider_type === 'RN' || currentUser?.provider_type === 'MSW') && (
                  <CarePlanSuggestionsPanel
                    patientId={selectedPatient?.id}
                    visitType={visitType}
                    diagnosis={selectedDiagnoses.join(", ")}
                    noteContent={generatedNote}
                  />
                )}

                {/* Follow-Up Tasks Section */}
                <Card>
                  <SectionHeader
                    icon={ListTodo}
                    title="Care Coordination Tasks"
                    section="followup"
                  />
                  {!collapsedSections.followup && (
                    <CardContent className="pt-0">
                      <FollowUpTasksSuggester
                        analysisResults={JSON.stringify(extractedData)}
                        extractedData={extractedData}
                      />
                    </CardContent>
                  )}
                </Card>

                {/* Summary Section */}
                <Card className="bg-slate-200 border-slate-300 dark:bg-slate-800 dark:border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-lg text-slate-900 dark:text-slate-100">Clinical Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
                          Primary Diagnoses
                        </h4>
                        <div className="space-y-1">
                          {selectedDiagnoses.map((dx, idx) => (
                            <div
                              key={idx}
                              className="text-sm text-gray-700 flex items-center gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4 text-slate-700 dark:text-slate-400" />
                              {dx}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">
                          Current Medications
                        </h4>
                        <div className="space-y-1">
                          {extractedData.medications?.map((med, idx) => (
                            <div
                              key={idx}
                              className="text-sm text-gray-700 flex items-center gap-2"
                            >
                              <Pill className="w-4 h-4 text-slate-700 dark:text-slate-400" />
                              {med}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="border-t pt-4 mt-4">
                      <Button
                        onClick={() => setShowInvoiceGenerator(!showInvoiceGenerator)}
                        className="w-full bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
                      >
                        {showInvoiceGenerator ? 'Hide Invoice Generator' : 'Generate Invoice'}
                      </Button>
                    </div>
                    {showInvoiceGenerator && (
                      <div className="mt-4 pt-4 border-t">
                        <InvoiceGenerator
                          patientId={selectedPatient?.id}
                          visitType={visitType}
                          diagnosis={selectedDiagnoses[0] || ''}
                          clinicalNote={generatedNote}
                          onInvoiceCreated={() => {
                            setShowInvoiceGenerator(false);
                            toast.success('Invoice created successfully');
                          }}
                        />
                      </div>
                    )}
                    </CardContent>
                    </Card>
                    </>
                    )}
                    </>
                    )}
                    </TabsContent>
                    </Tabs>
                    </div>
                    </div>
                    );
                    }