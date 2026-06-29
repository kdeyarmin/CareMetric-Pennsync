import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, ShieldAlert, Image as ImageIcon, CheckCircle2, Eye, Clock } from "lucide-react";
import { toast } from "sonner";

const severityClasses = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const statusClasses = {
  reported: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-800",
  resolved: "bg-slate-100 text-slate-600",
};

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "reported", label: "New" },
  { value: "under_review", label: "Under Review" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

function IncidentReviewCard({ incident }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(incident.resolution_notes || "");
  const [expanded, setExpanded] = useState(false);

  const update = useMutation({
    mutationFn: (data) => base44.entities.Incident.update(incident.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-incidents"] }),
    onError: (e) => toast.error(e?.message || "Couldn't update the incident"),
  });

  const acknowledge = () =>
    update.mutate({ status: "under_review", office_notified: true }, { onSuccess: () => toast.success("Marked under review") });

  const resolve = () =>
    update.mutate(
      { status: "resolved", resolution_notes: notes },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
          toast.success("Incident resolved");
        },
      }
    );

  return (
    <Card className={incident.state_reportable ? "border-red-300" : ""}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge className={statusClasses[incident.status] || statusClasses.reported}>
                {(incident.status || "reported").replace(/_/g, " ")}
              </Badge>
              <Badge className={severityClasses[incident.severity] || severityClasses.medium}>{incident.severity}</Badge>
              {incident.state_reportable && (
                <Badge className="bg-red-600 text-white gap-1">
                  <ShieldAlert className="w-3 h-3" /> State Reportable
                </Badge>
              )}
            </div>
            <p className="font-semibold text-slate-900 truncate">
              {incident.incident_name || (incident.incident_type || "").replace(/_/g, " ")}
            </p>
            <p className="text-xs text-slate-500">
              {incident.patient_name || "Patient"} • {incident.incident_date}
              {incident.incident_time ? ` ${incident.incident_time}` : ""}
              {incident.created_by ? ` • reported by ${incident.created_by}` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {incident.status !== "under_review" && incident.status !== "resolved" && (
              <Button size="sm" variant="outline" onClick={acknowledge} disabled={update.isPending} className="gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Review
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} className="text-xs">
              {expanded ? "Hide" : "Details"}
            </Button>
          </div>
        </div>

        {incident.alert_triggered && (
          <div className="flex items-center gap-2 text-xs text-red-700">
            <AlertTriangle className="w-3 h-3" /> Immediate admin alert was sent
          </div>
        )}

        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            {incident.report && <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.report}</p>}

            {incident.photo_urls?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {incident.photo_urls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={url} alt="Incident" className="h-20 w-20 rounded-lg object-cover border" />
                  </a>
                ))}
              </div>
            )}

            {incident.state_reportable_pdf_url && (
              <a
                href={incident.state_reportable_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:underline"
              >
                <ImageIcon className="w-3.5 h-3.5" /> View state-reportable PDF
              </a>
            )}

            {incident.status !== "resolved" ? (
              <div className="space-y-2">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Resolution notes…"
                  className="min-h-[72px]"
                />
                <Button size="sm" onClick={resolve} disabled={update.isPending} className="gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Resolve incident
                </Button>
              </div>
            ) : (
              incident.resolution_notes && (
                <div className="rounded-lg bg-slate-50 border p-3 text-sm text-slate-700">
                  <p className="text-xs font-semibold text-slate-500 mb-1">Resolution</p>
                  {incident.resolution_notes}
                </div>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function IncidentReviewQueue() {
  const [statusFilter, setStatusFilter] = useState("open");

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ["admin-incidents"],
    queryFn: () => base44.entities.Incident.list("-created_date", 500),
    initialData: [],
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (statusFilter === "all") return incidents;
    if (statusFilter === "open") return incidents.filter((i) => i.status !== "resolved");
    return incidents.filter((i) => (i.status || "reported") === statusFilter);
  }, [incidents, statusFilter]);

  const openCount = incidents.filter((i) => i.status !== "resolved").length;

  return (
    <div className="space-y-4">
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
          {STATUS_FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value} className="min-h-[44px]">
              {f.label}
              {f.value === "open" && openCount > 0 && (
                <Badge className="ml-1.5 bg-amber-500 text-white h-5 min-w-[20px] px-1.5">{openCount}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" /> Loading incidents…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">
          No incidents in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((incident) => (
            <IncidentReviewCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  );
}