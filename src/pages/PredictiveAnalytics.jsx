import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Activity,
  Users,
  Filter
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

import PatientRiskScorecard from "../components/predictive/PatientRiskScorecard";
import RehospitalizationPredictor from "../components/predictive/RehospitalizationPredictor";
import TherapyNeedForecaster from "../components/predictive/TherapyNeedForecaster";
import PopulationRiskOverview from "../components/predictive/PopulationRiskOverview";
import PredictiveInsightsPanel from "../components/predictive/PredictiveInsightsPanel";

export default function PredictiveAnalytics() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");

  // Fetch patients
  const { data: patients = [] } = useQuery({
    queryKey: ['predictivePatients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
  });

  // Fetch OASIS data
  const { data: oasisData = [] } = useQuery({
    queryKey: ['predictiveOASIS'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 200),
  });

  // Fetch visits
  const { data: visits = [] } = useQuery({
    queryKey: ['predictiveVisits'],
    queryFn: () => base44.entities.Visit.list('-created_date', 500),
  });

  // Fetch alerts
  const { data: alerts = [] } = useQuery({
    queryKey: ['predictiveAlerts'],
    queryFn: () => base44.entities.PatientAlert.filter({ status: 'active' }),
  });

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  return (
    <PageContainer>
      <PageHeader
        icon={TrendingUp}
        eyebrow="Analytics"
        title="Predictive Analytics"
        description="AI-powered patient outcome forecasting and risk assessment"
        favoritePage="PredictiveAnalytics"
        actions={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-full sm:w-36 h-11 touch-target">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedPatientId || "all"} onValueChange={(v) => setSelectedPatientId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-48 h-11 touch-target">
                <Users className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Select Patient" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Patients</SelectItem>
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-4 sm:mb-6">
          <TabsList className="inline-flex md:grid md:w-full md:max-w-2xl md:grid-cols-4 gap-1 min-w-max h-auto">
            <TabsTrigger value="overview" className="gap-1 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <Activity className="w-3 h-3 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="rehospitalization" className="gap-1 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4" /> <span className="hidden md:inline">Rehospitalization</span><span className="md:hidden">Rehosp</span>
            </TabsTrigger>
            <TabsTrigger value="therapy" className="gap-1 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" /> <span className="hidden md:inline">Therapy Need</span><span className="md:hidden">Therapy</span>
            </TabsTrigger>
            <TabsTrigger value="insights" className="gap-1 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <Brain className="w-3 h-3 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">AI Insights</span><span className="sm:hidden">AI</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 sm:space-y-6">
          <PopulationRiskOverview 
            patients={patients}
            oasisData={oasisData}
            visits={visits}
            alerts={alerts}
            riskFilter={riskFilter}
          />
          {selectedPatientId && (
            <PatientRiskScorecard
              patient={selectedPatient}
              oasisData={oasisData.filter(o => o.patient_id === selectedPatientId)}
              visits={visits.filter(v => v.patient_id === selectedPatientId)}
            />
          )}
        </TabsContent>

        {/* Rehospitalization Tab */}
        <TabsContent value="rehospitalization">
          <RehospitalizationPredictor
            patients={patients}
            oasisData={oasisData}
            visits={visits}
            selectedPatientId={selectedPatientId}
            riskFilter={riskFilter}
          />
        </TabsContent>

        {/* Therapy Need Tab */}
        <TabsContent value="therapy">
          <TherapyNeedForecaster
            patients={patients}
            oasisData={oasisData}
            visits={visits}
            selectedPatientId={selectedPatientId}
          />
        </TabsContent>

        {/* AI Insights Tab */}
        <TabsContent value="insights">
          <PredictiveInsightsPanel
            patients={patients}
            oasisData={oasisData}
            visits={visits}
            alerts={alerts}
            selectedPatientId={selectedPatientId}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}