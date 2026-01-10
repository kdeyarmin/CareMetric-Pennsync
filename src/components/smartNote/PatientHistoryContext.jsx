import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, History, Copy, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export default function PatientHistoryContext({ patientId, onInsertSnippet }) {
  const [expandedVisit, setExpandedVisit] = useState(null);

  const { data: patient, isLoading: patientLoading } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientId ? base44.entities.Patient.filter({ id: patientId }).then(r => r[0]) : null,
    enabled: !!patientId && patientId !== 'anonymous'
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: async () => {
      if (!patientId || patientId === 'anonymous') return [];
      const allVisits = await base44.entities.Visit.filter({ patient_id: patientId });
      return allVisits.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date)).slice(0, 5);
    },
    enabled: !!patientId && patientId !== 'anonymous'
  });

  const insertSnippet = (content, label) => {
    if (onInsertSnippet) {
      onInsertSnippet(`[${label}]: ${content}`);
      toast.success(`Inserted: ${label}`);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (!patientId || patientId === 'anonymous') {
    return (
      <Card className="w-full border-gray-200">
        <CardContent className="pt-6">
          <p className="text-xs text-gray-500 text-center">Select a patient to view history</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-blue-200 bg-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4 text-blue-600" />
          Patient History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="visits" className="text-xs">Recent Visits</TabsTrigger>
            <TabsTrigger value="conditions" className="text-xs">Conditions</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-2 mt-3">
            {patientLoading ? (
              <p className="text-xs text-gray-500">Loading...</p>
            ) : patient ? (
              <div className="space-y-2">
                <div className="bg-white p-2 rounded border text-xs">
                  <p className="font-semibold text-gray-900">
                    {patient.first_name} {patient.last_name}
                  </p>
                  <p className="text-gray-600">
                    DOB: {patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString() : 'N/A'}
                  </p>
                </div>

                {patient.allergies && (
                  <div className="bg-red-50 p-2 rounded border border-red-200">
                    <p className="text-xs font-semibold text-red-900 mb-1">⚠️ Allergies</p>
                    <p className="text-xs text-red-800">{patient.allergies}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertSnippet(patient.allergies, "Patient Allergies")}
                      className="w-full mt-1 text-xs h-6"
                    >
                      <Copy className="w-3 h-3 mr-1" /> Insert
                    </Button>
                  </div>
                )}

                {patient.primary_diagnosis && (
                  <div className="bg-white p-2 rounded border">
                    <p className="text-xs font-semibold text-gray-900 mb-1">Primary Diagnosis</p>
                    <p className="text-xs text-gray-700">{patient.primary_diagnosis}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertSnippet(patient.primary_diagnosis, "Primary Diagnosis")}
                      className="w-full mt-1 text-xs h-6"
                    >
                      <Copy className="w-3 h-3 mr-1" /> Insert
                    </Button>
                  </div>
                )}

                {patient.secondary_diagnoses?.length > 0 && (
                  <div className="bg-white p-2 rounded border">
                    <p className="text-xs font-semibold text-gray-900 mb-1">Secondary Diagnoses</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {patient.secondary_diagnoses.map((dx, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">{dx}</Badge>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertSnippet(patient.secondary_diagnoses.join(', '), "Secondary Diagnoses")}
                      className="w-full text-xs h-6"
                    >
                      <Copy className="w-3 h-3 mr-1" /> Insert
                    </Button>
                  </div>
                )}

                {patient.current_medications?.length > 0 && (
                  <div className="bg-white p-2 rounded border">
                    <p className="text-xs font-semibold text-gray-900 mb-1">Current Medications ({patient.current_medications.length})</p>
                    <div className="space-y-1 max-h-24 overflow-y-auto mb-2">
                      {patient.current_medications.slice(0, 3).map((med, idx) => (
                        <div key={idx} className="text-xs text-gray-700">
                          • {med.name} {med.dosage ? `- ${med.dosage}` : ''} {med.frequency ? `(${med.frequency})` : ''}
                        </div>
                      ))}
                      {patient.current_medications.length > 3 && (
                        <p className="text-xs text-gray-500">+{patient.current_medications.length - 3} more</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const medList = patient.current_medications.map(m => `${m.name} ${m.dosage || ''} (${m.frequency || 'as directed'})`).join(', ');
                        insertSnippet(medList, "Medications");
                      }}
                      className="w-full text-xs h-6"
                    >
                      <Copy className="w-3 h-3 mr-1" /> Insert
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </TabsContent>

          {/* Visits Tab */}
          <TabsContent value="visits" className="space-y-2 mt-3">
            {visits.length === 0 ? (
              <p className="text-xs text-gray-500">No previous visits</p>
            ) : (
              visits.map((visit, idx) => (
                <div key={visit.id} className="border rounded bg-white">
                  <button
                    onClick={() => setExpandedVisit(expandedVisit === visit.id ? null : visit.id)}
                    className="w-full p-2 flex items-center justify-between hover:bg-gray-50 text-xs"
                  >
                    <div className="text-left">
                      <p className="font-semibold text-gray-900">{visit.visit_type}</p>
                      <p className="text-gray-600">{new Date(visit.visit_date).toLocaleDateString()}</p>
                    </div>
                    <ChevronDown className={`w-3 h-3 transition-transform ${expandedVisit === visit.id ? 'rotate-180' : ''}`} />
                  </button>

                  {expandedVisit === visit.id && (
                    <div className="border-t p-2 space-y-2 bg-gray-50">
                      {visit.vital_signs && (
                        <div>
                          <p className="text-xs font-semibold text-gray-900 mb-1">Vital Signs</p>
                          <div className="text-xs text-gray-700 space-y-0.5">
                            {visit.vital_signs.temperature && <p>• Temp: {visit.vital_signs.temperature}°F</p>}
                            {visit.vital_signs.blood_pressure_systolic && <p>• BP: {visit.vital_signs.blood_pressure_systolic}/{visit.vital_signs.blood_pressure_diastolic}</p>}
                            {visit.vital_signs.heart_rate && <p>• HR: {visit.vital_signs.heart_rate} bpm</p>}
                            {visit.vital_signs.oxygen_saturation && <p>• O2: {visit.vital_signs.oxygen_saturation}%</p>}
                          </div>
                        </div>
                      )}

                      {visit.nurse_notes && (
                        <div>
                          <p className="text-xs font-semibold text-gray-900 mb-1">Visit Notes</p>
                          <p className="text-xs text-gray-700 line-clamp-3">{visit.nurse_notes}</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => insertSnippet(`From ${new Date(visit.visit_date).toLocaleDateString()}: ${visit.nurse_notes}`, "Previous Visit Note")}
                            className="w-full text-xs h-6 mt-1"
                          >
                            <Copy className="w-3 h-3 mr-1" /> Insert Note
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </TabsContent>

          {/* Conditions Tab */}
          <TabsContent value="conditions" className="space-y-2 mt-3">
            {patient?.baseline_vitals && (
              <div className="bg-white p-2 rounded border">
                <p className="text-xs font-semibold text-gray-900 mb-1">Baseline Vitals</p>
                <div className="text-xs text-gray-700 space-y-0.5 mb-2">
                  {patient.baseline_vitals.blood_pressure_systolic && (
                    <p>BP: {patient.baseline_vitals.blood_pressure_systolic}/{patient.baseline_vitals.blood_pressure_diastolic}</p>
                  )}
                  {patient.baseline_vitals.heart_rate && <p>HR: {patient.baseline_vitals.heart_rate} bpm</p>}
                  {patient.baseline_vitals.weight && <p>Weight: {patient.baseline_vitals.weight} lbs</p>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const vitals = `BP ${patient.baseline_vitals.blood_pressure_systolic}/${patient.baseline_vitals.blood_pressure_diastolic}, HR ${patient.baseline_vitals.heart_rate}`;
                    insertSnippet(vitals, "Baseline Vitals");
                  }}
                  className="w-full text-xs h-6"
                >
                  <Copy className="w-3 h-3 mr-1" /> Insert
                </Button>
              </div>
            )}

            {patient?.functional_status && (
              <div className="bg-white p-2 rounded border">
                <p className="text-xs font-semibold text-gray-900 mb-1">Functional Status</p>
                <div className="text-xs text-gray-700 space-y-0.5 mb-2">
                  {patient.functional_status.ambulation && <p>Ambulation: {patient.functional_status.ambulation}</p>}
                  {patient.functional_status.adl_independence && <p>ADL: {patient.functional_status.adl_independence}</p>}
                  {patient.functional_status.fall_risk && <p>Fall Risk: {patient.functional_status.fall_risk}</p>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => insertSnippet(`Ambulation: ${patient.functional_status.ambulation}, ADL: ${patient.functional_status.adl_independence}`, "Functional Status")}
                  className="w-full text-xs h-6"
                >
                  <Copy className="w-3 h-3 mr-1" /> Insert
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}