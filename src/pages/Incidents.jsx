import { base44 } from "@/api/base44Client";
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

  const { data: patients = [] } = useQuery({
    queryKey: ["incident-patients"],
    queryFn: async () => {
      const allPatients = await base44.entities.Patient.list("-updated_date", 500);
      return allPatients.filter((patient) => !patient.is_archived && patient.status === "active");
    },
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ["my-incidents"],
    queryFn: () => base44.entities.Incident.list("-created_date", 10),
    initialData: [],
  });

  const handleSubmitted = () => {
    queryClient.invalidateQueries({ queryKey: ["my-incidents"] });
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