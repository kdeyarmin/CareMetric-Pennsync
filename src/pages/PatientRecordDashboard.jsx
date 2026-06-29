import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
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
import PatientSearchBar from "../components/dashboard/PatientSearchBar";
import PatientQuickActions from "../components/dashboard/PatientQuickActions";
import PatientOverviewCard from "../components/dashboard/PatientOverviewCard";
import RecentActivityFeed from "../components/dashboard/RecentActivityFeed";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function PatientRecordDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    careType: "all",
    diagnosis: "",
    dateRange: "all"
  });
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [view, setView] = useState("grid"); // grid or list
  const queryClient = useQueryClient();

  // Refresh the dashboard's data after a quick action without a full page reload.
  const refreshDashboard = () => {
    ['all-patients', 'all-visits', 'all-care-plans', 'active-alerts'].forEach(
      (key) => queryClient.invalidateQueries({ queryKey: [key] })
    );
  };

  // Fetch all data in parallel
  const { data: patients = [], isLoading: loadingPatients } = useQuery({
    queryKey: ['all-patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 1000)
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['all-visits'],
    queryFn: () => base44.entities.Visit.list('-created_date', 500)
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['all-care-plans'],
    queryFn: () => base44.entities.CarePlan.list('-created_date', 500)
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['active-alerts'],
    queryFn: () => base44.entities.PatientAlert.filter({ status: 'active' }, '-created_date', 100)
  });

  // Filter patients based on search and filters
  const filteredPatients = useMemo(() => {
    let result = patients;

    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.first_name?.toLowerCase().includes(query) ||
        p.last_name?.toLowerCase().includes(query) ||
        p.medical_record_number?.toLowerCase().includes(query) ||
        p.phone?.includes(query) ||
        p.primary_diagnosis?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filters.status !== "all") {
      result = result.filter(p => p.status === filters.status);
    }

    // Care type filter
    if (filters.careType !== "all") {
      result = result.filter(p => p.care_type === filters.careType);
    }

    // Diagnosis filter
    if (filters.diagnosis) {
      const diagQuery = filters.diagnosis.toLowerCase();
      result = result.filter(p =>
        p.primary_diagnosis?.toLowerCase().includes(diagQuery)
      );
    }

    // Date range filter
    if (filters.dateRange !== "all") {
      const now = new Date();
      result = result.filter(p => {
        if (!p.admission_date) return false;
        const admissionDate = new Date(p.admission_date);
        const daysDiff = (now - admissionDate) / (1000 * 60 * 60 * 24);

        switch (filters.dateRange) {
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
  }, [patients, searchQuery, filters]);

  // Calculate statistics
  const stats = useMemo(() => {
    const activePatients = patients.filter(p => p.status === 'active').length;
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    const recentVisits = visits.filter(v => {
      if (!v.visit_date) return false;
      const visitDate = new Date(v.visit_date);
      const daysDiff = (new Date() - visitDate) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    }).length;

    return {
      totalPatients: patients.length,
      activePatients,
      criticalAlerts,
      recentVisits
    };
  }, [patients, alerts, visits]);

  if (loadingPatients) {
    return (
      <PageContainer>
        <LoadingState label="Loading patient records..." className="py-24" />
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
          <PatientQuickActions onActionComplete={refreshDashboard} />
        }
      />

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Total Patients" value={stats.totalPatients} icon={Users} tone="navy" />
          <StatCard label="Active Patients" value={stats.activePatients} icon={Activity} tone="emerald" />
          <StatCard label="Critical Alerts" value={stats.criticalAlerts} icon={AlertCircle} tone="rose" />
          <StatCard label="Visits (7 days)" value={stats.recentVisits} icon={Calendar} tone="sky" />
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="p-6">
            <PatientSearchBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filters={filters}
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
                      {filteredPatients.map(patient => (
                        <PatientOverviewCard
                          key={patient.id}
                          patient={patient}
                          visits={visits.filter(v => v.patient_id === patient.id)}
                          carePlans={carePlans.filter(cp => cp.patient_id === patient.id)}
                          alerts={alerts.filter(a => a.patient_id === patient.id)}
                          isSelected={selectedPatient?.id === patient.id}
                          onSelect={() => setSelectedPatient(patient)}
                          view={view}
                        />
                      ))}
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
                <RecentActivityFeed
                  visits={visits.slice(0, 10)}
                  alerts={alerts.slice(0, 5)}
                  patients={patients}
                />
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
                      onClick={() => window.location.href = `/PatientDetails?id=${selectedPatient.id}`}
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