import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen, CheckCircle2, Clock, Loader2, Send, Eye, EyeOff
} from "lucide-react";
import { toast } from "sonner";

export default function PatientEducationPortal() {
  const queryClient = useQueryClient();
  const [searchPatient, setSearchPatient] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [expandedMaterialId, setExpandedMaterialId] = useState(null);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.filter({ status: "active" }, "first_name", 100),
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["patient-education", selectedPatientId],
    queryFn: () =>
      selectedPatientId
        ? base44.entities.PatientEducationDelivery.filter(
            { patient_id: selectedPatientId },
            "-generated_date"
          )
        : Promise.resolve([]),
    enabled: !!selectedPatientId,
  });

  const { data: _visits = [] } = useQuery({
    queryKey: ["patient-visits", selectedPatientId],
    queryFn: () =>
      selectedPatientId
        ? base44.entities.Visit.filter(
            { patient_id: selectedPatientId, status: "completed" },
            "-visit_date",
            10
          )
        : Promise.resolve([]),
    enabled: !!selectedPatientId,
  });

  const { data: _carePlans = [] } = useQuery({
    queryKey: ["patient-care-plans", selectedPatientId],
    queryFn: () =>
      selectedPatientId
        ? base44.entities.CarePlan.filter(
            { patient_id: selectedPatientId, status: "active" },
            "-created_date"
          )
        : Promise.resolve([]),
    enabled: !!selectedPatientId,
  });

  const generateEducationMutation = useMutation({
    mutationFn: (patientId) =>
      invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `Generate personalized education for patient ${patientId}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-education", selectedPatientId] });
      toast.success("Education materials generated");
    },
    onError: () => {
      toast.error("Failed to generate education materials");
    },
  });

  const updateDeliveryMutation = useMutation({
    mutationFn: ({ id, data }) =>
      base44.entities.PatientEducationDelivery.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-education", selectedPatientId] });
      toast.success("Delivery status updated");
    },
  });

  const filteredPatients = patients.filter(
    (p) =>
      `${p.first_name} ${p.last_name}`
        .toLowerCase()
        .includes(searchPatient.toLowerCase()) || p.medical_record_number?.includes(searchPatient)
  );

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const pendingMaterials = materials.filter(m => m.delivery_status === "pending");
  const deliveredMaterials = materials.filter(m => m.delivery_status === "delivered");

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient Selection */}
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-navy-600" />
              Select Patient
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Name or MRN"
              value={searchPatient}
              onChange={(e) => setSearchPatient(e.target.value)}
            />
            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredPatients.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No patients found</p>
              ) : (
                filteredPatients.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      selectedPatientId === p.id
                        ? "border-navy-600 bg-navy-50"
                        : "border-slate-200 hover:border-navy-300 bg-white"
                    }`}
                  >
                    <p className="font-semibold text-sm text-slate-900">
                      {p.first_name} {p.last_name}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {p.medical_record_number && `MRN: ${p.medical_record_number}`}
                    </p>
                    {p.primary_diagnosis && (
                      <p className="text-xs text-slate-500 mt-1">{p.primary_diagnosis}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {selectedPatient && (
          <>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-slate-600">Patient</p>
                <p className="text-lg font-bold text-slate-900 mt-1">
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </p>
                <p className="text-xs text-slate-500 mt-2">{selectedPatient.primary_diagnosis}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-slate-600">Education Status</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-bold text-orange-600">{pendingMaterials.length}</span>
                    <span className="text-xs text-slate-600">Pending</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-bold text-green-600">{deliveredMaterials.length}</span>
                    <span className="text-xs text-slate-600">Delivered</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {selectedPatient && (
        <>
          {/* Generate Education Button */}
          <div className="flex gap-3">
            <Button
              onClick={() => generateEducationMutation.mutate(selectedPatientId)}
              disabled={generateEducationMutation.isPending}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {generateEducationMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Generate Education Materials
                </>
              )}
            </Button>
          </div>

          {/* Education Materials */}
          <Tabs defaultValue="pending" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pending">Pending ({pendingMaterials.length})</TabsTrigger>
              <TabsTrigger value="delivered">Delivered ({deliveredMaterials.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3">
              {pendingMaterials.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No pending education materials</p>
                  </CardContent>
                </Card>
              ) : (
                pendingMaterials.map((material) => (
                  <EducationMaterialCard
                    key={material.id}
                    material={material}
                    onUpdate={(id, data) => updateDeliveryMutation.mutate({ id, data })}
                    isExpanded={expandedMaterialId === material.id}
                    onToggleExpand={() =>
                      setExpandedMaterialId(
                        expandedMaterialId === material.id ? null : material.id
                      )
                    }
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="delivered" className="space-y-3">
              {deliveredMaterials.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No delivered education materials yet</p>
                  </CardContent>
                </Card>
              ) : (
                deliveredMaterials.map((material) => (
                  <EducationMaterialCard
                    key={material.id}
                    material={material}
                    delivered
                    isExpanded={expandedMaterialId === material.id}
                    onToggleExpand={() =>
                      setExpandedMaterialId(
                        expandedMaterialId === material.id ? null : material.id
                      )
                    }
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function EducationMaterialCard({
  material,
  onUpdate,
  delivered,
  isExpanded,
  onToggleExpand,
}) {
  const [deliveryMethod, setDeliveryMethod] = useState("in_person");
  const [teachBackNotes, setTeachBackNotes] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleMarkDelivered = async () => {
    setUpdatingStatus(true);
    try {
      await onUpdate(material.id, {
        delivery_status: "delivered",
        delivery_method: deliveryMethod,
        delivered_by: "current_user",
        delivery_date: new Date().toISOString(),
        teach_back_notes: teachBackNotes,
        teach_back_confirmation: true,
        patient_understood: true,
      });
      setDeliveryMethod("in_person");
      setTeachBackNotes("");
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <Card className={delivered ? "border-green-300 bg-green-50" : "border-orange-300 bg-orange-50"}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-slate-900">{material.topic}</h4>
              {delivered ? (
                <Badge className="bg-green-600">Delivered</Badge>
              ) : (
                <Badge className="bg-orange-600">Pending</Badge>
              )}
            </div>
            <p className="text-sm text-slate-600">{material.diagnosis_related}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </Button>
        </div>

        {isExpanded && (
          <div className="space-y-3 pt-3 border-t border-current/20">
            {/* Content Preview */}
            <div className="bg-white p-3 rounded-lg">
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {material.education_content}
              </p>
            </div>

            {/* Delivery Verification */}
            {!delivered && (
              <div className="bg-white p-3 rounded-lg space-y-3">
                <h5 className="font-semibold text-sm text-slate-900">Mark as Delivered</h5>

                <div>
                  <label htmlFor={`delivery-method-${material.id}`} className="text-xs font-medium text-slate-600 block mb-2">
                    Delivery Method
                  </label>
                  <select
                    id={`delivery-method-${material.id}`}
                    value={deliveryMethod}
                    onChange={(e) => setDeliveryMethod(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="in_person">In Person</option>
                    <option value="phone">Phone Call</option>
                    <option value="email">Email</option>
                    <option value="video_call">Video Call</option>
                    <option value="written_material">Written Material</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={`teach-back-notes-${material.id}`} className="text-xs font-medium text-slate-600 block mb-2">
                    Teach-Back Notes (Patient Understanding)
                  </label>
                  <Textarea
                    id={`teach-back-notes-${material.id}`}
                    value={teachBackNotes}
                    onChange={(e) => setTeachBackNotes(e.target.value)}
                    placeholder="Document patient's understanding via teach-back method..."
                    className="min-h-20 text-sm"
                  />
                </div>

                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                  <Checkbox id={`teach-back-${material.id}`} defaultChecked />
                  <label
                    htmlFor={`teach-back-${material.id}`}
                    className="text-xs text-slate-700"
                  >
                    Patient demonstrated understanding via teach-back
                  </label>
                </div>

                <Button
                  onClick={handleMarkDelivered}
                  disabled={updatingStatus || !teachBackNotes.trim()}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  {updatingStatus ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Confirm Delivery
                    </>
                  )}
                </Button>
              </div>
            )}

            {delivered && material.delivery_date && (
              <div className="bg-green-100 border border-green-300 rounded-lg p-3">
                <p className="text-xs text-green-800">
                  <strong>Delivered:</strong> {new Date(material.delivery_date).toLocaleDateString()} via {material.delivery_method?.replace('_', ' ')}
                </p>
                {material.teach_back_notes && (
                  <p className="text-xs text-green-700 mt-2">
                    <strong>Teach-Back Notes:</strong> {material.teach_back_notes}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}