import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Gauge, Brain, FileText } from "lucide-react";
import ReportsCenter from "@/components/admin/ReportsCenter";
import QualityMetricsDashboard from "@/components/admin/QualityMetricsDashboard";
import AIKPIReportGenerator from "@/components/admin/AIKPIReportGenerator";
import NoteConversionReport from "@/components/admin/NoteConversionReport";

/**
 * Reports Center — a single home for the agency admin's reporting surface.
 * Consolidates the standalone report builders that previously had no entry
 * point: the comprehensive Reports Center, quality metrics, AI-generated KPI
 * reports, and documentation note-conversion analytics.
 */
export default function AdminReportsCenterPage() {
  // ReportsCenter expects roster/clinical data as props (it filters them
  // directly), so fetch them here and pass arrays with safe defaults.
  const { data: users = [] } = useQuery({
    queryKey: ["reports-users"],
    queryFn: () => base44.entities.User.list("-created_date", 1000),
    initialData: [],
  });
  const { data: patients = [] } = useQuery({
    queryKey: ["reports-patients"],
    queryFn: () => base44.entities.Patient.list("-created_date", 1000),
    initialData: [],
  });
  const { data: visits = [] } = useQuery({
    queryKey: ["reports-visits"],
    queryFn: () => base44.entities.Visit.list("-created_date", 1000),
    initialData: [],
  });
  const { data: incidents = [] } = useQuery({
    queryKey: ["reports-incidents"],
    queryFn: () => base44.entities.Incident.list("-created_date", 1000),
    initialData: [],
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs defaultValue="reports" className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="reports" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="h-4 w-4 mr-2" />
              Report Builder
            </TabsTrigger>
            <TabsTrigger value="quality" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Gauge className="h-4 w-4 mr-2" />
              Quality Metrics
            </TabsTrigger>
            <TabsTrigger value="kpi" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Brain className="h-4 w-4 mr-2" />
              AI KPI Reports
            </TabsTrigger>
            <TabsTrigger value="notes" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="h-4 w-4 mr-2" />
              Note Analytics
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="reports">
          <ReportsCenter users={users} patients={patients} visits={visits} incidents={incidents} />
        </TabsContent>
        <TabsContent value="quality">
          <QualityMetricsDashboard />
        </TabsContent>
        <TabsContent value="kpi">
          <AIKPIReportGenerator />
        </TabsContent>
        <TabsContent value="notes">
          <NoteConversionReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
