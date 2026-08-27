import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients, activeAndNotArchived } from "@/hooks/useScopedPatients";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import SmartIncidentForm from "@/components/incident/SmartIncidentForm";
import IncidentRecentList from "@/components/incident/IncidentRecentList";

export default function Incidents() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  // `select` rather than a filter inside the queryFn, so the shared cache entry
  // keeps the full scoped roster and each consumer narrows its own view of it.
  const { data: patients = [] } = useScopedPatients({
    sort: "-updated_date",
    limit: 500,
    select: activeAndNotArchived,
  });

  // Fetch a full page before agency post-filter — a small limit let foreign-
  // agency rows fill the window and hide this agency's recent reports.
  const { data: incidents = [] } = useAgencyScopedQuery({
    queryKey: ["my-incidents"],
    fetch: () => base44.entities.Incident.list("-created_date", 5000),
    initialData: [],
  });

  const handleSubmitted = () => {
    queryClient.invalidateQueries({ queryKey: ["my-incidents"] });
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
    queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
    queryClient.invalidateQueries({ queryKey: ["incidentsForKPI"] });
    queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <PageContainer>
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Patient Care"
        title="Incidents"
        description="Report any safety event in one place — state reportable events are detected automatically and routed to administrators."
        favoritePage="Incidents"
      />

      <Tabs defaultValue="report" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="report" className="min-h-[44px]">Report Incident</TabsTrigger>
          <TabsTrigger value="recent" className="min-h-[44px]">Recent Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="report">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-6">
            <SmartIncidentForm
              patients={patients}
              currentUser={currentUser}
              onSubmitted={handleSubmitted}
            />
            <IncidentRecentList incidents={incidents} />
          </div>
        </TabsContent>

        <TabsContent value="recent">
          <IncidentRecentList incidents={incidents} detailed />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}