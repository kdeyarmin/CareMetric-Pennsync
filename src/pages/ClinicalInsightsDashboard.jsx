import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, TrendingUp, AlertTriangle, Brain } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import PopulationTrendAnalyzer from "../components/analytics/PopulationTrendAnalyzer";
import DiseaseProgressionPredictor from "../components/analytics/DiseaseProgressionPredictor";

export default function ClinicalInsightsDashboard() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['myPatients'],
    queryFn: async () => {
      const allPatients = await base44.entities.Patient.list('-updated_date', 2000);
      // For nurses, filter to their assigned patients (simplification - all active for now)
      return allPatients.filter(p => p.status === "active");
    },
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['myVisits'],
    queryFn: async () => {
      return await base44.entities.Visit.list('-visit_date', 500);
    },
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['recentIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date', 200),
    initialData: [],
  });

  // Quick stats for clinician view
  const myVisitsCount = visits.filter(v => v.created_by === currentUser?.email).length;
  const myCompletedVisits = visits.filter(v => v.created_by === currentUser?.email && v.status === "completed").length;
  const completionRate = myVisitsCount > 0 ? Math.round((myCompletedVisits / myVisitsCount) * 100) : 0;

  return (
    <PageContainer>
      <PageHeader
        icon={Brain}
        eyebrow="Admin"
        title="Clinical Insights"
        description="Population health trends and patient monitoring"
        favoritePage="ClinicalInsightsDashboard"
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">My Active Patients</p>
                <p className="text-xl sm:text-2xl font-bold">{patients.length}</p>
              </div>
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Total Visits</p>
                <p className="text-xl sm:text-2xl font-bold">{myVisitsCount}</p>
              </div>
              <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Completion Rate</p>
                <p className="text-xl sm:text-2xl font-bold">{completionRate}%</p>
              </div>
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-navy-600 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-600 truncate">Recent Incidents</p>
                <p className="text-xl sm:text-2xl font-bold">
                  {incidents.filter(i => i.created_by === currentUser?.email).length}
                </p>
              </div>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-600 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Population Trends */}
      <div className="mb-4 sm:mb-6">
        <Card>
          <CardHeader className="p-3 sm:p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Population Health Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PopulationTrendAnalyzer
              patients={patients}
              visits={visits}
              incidents={incidents}
            />
          </CardContent>
        </Card>
      </div>

      {/* Disease Progression Monitoring */}
      <div>
        <Card>
          <CardHeader className="p-3 sm:p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Activity className="w-5 h-5 text-navy-600" />
              Patient Progression Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DiseaseProgressionPredictor
              patients={patients}
              visits={visits}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}