import { useState, useMemo } from "react";
import DuplicateScanner from "../components/patient/DuplicateScanner";
import PatientFileUpdateUploader from "../components/patient/PatientFileUpdateUploader";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import PageContainer from "@/components/ui/PageContainer";
import LoadingState from "@/components/ui/LoadingState";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { formatEastern } from "../components/utils/timezone";

export default function PatientDataManagement() {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [diagnosisFilter, setDiagnosisFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);

  // Admin-only page: gate the agency-wide data pulls on role (defense in depth;
  // server-side row authorization is the primary control).
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const isAdmin = currentUser?.role === 'admin';

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      try {
        const allPatients = await base44.entities.Patient.list('-created_date', 2000);
        return allPatients.filter(patient => !patient.is_archived);
      } catch (err) {
        console.error('Failed to load patients:', err);
        return [];
      }
    },
    initialData: [],
    enabled: isAdmin,
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: async () => {
      try {
        return await base44.entities.Visit.list('-visit_date', 500);
      } catch (err) {
        console.error('Failed to load visits:', err);
        return [];
      }
    },
    initialData: [],
    enabled: isAdmin,
  });

  const { data: allAlerts = [] } = useQuery({
    queryKey: ['allAlerts'],
    queryFn: async () => {
      try {
        return await base44.entities.PatientAlert.list('-created_date', 200);
      } catch (err) {
        console.error('Failed to load alerts:', err);
        return [];
      }
    },
    initialData: [],
    enabled: isAdmin,
  });

  const { data: allIncidents = [] } = useQuery({
    queryKey: ['allIncidents'],
    queryFn: async () => {
      try {
        return await base44.entities.Incident.list('-incident_date', 200);
      } catch (err) {
        console.error('Failed to load incidents:', err);
        return [];
      }
    },
    initialData: [],
    enabled: isAdmin,
  });

  // Get unique diagnoses for filter
  const uniqueDiagnoses = useMemo(() => {
    const diagnoses = new Set();
    patients.forEach(p => {
      if (p.primary_diagnosis) diagnoses.add(p.primary_diagnosis);
    });
    return Array.from(diagnoses).sort();
  }, [patients]);

  // Enhanced patient data with activity and alerts
  const enhancedPatients = useMemo(() => {
    return patients.map(patient => {
      const patientVisits = allVisits.filter(v => v.patient_id === patient.id);
      const patientAlerts = allAlerts.filter(a => a.patient_id === patient.id && a.status === 'active');
      const patientIncidents = allIncidents.filter(i => i.patient_id === patient.id);
      
      const recentVisit = patientVisits[0];
      const activeAlertsCount = patientAlerts.length;
      const criticalAlerts = patientAlerts.filter(a => a.severity === 'critical').length;
      
      return {
        ...patient,
        recentVisit,
        totalVisits: patientVisits.length,
        activeAlertsCount,
        criticalAlerts,
        hasIncidents: patientIncidents.length > 0,
        lastActivity: recentVisit?.visit_date || patient.created_date,
        riskLevel: criticalAlerts > 0 ? 'high' : activeAlertsCount > 2 ? 'medium' : 'low'
      };
    });
  }, [patients, allVisits, allAlerts, allIncidents]);

  // Filter and sort
  const filteredAndSortedPatients = useMemo(() => {
    let filtered = enhancedPatients.filter(patient => {
      const matchesSearch = 
        `${patient.first_name} ${patient.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (patient.medical_record_number || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || patient.status === statusFilter;
      const matchesDiagnosis = diagnosisFilter === 'all' || patient.primary_diagnosis === diagnosisFilter;
      const matchesAlert = 
        alertFilter === 'all' ||
        (alertFilter === 'critical' && patient.criticalAlerts > 0) ||
        (alertFilter === 'active' && patient.activeAlertsCount > 0) ||
        (alertFilter === 'none' && patient.activeAlertsCount === 0);
      
      return matchesSearch && matchesStatus && matchesDiagnosis && matchesAlert;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
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
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [enhancedPatients, searchTerm, statusFilter, diagnosisFilter, alertFilter, sortBy, sortOrder]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: enhancedPatients.length,
      active: enhancedPatients.filter(p => p.status === 'active').length,
      withAlerts: enhancedPatients.filter(p => p.activeAlertsCount > 0).length,
      critical: enhancedPatients.filter(p => p.criticalAlerts > 0).length,
    };
  }, [enhancedPatients]);

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
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <Minus className="w-4 h-4 opacity-30" />;
    return sortOrder === 'asc' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />;
  };

  // Admin-only surface: block non-admins (server-side authz is the real gate).
  if (currentUser && !isAdmin) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <Card className="max-w-md border-amber-300">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Access restricted</h2>
            <p className="text-sm text-slate-600">
              Patient Data Management is available to administrators only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState label="Loading patient data..." className="py-24" />
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

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Total Patients</p>
                <p className="text-xl sm:text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Active</p>
                <p className="text-xl sm:text-2xl font-bold text-emerald-600">{stats.active}</p>
              </div>
              <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">With Alerts</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-600">{stats.withAlerts}</p>
              </div>
              <Bell className="w-6 h-6 sm:w-8 sm:h-8 text-amber-500 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Critical</p>
                <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.critical}</p>
              </div>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-500 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
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
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11 touch-target"
                />
              </div>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
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

            <Select value={diagnosisFilter} onValueChange={setDiagnosisFilter}>
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

            <Select value={alertFilter} onValueChange={setAlertFilter}>
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
                        {patient.activeAlertsCount > 0 ? (
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
                      <Badge className={`${getRiskColor(patient.riskLevel)} text-xs`}>
                        {patient.riskLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs sm:text-sm hidden lg:table-cell">
                      <span>{patient.totalVisits}</span>
                    </TableCell>
                    <TableCell className="text-xs hidden xl:table-cell">
                      <div className="flex items-center gap-1 text-slate-600">
                        <Clock className="w-3 h-3" />
                        <span className="whitespace-nowrap">
                          {patient.lastActivity ? 
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
                          {patient.activeAlertsCount > 0 && (
                            <DropdownMenuItem asChild>
                              <Link to={`${createPageUrl("PatientAlerts")}?patientId=${patient.id}`}>
                                <Bell className="w-4 h-4 mr-2" />
                                View Alerts
                              </Link>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem 
                            onClick={() => {
                              setSelectedPatient(patient);
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
            <div className="p-8 text-center text-slate-500">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No patients found matching your filters.</p>
            </div>
            )}
          </CardContent>
        </Card>

            {/* Flag Dialog */}
            <Dialog open={flagDialogOpen} onOpenChange={setFlagDialogOpen}>
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
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2 mb-2">
          <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 flex-shrink-0" />
          <span className="truncate">Patient roster import</span>
        </h2>
        <p className="text-xs sm:text-sm md:text-base text-slate-600">
          Use the current census file to add only new patients, or use the discharged report to safely archive patients who have been discharged.
        </p>
      </div>

      <PatientFileUpdateUploader />
    </div>
  );
}