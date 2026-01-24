import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, AlertTriangle, Pill, Activity } from "lucide-react";
import SearchablePatientSelect from "../components/ui/SearchablePatientSelect";
import DifferentialDiagnosisGenerator from "../components/clinical/DifferentialDiagnosisGenerator";
import MedicationInteractionChecker from "../components/clinical/MedicationInteractionChecker";
import ClinicalBestPracticeAlerts from "../components/clinical/ClinicalBestPracticeAlerts";

export default function ClinicalDecisionSupport() {
  const [selectedPatientId, setSelectedPatientId] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: selectedPatient } = useQuery({
    queryKey: ["patient", selectedPatientId],
    queryFn: async () => {
      const results = await base44.entities.Patient.filter({ id: selectedPatientId });
      return results[0];
    },
    enabled: !!selectedPatientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["patientVisits", selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }),
    initialData: [],
    enabled: !!selectedPatientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ["patientCarePlans", selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    initialData: [],
    enabled: !!selectedPatientId
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
          <Brain className="w-8 h-8 text-blue-600" />
          Clinical Decision Support
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          AI-powered tools to assist with clinical decision-making
        </p>
      </div>

      {/* Patient Selection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Patient</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchablePatientSelect
            patients={patients}
            selectedPatientId={selectedPatientId}
            onSelect={setSelectedPatientId}
          />
        </CardContent>
      </Card>

      {selectedPatient ? (
        <Tabs defaultValue="alerts" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="alerts">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Best Practice Alerts
            </TabsTrigger>
            <TabsTrigger value="medications">
              <Pill className="w-4 h-4 mr-2" />
              Medication Safety
            </TabsTrigger>
            <TabsTrigger value="diagnosis">
              <Brain className="w-4 h-4 mr-2" />
              Differential Diagnosis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-6">
            <ClinicalBestPracticeAlerts 
              patient={selectedPatient}
              visits={visits}
            />
          </TabsContent>

          <TabsContent value="medications" className="mt-6">
            <MedicationInteractionChecker patient={selectedPatient} />
          </TabsContent>

          <TabsContent value="diagnosis" className="mt-6">
            <DifferentialDiagnosisGenerator patient={selectedPatient} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              Select a Patient to Begin
            </h3>
            <p className="text-gray-500">
              Choose a patient above to access clinical decision support tools
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}