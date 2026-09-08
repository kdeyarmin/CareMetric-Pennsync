import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { base44 } from "@/api/base44Client";
import {
  invalidateAuthorizedPatientLists,
  useScopedPatients,
} from '@/hooks/useScopedPatients';
import {
  invalidateAuthorizedVisitLists,
  useAuthorizedVisits,
} from '@/hooks/useAuthorizedVisits';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Users,
  Clipboard,
  Activity,
  TrendingUp,
  AlertCircle,
  FileText,
  Calendar
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import LoadingState from "@/components/ui/LoadingState";
import { parseLocalDate } from "@/lib/dateLocal";
import PatientSearchBar from "../components/dashboard/PatientSearchBar";
import PatientQuickActions from "../components/dashboard/PatientQuickActions";
import PatientOverviewCard from "../components/dashboard/PatientOverviewCard";
import RecentActivityFeed from "../components/dashboard/RecentActivityFeed";
import { ScrollArea } from "@/components/ui/scroll-area";

const authorizationScopeKey = (scope) => (scope
  ? JSON.stringify([
      scope.user_id,
      scope.agency_id,
      scope.membership_id,
      scope.membership_version,
      scope.tenant_role,
    ])
  : null);

const DEFAULT_PATIENT_FILTERS = Object.freeze({
  status: 'all',
  careType: 'all',
  diagnosis: '',
  dateRange: 'all',
});

