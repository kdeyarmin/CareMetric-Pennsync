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
} from "lucide-react";
import { toast } from "sonner";
import ClinicalNoteAnalyzer from "@/components/smartNote/ClinicalNoteAnalyzer";
import DifferentialDiagnosisSuggester from "@/components/smartNote/DifferentialDiagnosisSuggester";
import MedicationCrossChecker from "@/components/smartNote/MedicationCrossChecker";
import AdverseEventPredictor from "@/components/smartNote/AdverseEventPredictor";
import FollowUpTasksSuggester from "@/components/smartNote/FollowUpTasksSuggester";

export default function SmartNoteAssistant() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchPatient, setSearchPatient] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState([]);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [activeTab, setActiveTab] = useState("patient");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);

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

  const toggleSection = (section) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const SectionHeader = ({ icon: Icon, title, badge, section }) => (
    <button
      onClick={() => toggleSection(section)}
      className="flex items-center justify-between w-full p-4 hover:bg-gray-50 rounded-t-lg"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5" />
        <span className="font-semibold text-gray-900">{title}</span>
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">Smart Note Assistant</h1>
          <p className="text-lg text-gray-600">
            AI-powered clinical decision support for comprehensive patient analysis
          </p>
        </div>

        {/* Progress indicator */}
        {extractedData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-xs text-gray-600">Step 1</p>
                    <p className="font-semibold text-green-700">Data Extracted</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-600">Step 2</p>
                    <p className="font-semibold text-blue-700">Diagnoses</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Pill className="w-5 h-5 text-orange-600" />
                  <div>
                    <p className="text-xs text-gray-600">Step 3</p>
                    <p className="font-semibold text-orange-700">Medications</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-600" />
                  <div>
                    <p className="text-xs text-gray-600">Step 4</p>
                    <p className="font-semibold text-red-700">Risks</p>
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
                        className={`w-full text-left p-3 border-b hover:bg-gray-50 transition ${
                          selectedPatient?.id === patient.id
                            ? "bg-blue-50 border-l-4 border-l-blue-600"
                            : ""
                        }`}
                      >
                        <p className="font-semibold text-gray-900">
                          {patient.first_name} {patient.last_name}
                        </p>
                        <p className="text-xs text-gray-600">
                          MRN: {patient.medical_record_number} | DOB:{" "}
                          {patient.date_of_birth}
                        </p>
                        {patient.primary_diagnosis && (
                          <p className="text-xs text-gray-500 mt-1">
                            Primary: {patient.primary_diagnosis}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {selectedPatient && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">
                          Selected: {selectedPatient.first_name}{" "}
                          {selectedPatient.last_name}
                        </p>
                        <p className="text-sm text-gray-600">
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

                <Button
                  className="w-full"
                  disabled={!selectedPatient}
                  onClick={() => setActiveTab("extraction")}
                >
                  Continue to Clinical Notes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Extraction Tab */}
          <TabsContent value="extraction" className="space-y-6">
            {selectedPatient && (
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <p className="text-sm text-gray-700">
                    <strong>Patient:</strong> {selectedPatient.first_name}{" "}
                    {selectedPatient.last_name} • MRN:{" "}
                    {selectedPatient.medical_record_number}
                  </p>
                </CardContent>
              </Card>
            )}
            <ClinicalNoteAnalyzer onDataExtracted={handleDataExtracted} />
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="clinical" className="space-y-6">
            {extractedData && (
              <>
                {/* Diagnoses Confirmation Section */}
                <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-600" />
                      Confirm Diagnoses
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-gray-600">
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
                <Card className="bg-gradient-to-r from-indigo-50 to-blue-50">
                  <CardHeader>
                    <CardTitle className="text-lg">Clinical Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">
                          Primary Diagnoses
                        </h4>
                        <div className="space-y-1">
                          {selectedDiagnoses.map((dx, idx) => (
                            <div
                              key={idx}
                              className="text-sm text-gray-700 flex items-center gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
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
                              <Pill className="w-4 h-4 text-blue-600" />
                              {med}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}