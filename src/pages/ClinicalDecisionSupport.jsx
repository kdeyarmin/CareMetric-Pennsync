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
    <div className="w-full max-w-full overflow-x-hidden min-w-0">
      <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto pb-20 sm:pb-6">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
            <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            Clinical Decision Support
          </h1>
          <p className="text-xs sm:text-sm md:text-base text-gray-600 dark:text-gray-400">
            AI-powered tools to assist with clinical decision-making
          </p>
        </div>

        {/* Patient Selection */}
        <Card className="mb-4 sm:mb-6">
          <CardHeader className="p-3 sm:p-4 md:p-6">
            <CardTitle className="text-sm sm:text-base">Select Patient</CardTitle>
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
            <div className="w-full overflow-x-auto mb-4">
              <TabsList className="inline-flex w-max min-w-full gap-1 p-1">
                <TabsTrigger value="alerts" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                  <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                  Best Practice
                </TabsTrigger>
                <TabsTrigger value="medications" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                  <Pill className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                  Medication
                </TabsTrigger>
                <TabsTrigger value="diagnosis" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                  <Brain className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                  Diagnosis
                </TabsTrigger>
              </TabsList>
            </div>

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
            <CardContent className="p-6 sm:p-8 md:p-12 text-center">
              <Activity className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-2">
                Select a Patient to Begin
              </h3>
              <p className="text-xs sm:text-sm text-gray-500">
                Choose a patient above to access clinical decision support tools
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}