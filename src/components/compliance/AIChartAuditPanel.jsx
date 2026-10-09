import { useMemo, useState } from "react";
import { useScopedPatients } from "@/hooks/useScopedPatients";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield } from "lucide-react";
import AIComplianceAuditor from "@/components/compliance/AIComplianceAuditor";

const ROSTER_LIMIT = 500;

const patientLabel = (patient) => {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Unnamed patient";
  return patient.medical_record_number ? `${name} (MRN ${patient.medical_record_number})` : name;
};

/**
 * Compliance Center host for the AI chart audit. The roster is the reviewed
 * `roster` projection; the audit itself loads the selected chart through its
 * own purpose-limited reads, so choosing a patient here discloses nothing the
 * roster did not already show.
 */
export default function AIChartAuditPanel() {
  const [patientId, setPatientId] = useState("");
  const rosterQuery = useScopedPatients({
    purpose: "roster",
    status: "active",
    sort: "-updated_date",
    limit: ROSTER_LIMIT,
  });
  const patients = useMemo(
    () => (rosterQuery.isSuccess && Array.isArray(rosterQuery.data) ? rosterQuery.data : []),
    [rosterQuery.data, rosterQuery.isSuccess],
  );
  const selectedPatientId = patients.some((patient) => patient.id === patientId) ? patientId : "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-navy-600" />
            AI Chart Compliance Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="chart-audit-patient">Patient</Label>
          <Select value={selectedPatientId} onValueChange={setPatientId} disabled={!rosterQuery.isSuccess}>
            <SelectTrigger id="chart-audit-patient" className="w-full sm:w-96">
              <SelectValue
                placeholder={rosterQuery.isError
                  ? "Patient roster unavailable"
                  : rosterQuery.isSuccess
                    ? "Select an active patient"
                    : "Loading patients…"}
              />
            </SelectTrigger>
            <SelectContent>
              {patients.map((patient) => (
                <SelectItem key={patient.id} value={patient.id}>
                  {patientLabel(patient)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            The audit is advisory: a reviewer should confirm each finding against the chart before acting on it.
          </p>
        </CardContent>
      </Card>
      {selectedPatientId && <AIComplianceAuditor key={selectedPatientId} patientId={selectedPatientId} />}
    </div>
  );
}
