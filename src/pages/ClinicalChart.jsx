import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Users, Activity } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/input";
import VitalsChart from "@/components/clinical/VitalsChart";
import CarePlanInteractive from "@/components/clinical/CarePlanInteractive";
import OASISQuickUpdate from "@/components/clinical/OASISQuickUpdate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ClinicalChart() {
  const [search, setSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["chart-patients", currentUser?.email],
    queryFn: () =>
      currentUser?.role === "admin"
        ? base44.entities.Patient.filter({ status: "active" }, "-updated_date", 100)
        : base44.entities.Patient.filter({ assigned_nurses: currentUser?.email, status: "active" }, "-updated_date", 100),
    enabled: !!currentUser,
    initialData: [],
  });

  const filtered = patients.filter((p) => {
    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
    return name.includes(search.toLowerCase()) || (p.medical_record_number || "").toLowerCase().includes(search.toLowerCase());
  });

  const selectedPatient = patients.find((p) => p.id === selectedPatientId);

  return (
    <PageContainer>
      <PageHeader
        icon={Activity}
        eyebrow="Patient Care"
        title="Clinical Chart"
        description="Interactive care plans, OASIS updates, and historical vitals at a glance."
        favoritePage="ClinicalChart"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Patient list */}
        <div className="space-y-3">
          <Input
            placeholder="Search patients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11"
          />
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {filtered.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                <Users className="w-8 h-8" />
                No active patients found.
              </div>
            )}
            {filtered.map((patient) => (
              <button
                key={patient.id}
                onClick={() => setSelectedPatientId(patient.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-teal-50 transition-colors ${
                  selectedPatientId === patient.id ? "bg-teal-100 border-l-4 border-l-teal-600" : ""
                }`}
              >
                <p className="font-semibold text-slate-900 text-sm">
                  {patient.first_name} {patient.last_name}
                </p>
                <p className="text-xs text-slate-500">{patient.primary_diagnosis || "No diagnosis recorded"}</p>
                {patient.medical_record_number && (
                  <p className="text-xs text-slate-400">MRN: {patient.medical_record_number}</p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Chart area */}
        {selectedPatient ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">
                {selectedPatient.first_name} {selectedPatient.last_name}
              </h2>
              <p className="text-sm text-slate-500">
                {selectedPatient.primary_diagnosis || "No primary diagnosis"} •{" "}
                {selectedPatient.care_type === "hospice" ? "Hospice" : "Home Health"}
              </p>
            </div>

            <Tabs defaultValue="vitals" className="space-y-4">
              <TabsList>
                <TabsTrigger value="vitals">Vitals History</TabsTrigger>
                <TabsTrigger value="careplan">Care Plan</TabsTrigger>
                <TabsTrigger value="oasis">OASIS Update</TabsTrigger>
              </TabsList>

              <TabsContent value="vitals">
                <VitalsChart patientId={selectedPatient.id} />
              </TabsContent>

              <TabsContent value="careplan">
                <CarePlanInteractive patientId={selectedPatient.id} currentUser={currentUser} />
              </TabsContent>

              <TabsContent value="oasis">
                <OASISQuickUpdate patient={selectedPatient} currentUser={currentUser} />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 p-16 gap-4">
            <Activity className="w-14 h-14" />
            <p className="text-lg font-medium">Select a patient to begin charting</p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}