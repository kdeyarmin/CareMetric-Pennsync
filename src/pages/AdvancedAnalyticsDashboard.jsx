import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Brain, FileText } from "lucide-react";
import PopulationTrendAnalyzer from "../components/analytics/PopulationTrendAnalyzer";
import PredictiveReadmissionModel from "../components/analytics/PredictiveReadmissionModel";
import CustomReportBuilder from "../components/analytics/CustomReportBuilder";
import DiseaseProgressionPredictor from "../components/analytics/DiseaseProgressionPredictor";

export default function AdvancedAnalyticsDashboard() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 1000),
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['allIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date', 500),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const isAdmin = currentUser?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            This dashboard is only available to administrators.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-2">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg flex-shrink-0">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 truncate">Advanced Analytics</h1>
            <p className="text-xs sm:text-sm md:text-base text-gray-600 truncate">Sophisticated insights with AI-powered predictions</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="trends" className="space-y-4 sm:space-y-6 w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 gap-2 p-1 h-auto w-full">
          <TabsTrigger value="trends" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Population Trends</span>
            <span className="sm:hidden">Trends</span>
          </TabsTrigger>
          <TabsTrigger value="readmission" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
            <Brain className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Readmission Risk</span>
            <span className="sm:hidden">Risk</span>
          </TabsTrigger>
          <TabsTrigger value="progression" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
            <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Disease Progression</span>
            <span className="sm:hidden">Progression</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
            <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Custom Reports</span>
            <span className="sm:hidden">Reports</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-6">
          <PopulationTrendAnalyzer
            patients={patients}
            visits={visits}
            incidents={incidents}
          />
        </TabsContent>

        <TabsContent value="readmission" className="space-y-6">
          <PredictiveReadmissionModel
            patients={patients}
            visits={visits}
            incidents={incidents}
          />
        </TabsContent>

        <TabsContent value="progression" className="space-y-6">
          <DiseaseProgressionPredictor
            patients={patients}
            visits={visits}
          />
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <CustomReportBuilder
            patients={patients}
            visits={visits}
            incidents={incidents}
            users={users}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}