function PatientOverviewWithoutVisitMetrics({
  patient,
  alerts,
  isSelected,
  onSelect,
  view,
}) {
  const importantAlertCount = alerts.filter(
    (alert) => alert.severity === 'critical' || alert.severity === 'high',
  ).length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`w-full rounded-xl border bg-white p-4 text-left transition-all hover:shadow-md ${
        isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200'
      } ${view === 'grid' ? 'min-h-[190px]' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {patient.first_name} {patient.last_name}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            MRN: {patient.medical_record_number || 'Not assigned'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
          {patient.status || 'unknown'}
        </span>
      </div>

      {view === 'grid' && (
        <p className="mt-4 text-sm text-slate-700">
          {patient.primary_diagnosis || 'No diagnosis specified'}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-center">
        <div>
          <p className="text-xs text-slate-600">Visits</p>
          <p className="text-sm font-semibold text-amber-700">Unavailable</p>
        </div>
        <div>
          <p className="text-xs text-slate-600">Important alerts</p>
          <p className="text-sm font-semibold text-slate-800">{importantAlertCount}</p>
        </div>
      </div>
    </button>
  );
}

export default function PatientRecordDashboard() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_PATIENT_FILTERS }));
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [view, setView] = useState("grid"); // grid or list
  const queryClient = useQueryClient();
  const lastAuthorizedPatientScopeKey = useRef(null);

  // Refresh the dashboard's data after a quick action without a full page reload.
  const refreshDashboard = () => {
    invalidateAuthorizedPatientLists(queryClient);
    invalidateAuthorizedVisitLists(queryClient);
    queryClient.invalidateQueries({ queryKey: ['active-alerts'] });
  };

  // Fetch all data in parallel. Patient objects never live in local state: any
  // selected detail is resolved from the latest successfully authorized rows.
  const patientQuery = useScopedPatients({
    purpose: 'patient_management',
    sort: '-updated_date',
    limit: 1000,
  });
  const patientsReady = patientQuery.isSuccess;
  const patients = useMemo(
    () => (patientsReady ? (patientQuery.data || []) : []),
    [patientQuery.data, patientsReady],
  );
  const patientTenantScope = patientQuery.tenantScope;
  const patientScopeKey = authorizationScopeKey(patientTenantScope);
  const patientScopeChanged = Boolean(
    patientsReady
    && lastAuthorizedPatientScopeKey.current
    && lastAuthorizedPatientScopeKey.current !== patientScopeKey,
  );
  const patientStateCurrent = patientsReady && !patientScopeChanged;
  const patientById = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );
  const selectedPatient = patientStateCurrent && selectedPatientId
    ? patientById.get(selectedPatientId) || null
    : null;

  useEffect(() => {
    const scopeChanged = Boolean(
      patientsReady
      && lastAuthorizedPatientScopeKey.current
      && lastAuthorizedPatientScopeKey.current !== patientScopeKey,
    );
    if (patientsReady) {
      lastAuthorizedPatientScopeKey.current = patientScopeKey;
    }
    if (!patientsReady || scopeChanged) {
      setSelectedPatientId(null);
    }
    if (scopeChanged) {
      setSearchQuery('');
      setFilters({ ...DEFAULT_PATIENT_FILTERS });
    }
  }, [patientScopeKey, patientsReady]);

  useEffect(() => {
    if (patientsReady && selectedPatientId && !patientById.has(selectedPatientId)) {
      setSelectedPatientId(null);
    }
  }, [patientById, patientsReady, selectedPatientId]);

  const visitQuery = useAuthorizedVisits({
    purpose: 'activity',
    sort: '-created_date',
    limit: 500,
  });
  const visitScopeKey = authorizationScopeKey(visitQuery.tenantScope);
  const visitMetricsAvailable = patientsReady
    && visitQuery.isSuccess
    && visitScopeKey === patientScopeKey;
  const visits = useMemo(
    () => (visitMetricsAvailable ? (visitQuery.data || []) : []),
    [visitMetricsAvailable, visitQuery.data],
  );
  const visitMetricsMessage = visitQuery.isError
    ? 'Agency-wide Visit metrics are unavailable for your role or current tenant scope. Patient records remain available.'
    : visitQuery.isPending
      ? 'Agency-wide Visit metrics are being reverified. Visit counts and activity are temporarily unavailable.'
      : !visitMetricsAvailable
        ? 'Agency-wide Visit metrics are unavailable until Patient and Visit tenant scopes are reverified together.'
        : null;

  // Server-scoped alerts — avoid entity list(N) + agency post-filter truncation.
  const { data: alerts = [] } = useQuery({
    queryKey: ['active-alerts', 'patient-record-dashboard', patientScopeKey],
    queryFn: async () => {
      const res = await base44.functions.invoke('getScopedPatientAlerts', {
        limit: 500,
        status: 'active',
      });
      return res?.data?.alerts || [];
    },
    enabled: patientsReady && !!patientScopeKey,
    initialData: [],
  });

  const visitsByPatientId = useMemo(() => {
    const grouped = new Map();
    if (!visitMetricsAvailable) return grouped;
    visits.forEach((visit) => {
      const patientVisits = grouped.get(visit.patient_id) || [];
      patientVisits.push(visit);
      grouped.set(visit.patient_id, patientVisits);
    });
    return grouped;
  }, [visitMetricsAvailable, visits]);

  const alertsByPatientId = useMemo(() => {
    const grouped = new Map();
    alerts.forEach((alert) => {
      const patientAlerts = grouped.get(alert.patient_id) || [];
      patientAlerts.push(alert);
      grouped.set(alert.patient_id, patientAlerts);
    });
    return grouped;
  }, [alerts]);

  // Filter patients based on search and filters
  const filteredPatients = useMemo(() => {
    let result = patients;
    const effectiveSearchQuery = patientScopeChanged ? '' : searchQuery;
    const effectiveFilters = patientScopeChanged ? DEFAULT_PATIENT_FILTERS : filters;

    // Text search
    if (effectiveSearchQuery.trim()) {
      const query = effectiveSearchQuery.toLowerCase();
      result = result.filter(p =>
        p.first_name?.toLowerCase().includes(query) ||
        p.last_name?.toLowerCase().includes(query) ||
        p.medical_record_number?.toLowerCase().includes(query) ||
        p.phone?.includes(query) ||
        p.primary_diagnosis?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (effectiveFilters.status !== "all") {
      result = result.filter(p => p.status === effectiveFilters.status);
    }

    // Care type filter
    if (effectiveFilters.careType !== "all") {
      result = result.filter(p => p.care_type === effectiveFilters.careType);
    }

    // Diagnosis filter
    if (effectiveFilters.diagnosis) {
      const diagQuery = effectiveFilters.diagnosis.toLowerCase();
      result = result.filter(p =>
        p.primary_diagnosis?.toLowerCase().includes(diagQuery)
      );
    }

    // Date range filter
    if (effectiveFilters.dateRange !== "all") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      result = result.filter(p => {
        if (!p.admission_date) return false;
        const admissionDate = parseLocalDate(p.admission_date);
        if (!admissionDate) return false;
        const daysDiff = (startOfToday - admissionDate) / (1000 * 60 * 60 * 24);

        switch (effectiveFilters.dateRange) {
          case "week":
            return daysDiff <= 7;
          case "month":
            return daysDiff <= 30;
          case "3months":
            return daysDiff <= 90;
          case "6months":
            return daysDiff <= 180;
          default:
            return true;
        }
      });
    }

    return result;
  }, [filters, patientScopeChanged, patients, searchQuery]);

  // Calculate statistics
  const stats = useMemo(() => {
    const activePatients = patients.filter(p => p.status === 'active').length;
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const recentVisits = visitMetricsAvailable
      ? visits.filter(v => {
          if (!v.visit_date) return false;
          const visitDate = parseLocalDate(v.visit_date);
          if (!visitDate) return false;
          const daysDiff = (startOfToday - visitDate) / (1000 * 60 * 60 * 24);
          // Lower bound too, so future-dated visits don't count as "recent".
          return daysDiff >= 0 && daysDiff <= 7;
        }).length
      : null;

    return {
      totalPatients: patients.length,
      activePatients,
      criticalAlerts,
      recentVisits
    };
  }, [patients, alerts, visitMetricsAvailable, visits]);

  if (patientQuery.isError) {
    return (
      <PageContainer>
        <EmptyState
          icon={Users}
          title="Patient records unavailable"
          description="Your patient access could not be reverified for the current tenant scope. No cached patient details are shown."
          className="my-16"
        />
      </PageContainer>
    );
  }

  if (!patientsReady) {
    return (
      <PageContainer>
        <LoadingState label="Reverifying patient record access..." className="py-24" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Clipboard}
        eyebrow="Patient Care"
        title="Patient Record Dashboard"
        description="Comprehensive patient management and overview"
        favoritePage="PatientRecordDashboard"
        actions={
          <PatientQuickActions
            key={patientScopeKey}
            onActionComplete={refreshDashboard}
          />
        }
      />

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Total Patients" value={stats.totalPatients} icon={Users} tone="navy" />
          <StatCard label="Active Patients" value={stats.activePatients} icon={Activity} tone="emerald" />
          <StatCard label="Critical Alerts" value={stats.criticalAlerts} icon={AlertCircle} tone="rose" />
          <StatCard
            label="Visits (7 days)"
            value={visitMetricsAvailable ? stats.recentVisits : '—'}
            description={visitMetricsAvailable
              ? undefined
              : visitQuery.isError ? 'Unavailable for this scope' : 'Reverifying access'}
            icon={Calendar}
            tone="sky"
          />
        </div>

        {visitMetricsMessage && (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {visitMetricsMessage}
          </div>
        )}

        {/* Search and Filters */}
        <Card>
          <CardContent className="p-6">
            <PatientSearchBar
              searchQuery={patientScopeChanged ? '' : searchQuery}
              onSearchChange={setSearchQuery}
              filters={patientScopeChanged ? DEFAULT_PATIENT_FILTERS : filters}
              onFiltersChange={setFilters}
              resultCount={filteredPatients.length}
            />
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Patient List/Grid */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Patient Records ({filteredPatients.length})
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant={view === "grid" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setView("grid")}
                    >
                      Grid
                    </Button>
                    <Button
                      variant={view === "list" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setView("list")}
                    >
                      List
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px] pr-4">
                  {filteredPatients.length === 0 ? (
                    <EmptyState icon={Users} title="No patients found" description="No patients match your current criteria." />
                  ) : (
                    <div className={view === "grid" ? "grid grid-cols-1 gap-4" : "space-y-2"}>
                      {filteredPatients.map((patient) => {
                        const patientAlerts = alertsByPatientId.get(patient.id) || [];
                        const overviewProps = {
                          patient,
                          alerts: patientAlerts,
                          isSelected: patientStateCurrent && selectedPatientId === patient.id,
                          onSelect: () => setSelectedPatientId(patient.id),
                          view,
                        };
                        return visitMetricsAvailable ? (
                          <PatientOverviewCard
                            key={patient.id}
                            {...overviewProps}
                            visits={visitsByPatientId.get(patient.id) || []}
                          />
                        ) : (
                          <PatientOverviewWithoutVisitMetrics
                            key={patient.id}
                            {...overviewProps}
                          />
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity & Selected Patient Details */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!visitMetricsAvailable && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Visit activity is unavailable for this scope; no zero-activity conclusion is being inferred.
                  </p>
                )}
                {(visitMetricsAvailable || alerts.length > 0) && (
                  <div className={!visitMetricsAvailable ? 'mt-3' : undefined}>
                    <RecentActivityFeed
                      visits={visitMetricsAvailable ? visits.slice(0, 10) : []}
                      alerts={alerts.slice(0, 5)}
                      patients={patients}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedPatient && (
              <Card className="border-blue-300 bg-blue-50">
                <CardHeader>
                  <CardTitle className="text-lg">Selected Patient</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold text-lg text-slate-900">
                        {selectedPatient.first_name} {selectedPatient.last_name}
                      </p>
                      <p className="text-sm text-slate-600">MRN: {selectedPatient.medical_record_number || 'N/A'}</p>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Status:</span>
                        <span className="font-medium capitalize">{selectedPatient.status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Care Type:</span>
                        <span className="font-medium">{selectedPatient.care_type?.replace('_', ' ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Diagnosis:</span>
                        <span className="font-medium text-right">{selectedPatient.primary_diagnosis || 'N/A'}</span>
                      </div>
                    </div>
                    <Button
                      className="w-full mt-4"
                      onClick={() => navigate(`/PatientDetails?id=${selectedPatient.id}`)}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Full Record
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
    </PageContainer>
  );
}
