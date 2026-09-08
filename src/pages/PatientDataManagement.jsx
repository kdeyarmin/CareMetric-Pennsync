import { useEffect, useMemo, useState } from "react";
import DuplicateScanner from "../components/patient/DuplicateScanner";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients, excludeArchived } from "@/hooks/useScopedPatients";
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { getTrustedTenantContext, isAdminView } from "@/lib/roles";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Search,
  AlertTriangle,
  Activity,
  MoreVertical,
  Flag,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  FileText,
  Bell,
  CheckCircle2,
  Clock,
  Upload,
  Database
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import PageContainer from "@/components/ui/PageContainer";
import LoadingState from "@/components/ui/LoadingState";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { formatEastern } from "../components/utils/timezone";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

const EMPTY_ROWS = Object.freeze([]);
const FRESH_QUERY_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error
    && !query.isFetching
    && !query.isPaused;
}

function tenantScopeKey(scope) {
  if (!scope) return null;
  return JSON.stringify([
    scope.user_id,
    scope.agency_id,
    scope.membership_id,
    scope.membership_version,
    scope.tenant_role,
  ]);
}

export default function PatientDataManagement() {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [diagnosisFilter, setDiagnosisFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [filterAuthorityKey, setFilterAuthorityKey] = useState(null);

  // Admin-only page: gate the agency-wide data pulls on role (defense in depth;
  // server-side row authorization is the primary control).
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...FRESH_QUERY_OPTIONS,
  });
  const currentUserAvailable = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUser = currentUserAvailable ? currentUserQuery.data : null;
  const isAdmin = isAdminView(currentUser);

  const patientQuery = useScopedPatients({
    purpose: 'patient_management',
    sort: '-created_date',
    limit: 2000,
    select: excludeArchived,
    enabled: isAdmin,
  });
  const patients = patientQuery.isSuccess ? patientQuery.data : EMPTY_ROWS;

  const visitQuery = useAuthorizedVisits({
    purpose: 'activity',
    sort: '-visit_date',
    limit: 5000,
    enabled: isAdmin && activeTab === 'overview',
  });
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const visitsAvailable = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !tenantScopesMismatch;
  const allVisits = visitsAvailable ? visitQuery.data : EMPTY_ROWS;

  const patientAuthorityKey = patientQuery.isSuccess
    ? tenantScopeKey(patientQuery.tenantScope)
    : null;
  const currentTenantScope = currentUserAvailable
    ? getTrustedTenantContext(currentUser)
    : null;
  const alertAuthorityMatches = patientQuery.isSuccess
    && sameAuthorizedTenantScope(patientQuery.tenantScope, currentTenantScope);

  const alertQuery = useAgencyScopedQuery({
    queryKey: ['allAlerts', patientAuthorityKey],
    fetch: () => base44.entities.PatientAlert.list('-created_date', 5000),
    enabled: isAdmin && activeTab === 'overview' && alertAuthorityMatches,
    ...FRESH_QUERY_OPTIONS,
  });
  const alertsAvailable = alertAuthorityMatches
    && settledSuccessfullyAfterMount(alertQuery);
  const allAlerts = alertsAvailable ? alertQuery.data : EMPTY_ROWS;

  const filtersCurrent = Boolean(
    patientAuthorityKey && filterAuthorityKey === patientAuthorityKey
  );
  const effectiveSearchTerm = filtersCurrent ? searchTerm : '';
  const effectiveStatusFilter = filtersCurrent ? statusFilter : 'all';
  const effectiveDiagnosisFilter = filtersCurrent ? diagnosisFilter : 'all';
  const effectiveAlertFilter = filtersCurrent && alertsAvailable ? alertFilter : 'all';
  const effectiveSortBy = filtersCurrent ? sortBy : 'name';
  const effectiveSortOrder = filtersCurrent ? sortOrder : 'asc';

  // Bind every tenant-derived control to the immutable Patient authority. The
  // effective values above are already blank on the first render of a new
  // authority; this effect then retires the old state for subsequent renders.
  useEffect(() => {
    if (filterAuthorityKey === patientAuthorityKey) return;
    setFilterAuthorityKey(patientAuthorityKey);
    setSearchTerm('');
    setStatusFilter('all');
    setDiagnosisFilter('all');
    setAlertFilter('all');
    setSortBy('name');
    setSortOrder('asc');
    setSelectedPatientId(null);
    setFlagDialogOpen(false);
  }, [filterAuthorityKey, patientAuthorityKey]);

  // Get unique diagnoses for filter
  const uniqueDiagnoses = useMemo(() => {
    const diagnoses = new Set();
    patients.forEach(p => {
      if (p.primary_diagnosis) diagnoses.add(p.primary_diagnosis);
    });
    return Array.from(diagnoses).sort();
  }, [patients]);

  const visitsByPatient = useMemo(() => {
    if (!visitsAvailable) return null;
    const grouped = new Map();
    for (const visit of allVisits) {
      const summary = grouped.get(visit.patient_id) || { count: 0, recentVisit: null };
      summary.count += 1;
      if (
        !summary.recentVisit
        || String(visit.visit_date || '') > String(summary.recentVisit.visit_date || '')
      ) summary.recentVisit = visit;
      grouped.set(visit.patient_id, summary);
    }
    return grouped;
  }, [allVisits, visitsAvailable]);

  const alertsByPatient = useMemo(() => {
    if (!alertsAvailable) return null;
    const grouped = new Map();
    for (const alert of allAlerts) {
      if (alert.status !== 'active') continue;
      const summary = grouped.get(alert.patient_id) || { count: 0, critical: 0 };
      summary.count += 1;
      if (alert.severity === 'critical') summary.critical += 1;
      grouped.set(alert.patient_id, summary);
    }
    return grouped;
  }, [alertsAvailable, allAlerts]);

  // Enhanced patient data with activity and alerts
  const enhancedPatients = useMemo(() => {
    return patients.map(patient => {
      const visitSummary = visitsByPatient?.get(patient.id);
      const alertSummary = alertsByPatient?.get(patient.id);
      const recentVisit = visitSummary?.recentVisit || null;
      const activeAlertsCount = alertsAvailable ? alertSummary?.count || 0 : null;
      const criticalAlerts = alertsAvailable ? alertSummary?.critical || 0 : null;
      
      return {
        ...patient,
        recentVisit,
        totalVisits: visitsAvailable ? visitSummary?.count || 0 : null,
        activeAlertsCount,
        criticalAlerts,
        lastActivity: visitsAvailable ? recentVisit?.visit_date || patient.created_date : null,
        riskLevel: alertsAvailable
          ? criticalAlerts > 0 ? 'high' : activeAlertsCount > 2 ? 'medium' : 'low'
          : null,
      };
    });
  }, [alertsAvailable, alertsByPatient, patients, visitsAvailable, visitsByPatient]);

  const selectedPatient = useMemo(() => (
    patientQuery.isSuccess && filtersCurrent
      ? patients.find(patient => patient.id === selectedPatientId) || null
      : null
  ), [filtersCurrent, patientQuery.isSuccess, patients, selectedPatientId]);

  // Store only an identifier, never a detached Patient object. Revocation or a
  // roster refresh immediately closes the dialog and removes the old chart.
  useEffect(() => {
    if (!selectedPatientId) return;
    if (patientQuery.isSuccess && selectedPatient) return;
    setSelectedPatientId(null);
    setFlagDialogOpen(false);
  }, [patientQuery.isSuccess, selectedPatient, selectedPatientId]);

  useEffect(() => {
    if (
      (visitsAvailable || (sortBy !== 'visits' && sortBy !== 'lastActivity'))
      && (alertsAvailable || sortBy !== 'alerts')
    ) return;
    setSortBy('name');
    setSortOrder('asc');
  }, [alertsAvailable, sortBy, visitsAvailable]);

  // Filter and sort
  const filteredAndSortedPatients = useMemo(() => {
    let filtered = enhancedPatients.filter(patient => {
      const matchesSearch = 
        `${patient.first_name} ${patient.last_name}`.toLowerCase().includes(effectiveSearchTerm.toLowerCase()) ||
        (patient.medical_record_number || '').toLowerCase().includes(effectiveSearchTerm.toLowerCase());
      
      const matchesStatus = effectiveStatusFilter === 'all' || patient.status === effectiveStatusFilter;
      const matchesDiagnosis = effectiveDiagnosisFilter === 'all' || patient.primary_diagnosis === effectiveDiagnosisFilter;
      const matchesAlert = 
        effectiveAlertFilter === 'all' ||
        (effectiveAlertFilter === 'critical' && patient.criticalAlerts > 0) ||
        (effectiveAlertFilter === 'active' && patient.activeAlertsCount > 0) ||
        (effectiveAlertFilter === 'none' && patient.activeAlertsCount === 0);
      
      return matchesSearch && matchesStatus && matchesDiagnosis && matchesAlert;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal, bVal;
      
      switch (effectiveSortBy) {
        case 'name':
          aVal = `${a.first_name} ${a.last_name}`.toLowerCase();
          bVal = `${b.first_name} ${b.last_name}`.toLowerCase();
          break;
        case 'lastActivity':
          aVal = new Date(a.lastActivity);
          bVal = new Date(b.lastActivity);
          break;
        case 'alerts':
          aVal = a.activeAlertsCount;
          bVal = b.activeAlertsCount;
          break;
        case 'visits':
          aVal = a.totalVisits;
          bVal = b.totalVisits;
          break;
        default:
          aVal = a.created_date;
          bVal = b.created_date;
      }
      
      if (aVal < bVal) return effectiveSortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return effectiveSortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    effectiveAlertFilter,
    effectiveDiagnosisFilter,
    effectiveSearchTerm,
    effectiveSortBy,
    effectiveSortOrder,
    effectiveStatusFilter,
    enhancedPatients,
  ]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: enhancedPatients.length,
      active: enhancedPatients.filter(p => p.status === 'active').length,
      withAlerts: alertsAvailable
        ? enhancedPatients.filter(p => p.activeAlertsCount > 0).length
        : null,
      critical: alertsAvailable
        ? enhancedPatients.filter(p => p.criticalAlerts > 0).length
        : null,
    };
  }, [alertsAvailable, enhancedPatients]);

  const getStatusColor = (status) => {
    const colors = {
      active: "bg-emerald-100 text-emerald-800 border-emerald-200",
      discharged: "bg-slate-100 text-slate-800 border-slate-200",
      hospitalized: "bg-red-100 text-red-800 border-red-200"
    };
    return colors[status] || colors.active;
  };

  const getRiskColor = (level) => {
    const colors = {
      high: "bg-red-100 text-red-800",
      medium: "bg-amber-100 text-amber-800",
      low: "bg-emerald-100 text-emerald-800"
    };
    return colors[level] || colors.low;
  };

  const toggleSort = (field) => {
    if (!visitsAvailable && (field === 'visits' || field === 'lastActivity')) return;
    if (!alertsAvailable && field === 'alerts') return;
    if (effectiveSortBy === field) {
      setSortOrder(effectiveSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (effectiveSortBy !== field) return <Minus className="w-4 h-4 opacity-30" />;
    return effectiveSortOrder === 'asc' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />;
  };

  // Admin-only surface: block non-admins (server-side authz is the real gate).
  if (!currentUserAvailable && !currentUserQuery.isError) {
    return (
      <PageContainer>
        <LoadingState label="Verifying administrator access..." className="py-24" />
      </PageContainer>
    );
  }

  if (currentUserQuery.isError || !isAdmin) {
    return (
      <PageContainer>
        <AccessDeniedState
          title="Access restricted"
          description="Patient Data Management is available to administrators only."
          className="py-24"
        />
      </PageContainer>
    );
  }

  if (patientQuery.isPending) {
    return (
      <PageContainer>
        <LoadingState label="Loading patient data..." className="py-24" />
      </PageContainer>
    );
  }

  if (patientQuery.isError) {
    return (
      <PageContainer>
        <AccessDeniedState
          title="Patient data unavailable"
          description="Patient access could not be verified. No patient records are displayed."
          className="py-24"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6">
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <TabsList className="inline-flex md:grid md:w-full md:max-w-md md:grid-cols-2 gap-1 min-w-max h-auto md:h-14">
                <TabsTrigger value="overview" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                  <Database className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span>Overview</span>
                </TabsTrigger>
                <TabsTrigger value="import" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                  <Upload className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span>Import Patients</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        <TabsContent value="overview" className="m-0">
          <div>
            <PageHeader
              icon={Users}
              eyebrow="Configuration"
              title="Patient Data Management"
              description="Comprehensive overview and management of all patients"
              favoritePage="PatientDataManagement"
            />

            {!visitsAvailable && (
              <Alert className="mb-4 border-amber-300 bg-amber-50" role="status">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-950">
                  {visitQuery.isError || patientQuery.isError || tenantScopesMismatch
                    ? 'Visit activity is unavailable because matching Patient and Visit access could not be verified. Visit counts and last activity are withheld. Platform owners remain blocked until a reviewed agency selector is available.'
                    : 'Reverifying matching Patient and Visit tenant access. Visit counts and last activity are temporarily withheld.'}
                </AlertDescription>
              </Alert>
            )}

            {!alertsAvailable && (
              <Alert className="mb-4 border-amber-300 bg-amber-50" role="status">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-950">
                  {alertQuery.isError
                    ? 'Patient alert data is unavailable because its tenant-scoped read could not be verified. Alert counts, risk labels, and alert filters are withheld.'
                    : 'Reverifying tenant-scoped alert data. Alert counts, risk labels, and alert filters are temporarily withheld.'}
                </AlertDescription>
              </Alert>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <StatCard label="Total Patients" value={stats.total} icon={Users} tone="navy" />
              <StatCard label="Active" value={stats.active} icon={Activity} tone="emerald" />
              <StatCard label="With Alerts" value={stats.withAlerts ?? '—'} icon={Bell} tone="amber" />
              <StatCard label="Critical" value={stats.critical ?? '—'} icon={AlertTriangle} tone="rose" />
      </div>

            {/* Duplicate Scanner */}
            <div className="mb-4 sm:mb-6">
              <DuplicateScanner />
            </div>

            {/* Filters */}
            <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="lg:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by name or MRN..."
                  value={effectiveSearchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11 touch-target"
                />
              </div>
            </div>

            <Select value={effectiveStatusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 touch-target">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="discharged">Discharged</SelectItem>
                <SelectItem value="hospitalized">Hospitalized</SelectItem>
              </SelectContent>
            </Select>

            <Select value={effectiveDiagnosisFilter} onValueChange={setDiagnosisFilter}>
              <SelectTrigger className="h-11 touch-target">
                <SelectValue placeholder="Diagnosis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Diagnoses</SelectItem>
                {uniqueDiagnoses.map(dx => (
                  <SelectItem key={dx} value={dx}>{dx}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={effectiveAlertFilter}
              onValueChange={setAlertFilter}
              disabled={!alertsAvailable}
            >
              <SelectTrigger className="h-11 touch-target">
                <SelectValue placeholder="Alerts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Alerts</SelectItem>
                <SelectItem value="critical">Critical Only</SelectItem>
                <SelectItem value="active">With Alerts</SelectItem>
                <SelectItem value="none">No Alerts</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

            {/* Patient Table */}
            <Card>
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4 text-base sm:text-lg">
            <span>Patients ({filteredAndSortedPatients.length})</span>
            <Link to={createPageUrl("Patients")} className="w-full sm:w-auto">
              <Button size="sm" className="min-h-[44px] w-full sm:w-auto">Manage Patients</Button>
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs sm:text-sm">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => toggleSort('name')}
                      className="gap-1 sm:gap-2 text-xs sm:text-sm p-1"
                    >
                      Patient <SortIcon field="name" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-xs sm:text-sm">Status</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Diagnosis</TableHead>
                  <TableHead className="text-xs sm:text-sm">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => toggleSort('alerts')}
                      disabled={!alertsAvailable}
                      className="gap-1 sm:gap-2 text-xs sm:text-sm p-1"
                    >
                      Alerts <SortIcon field="alerts" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Risk</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => toggleSort('visits')}
                      disabled={!visitsAvailable}
                      className="gap-1 sm:gap-2 text-xs sm:text-sm p-1"
                    >
                      Visits <SortIcon field="visits" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-xs sm:text-sm hidden xl:table-cell">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => toggleSort('lastActivity')}
                      disabled={!visitsAvailable}
                      className="gap-1 sm:gap-2 text-xs sm:text-sm p-1"
                    >
                      Last Activity <SortIcon field="lastActivity" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-xs sm:text-sm">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedPatients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell className="text-xs sm:text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {patient.first_name} {patient.last_name}
                        </p>
                        {patient.medical_record_number && (
                          <p className="text-xs text-slate-500 truncate">
                            MRN: {patient.medical_record_number}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${getStatusColor(patient.status)} text-xs`}>
                        {patient.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs sm:text-sm hidden md:table-cell">
                      <span className="truncate block max-w-[150px]">
                        {patient.primary_diagnosis || 'Not specified'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!alertsAvailable ? (
                          <Badge variant="outline" className="text-amber-700">
                            Unavailable
                          </Badge>
                        ) : patient.activeAlertsCount > 0 ? (
                          <>
                            <Badge variant="outline" className="gap-1">
                              <Bell className="w-3 h-3" />
                              {patient.activeAlertsCount}
                            </Badge>
                            {patient.criticalAlerts > 0 && (
                              <Badge className="bg-red-100 text-red-800">
                                {patient.criticalAlerts} Critical
                              </Badge>
                            )}
                          </>
                        ) : (
                          <Badge variant="outline" className="text-slate-500">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            None
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {alertsAvailable ? (
                        <Badge className={`${getRiskColor(patient.riskLevel)} text-xs`}>
                          {patient.riskLevel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-amber-700">Unavailable</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs sm:text-sm hidden lg:table-cell">
                      <span>{patient.totalVisits ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs hidden xl:table-cell">
                      <div className="flex items-center gap-1 text-slate-600">
                        <Clock className="w-3 h-3" />
                        <span className="whitespace-nowrap">
                          {!visitsAvailable ? 'Unavailable' : patient.lastActivity ?
                            formatEastern(patient.lastActivity, 'MMM d, yyyy') : 
                            'No activity'
                          }
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions" className="min-h-[44px] w-10">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`${createPageUrl("PatientDetails")}?patientId=${patient.id}`}>
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to={`${createPageUrl("SmartNoteAssistant")}?patientId=${patient.id}`}>
                              <FileText className="w-4 h-4 mr-2" />
                              Create Note
                            </Link>
                          </DropdownMenuItem>
                          {alertsAvailable && patient.activeAlertsCount > 0 && (
                            <DropdownMenuItem asChild>
                              <Link to={`${createPageUrl("PatientAlerts")}?patientId=${patient.id}`}>
                                <Bell className="w-4 h-4 mr-2" />
                                View Alerts
                              </Link>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem 
                            onClick={() => {
                              setSelectedPatientId(patient.id);
                              setFlagDialogOpen(true);
                            }}
                          >
                            <Flag className="w-4 h-4 mr-2" />
                            Flag Patient
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredAndSortedPatients.length === 0 && (
            <EmptyState
              icon={Users}
              title="No patients found"
              description="No patients match your current filters. Adjust or clear the filters to see more."
              className="m-4 sm:m-6"
            />
            )}
          </CardContent>
        </Card>

            {/* Flag Dialog */}
            <Dialog
              open={Boolean(filtersCurrent && patientQuery.isSuccess && selectedPatient && flagDialogOpen)}
              onOpenChange={setFlagDialogOpen}
            >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag Patient</DialogTitle>
            <DialogDescription>
              Create an alert or flag for {selectedPatient?.first_name} {selectedPatient?.last_name}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-4">
            This feature allows you to create custom alerts and flags for patients requiring special attention.
            Navigate to the Patient Alerts page to manage all alerts.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setFlagDialogOpen(false)}>
              Cancel
            </Button>
            <Button asChild>
              <Link to={`${createPageUrl("PatientAlerts")}?patientId=${selectedPatient?.id}`}>
                Go to Alerts
              </Link>
            </Button>
            </div>
          </DialogContent>
        </Dialog>
          </div>
        </TabsContent>

        <TabsContent value="import" className="m-0">
          <ImportPatientsTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

// Import Patients Component
function ImportPatientsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2 mb-2">
          <Upload className="w-6 h-6 text-navy-600 flex-shrink-0" />
          <span className="truncate">Patient roster import</span>
        </h2>
        <p className="text-xs sm:text-sm md:text-base text-slate-600">
          Use the current census file to add only new patients, or use the discharged report to safely archive patients who have been discharged.
        </p>
      </div>

      <Alert className="border-amber-300 bg-amber-50" role="status">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <AlertDescription className="text-amber-950">
          Patient roster import is paused until upload and processing can run through
          one atomic tenant-bound broker. This prevents a file uploaded under one
          agency authority from being processed after an account or agency switch.
        </AlertDescription>
      </Alert>
    </div>
  );
}
