import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, FileText, Pill, AlertTriangle, Syringe, Download } from "lucide-react";

export default function PatientHealthRecordViewer() {
  const [selectedRecord, setSelectedRecord] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: healthRecords } = useQuery({
    queryKey: ["healthRecords", currentUser?.id],
    queryFn: () => currentUser ? base44.entities.HealthRecord.filter({ patient_id: currentUser.id }) : Promise.resolve([]),
    enabled: !!currentUser?.id,
    initialData: []
  });

  const { data: immunizations } = useQuery({
    queryKey: ["immunizations", currentUser?.id],
    queryFn: () => currentUser ? base44.entities.Immunization.filter({ patient_id: currentUser.id }) : Promise.resolve([]),
    enabled: !!currentUser?.id,
    initialData: []
  });

  const { data: patient } = useQuery({
    queryKey: ["patientData", currentUser?.id],
    queryFn: () => currentUser ? base44.entities.Patient.filter({ id: currentUser.id }) : Promise.resolve([]),
    enabled: !!currentUser?.id,
    initialData: []
  });

  const patientData = patient[0];

  const getRecordIcon = (type) => {
    const icons = {
      diagnosis: <AlertTriangle className="w-4 h-4" />,
      medication: <Pill className="w-4 h-4" />,
      allergy: <AlertCircle className="w-4 h-4" />,
      lab_result: <FileText className="w-4 h-4" />,
      imaging: <FileText className="w-4 h-4" />,
      clinical_note: <FileText className="w-4 h-4" />
    };
    return icons[type] || <FileText className="w-4 h-4" />;
  };

  const getSignificanceColor = (level) => {
    const colors = {
      low: "bg-blue-100 text-blue-800",
      moderate: "bg-yellow-100 text-yellow-800",
      high: "bg-orange-100 text-orange-800",
      critical: "bg-red-100 text-red-800"
    };
    return colors[level] || "bg-gray-100 text-gray-800";
  };

  const diagnoses = healthRecords.filter(r => r.record_type === 'diagnosis');
  const medications = healthRecords.filter(r => r.record_type === 'medication');
  const allergies = healthRecords.filter(r => r.record_type === 'allergy');
  const labResults = healthRecords.filter(r => r.record_type === 'lab_result');

  return (
    <div className="space-y-6">
      {/* Quick Health Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Active Diagnoses</p>
            <p className="text-3xl font-bold">{diagnoses.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Current Medications</p>
            <p className="text-3xl font-bold">{patientData?.current_medications?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Known Allergies</p>
            <p className="text-3xl font-bold">{allergies.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Immunizations</p>
            <p className="text-3xl font-bold">{immunizations.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Records */}
      <Tabs defaultValue="allergies" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="allergies">Allergies</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
          <TabsTrigger value="immunizations">Immunizations</TabsTrigger>
        </TabsList>

        {/* Allergies Tab */}
        <TabsContent value="allergies">
          <Card>
            <CardHeader>
              <CardTitle>Allergies & Adverse Reactions</CardTitle>
            </CardHeader>
            <CardContent>
              {patientData?.allergies ? (
                <div className="space-y-3">
                  <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                    <p className="text-sm font-semibold text-red-900">Known Allergies:</p>
                    <p className="text-sm text-red-800 mt-1">{patientData.allergies}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No allergies recorded</p>
              )}

              {allergies.length > 0 && (
                <div className="mt-4 space-y-3">
                  {allergies.map(allergy => (
                    <div key={allergy.id} className="border rounded-lg p-3">
                      <p className="font-semibold">{allergy.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{allergy.description}</p>
                      <div className="flex justify-between items-center mt-2">
                        <Badge className={getSignificanceColor(allergy.clinical_significance)}>
                          {allergy.clinical_significance}
                        </Badge>
                        <p className="text-xs text-gray-500">{new Date(allergy.record_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Medications Tab */}
        <TabsContent value="medications">
          <Card>
            <CardHeader>
              <CardTitle>Current Medications</CardTitle>
            </CardHeader>
            <CardContent>
              {patientData?.current_medications && patientData.current_medications.length > 0 ? (
                <div className="space-y-3">
                  {patientData.current_medications.map((med, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <p className="font-semibold">{med.name}</p>
                      <div className="text-sm text-gray-600 mt-2 space-y-1">
                        <p><span className="font-medium">Dosage:</span> {med.dosage}</p>
                        <p><span className="font-medium">Frequency:</span> {med.frequency}</p>
                        {med.prescriber && <p><span className="font-medium">Prescriber:</span> {med.prescriber}</p>}
                        {med.start_date && <p><span className="font-medium">Started:</span> {new Date(med.start_date).toLocaleDateString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No medications recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Diagnoses Tab */}
        <TabsContent value="diagnoses">
          <Card>
            <CardHeader>
              <CardTitle>Medical Diagnoses</CardTitle>
            </CardHeader>
            <CardContent>
              {patientData?.primary_diagnosis && (
                <div className="mb-4 bg-orange-50 border-l-4 border-orange-500 p-4 rounded">
                  <p className="text-sm font-semibold text-orange-900">Primary Diagnosis:</p>
                  <p className="text-sm text-orange-800 mt-1">{patientData.primary_diagnosis}</p>
                </div>
              )}

              {patientData?.secondary_diagnoses && patientData.secondary_diagnoses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Secondary Diagnoses:</p>
                  {patientData.secondary_diagnoses.map((diag, idx) => (
                    <div key={idx} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                      {diag}
                    </div>
                  ))}
                </div>
              )}

              {diagnoses.length > 0 && (
                <div className="mt-4 space-y-3">
                  {diagnoses.map(diag => (
                    <div key={diag.id} className="border rounded-lg p-3">
                      <p className="font-semibold">{diag.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{diag.description}</p>
                      <div className="flex justify-between items-center mt-2">
                        <Badge className={getSignificanceColor(diag.clinical_significance)}>
                          {diag.clinical_significance}
                        </Badge>
                        <p className="text-xs text-gray-500">{new Date(diag.record_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!patientData?.primary_diagnosis && diagnoses.length === 0 && (
                <p className="text-sm text-gray-500">No diagnoses recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Immunizations Tab */}
        <TabsContent value="immunizations">
          <Card>
            <CardHeader>
              <CardTitle>Immunization Records</CardTitle>
            </CardHeader>
            <CardContent>
              {immunizations.length === 0 ? (
                <p className="text-sm text-gray-500">No immunization records available</p>
              ) : (
                <div className="space-y-3">
                  {immunizations.map(imm => (
                    <div key={imm.id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold flex items-center gap-2">
                            <Syringe className="w-4 h-4" />
                            {imm.vaccine_name}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Date Administered: {new Date(imm.date_administered).toLocaleDateString()}
                          </p>
                        </div>
                        {imm.is_complete && (
                          <Badge className="bg-green-100 text-green-800">Complete</Badge>
                        )}
                      </div>
                      {imm.reaction_or_notes && (
                        <p className="text-sm text-gray-600 mt-2 p-2 bg-yellow-50 rounded">
                          <span className="font-medium">Notes:</span> {imm.reaction_or_notes}
                        </p>
                      )}
                      {imm.next_dose_due && (
                        <p className="text-sm text-blue-600 mt-2">
                          Next dose due: {new Date(imm.next_dose_due).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}