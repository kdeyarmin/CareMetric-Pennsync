import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from "@/hooks/useScopedPatients";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Filter,
  Zap,
} from "lucide-react";

import PatientAlertsDashboard from "../components/alerts/PatientAlertsDashboard";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { ALL_ROWS } from '@/lib/queryLimits';

export default function PatientAlerts() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId") || searchParams.get("id") || "";
  const [selectedPatientId, setSelectedPatientId] = useState(urlPatientId);

  // Follow same-route deep-link changes (?patientId=A -> ?patientId=B): the
  // mount-time snapshot froze the page on the first patient. Manual dropdown
  // selection still works because this only fires when the URL param changes.
  useEffect(() => {
    if (urlPatientId) {
      setSelectedPatientId(urlPatientId);
    }
  }, [urlPatientId]);

  // ACTIVE-only patient set. `status` is part of the hook's cache key, so this
  // can no longer be served the full unfiltered roster (or vice versa) depending
  // on mount order, and a ['patients']-prefix invalidate still refreshes it.
  const { data: patients = [] } = useScopedPatients({
    purpose: 'roster',
    status: 'active',
    sort: null,
    limit: ALL_ROWS,
  });

  const { data: _currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  return (
    <PageContainer>
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Patient Care"
        title="Patient Alerts"
        description="Review, assign, and resolve recorded patient alerts by severity and type"
        favoritePage="PatientAlerts"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Main Alerts Dashboard */}
        <div className="lg:col-span-2">
          <PatientAlertsDashboard patientId={selectedPatientId || null} />
        </div>

        {/* Sidebar - Patient filter & response guide */}
        <div className="space-y-4 sm:space-y-6">
          {/* Patient filter for the stored-alert list */}
          <Card>
            <CardHeader className="py-3 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="w-4 h-4 text-navy-600" />
                Filter by Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <Select value={selectedPatientId || "none"} onValueChange={(val) => setSelectedPatientId(val === "none" ? "" : val)}>
                <SelectTrigger className="h-11 touch-target" aria-label="Filter alerts by patient">
                  <SelectValue placeholder="All patients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="py-3">All patients</SelectItem>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="py-3">
                      {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Quick Tips */}
          <Card>
            <CardHeader className="py-3 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-600" />
                Alert Response Guide
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <ul className="text-xs sm:text-sm text-slate-700 space-y-2">
                <li className="flex items-start gap-2">
                  <Badge variant="destructive" className="text-xs shrink-0 min-w-[60px] justify-center">Critical</Badge>
                  <span className="flex-1">Immediate action within 1 hour</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="warning" className="text-xs shrink-0 min-w-[60px] justify-center">High</Badge>
                  <span className="flex-1">Address within 24 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="warning" className="text-xs shrink-0 min-w-[60px] justify-center">Medium</Badge>
                  <span className="flex-1">Address within 48-72 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="info" className="text-xs shrink-0 min-w-[60px] justify-center">Low</Badge>
                  <span className="flex-1">Monitor at next visit</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
