import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Search, User, Phone, MapPin, Calendar, Activity,
  AlertTriangle, Heart, Pill, Shield, FileText, ChevronRight, Lock
} from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  active: "bg-green-100 text-green-700 border-green-200",
  discharged: "bg-slate-100 text-slate-600 border-slate-200",
  hospitalized: "bg-red-100 text-red-700 border-red-200",
};

const riskColors = {
  low: "bg-green-100 text-green-700",
  moderate: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

export default function VaultPatientList() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["vault-patients"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 100),
  });

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return (
      !q ||
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.medical_record_number?.toLowerCase().includes(q) ||
      p.primary_diagnosis?.toLowerCase().includes(q) ||
      p.phone?.includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">Protected Patient Records</h2>
          <Badge className="bg-blue-100 text-blue-700 text-[10px]">
            <Lock className="w-3 h-3 mr-1" />
            {filtered.length} records
          </Badge>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search by name, MRN, diagnosis, phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 h-11"
        />
      </div>

      {/* Patient list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <User className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">No patients found</p>
          <p className="text-sm">Try adjusting your search</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(patient => (
            <PatientVaultCard
              key={patient.id}
              patient={patient}
              expanded={expandedId === patient.id}
              onToggle={() => setExpandedId(expandedId === patient.id ? null : patient.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PatientVaultCard({ patient, expanded, onToggle }) {
  const age = patient.date_of_birth
    ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <button onClick={onToggle} className="w-full text-left">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900 truncate">
                    {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ""}{patient.last_name}
                  </p>
                  {patient.status && (
                    <Badge className={`text-[10px] ${statusColors[patient.status] || "bg-slate-100"}`}>
                      {patient.status}
                    </Badge>
                  )}
                  {patient.risk_assessment?.level && (
                    <Badge className={`text-[10px] ${riskColors[patient.risk_assessment.level]}`}>
                      Risk: {patient.risk_assessment.level}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                  {patient.medical_record_number && <span>MRN: {patient.medical_record_number}</span>}
                  {age !== null && <span>Age: {age}</span>}
                  {patient.primary_diagnosis && (
                    <span className="truncate max-w-[200px]">{patient.primary_diagnosis}</span>
                  )}
                </div>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`} />
          </div>
        </CardContent>
      </button>

      {expanded && (
        <div className="border-t bg-slate-50/50 p-4 space-y-3 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Contact */}
            <InfoSection icon={Phone} label="Contact">
              <p>{patient.phone || "No phone"}</p>
              <p className="text-slate-400">{patient.email || "No email"}</p>
              <p className="text-slate-400">{patient.address || "No address"}</p>
            </InfoSection>

            {/* Demographics */}
            <InfoSection icon={Calendar} label="Demographics">
              <p>DOB: {patient.date_of_birth ? format(new Date(patient.date_of_birth), "MM/dd/yyyy") : "N/A"}</p>
              <p>Payor: {patient.payor || "N/A"}</p>
              <p>Care Type: {patient.care_type || "N/A"}</p>
            </InfoSection>

            {/* Medical */}
            <InfoSection icon={Activity} label="Medical">
              <p>Dx: {patient.primary_diagnosis || "N/A"}</p>
              {patient.allergies && <p className="text-red-600">Allergies: {patient.allergies}</p>}
              {patient.secondary_diagnoses?.length > 0 && (
                <p>Secondary: {patient.secondary_diagnoses.slice(0, 3).join(", ")}</p>
              )}
            </InfoSection>

            {/* Medications */}
            <InfoSection icon={Pill} label="Medications">
              {patient.current_medications?.length > 0 ? (
                patient.current_medications.slice(0, 4).map((med, i) => (
                  <p key={i}>{med.name} {med.dosage} {med.frequency}</p>
                ))
              ) : (
                <p className="text-slate-400">No medications listed</p>
              )}
            </InfoSection>

            {/* Emergency Contact */}
            <InfoSection icon={AlertTriangle} label="Emergency Contact">
              <p>{patient.emergency_contact_name || "N/A"}</p>
              <p>{patient.emergency_contact_phone || ""}</p>
              <p className="text-slate-400">{patient.emergency_contact_relationship || ""}</p>
            </InfoSection>

            {/* Physician */}
            <InfoSection icon={Heart} label="Physician">
              <p>{patient.physician_name || "N/A"}</p>
              <p>{patient.physician_phone || ""}</p>
            </InfoSection>
          </div>

          <div className="flex justify-end pt-2">
            <Link to={createPageUrl("PatientDetails") + `?id=${patient.id}`}>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 gap-1">
                <FileText className="w-3.5 h-3.5" />
                Full Chart
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

function InfoSection({ icon: Icon, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-blue-500" />
        <span className="text-xs font-semibold text-slate-600">{label}</span>
      </div>
      <div className="text-xs text-slate-700 space-y-0.5 pl-5">{children}</div>
    </div>
  );
}