import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, ShieldAlert, Image as ImageIcon, CheckCircle2, Eye, Clock } from "lucide-react";
import { toast } from "sonner";
import { transitionIncident } from "@/functions/updateIncident";
import {
  canTransitionIncidentStatus,
  createIncidentReviewEvent,
  incidentNeedsCorrectiveAction,
} from "@/components/incident/incidentLifecycle";
import { isSafeExternalUrl } from "@/components/utils/security";

const severityClasses = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const statusClasses = {
  reported: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-800",
  corrective_action: "bg-orange-100 text-orange-800",
  resolved: "bg-slate-100 text-slate-600",
};

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "reported", label: "New" },
  { value: "under_review", label: "Under Review" },
  { value: "corrective_action", label: "CAP" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

function IncidentReviewCard({ incident, actorEmail }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(incident.resolution_notes || "");
  const [capPlan, setCapPlan] = useState(incident.corrective_action_plan || "");
  const [expanded, setExpanded] = useState(false);
  const needsCap = incidentNeedsCorrectiveAction(incident);

  // Incident writes are service-role-only. The function re-checks the
  // transition graph and the corrective-action requirement, so the guards below
  // are fast feedback, not the enforcement point.
  const update = useMutation({
    mutationFn: ({ status, ...rest }) => transitionIncident({
      incidentId: incident.id,
      toStatus: status,
      resolutionNotes: rest.resolution_notes,
      correctiveActionPlan: rest.corrective_action_plan,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["my-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incidentsForKPI"] });
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
    },
    onError: (e) => toast.error(e?.message || "Couldn't update the incident"),
  });

  const applyTransition = (toStatus, extra = {}) => {
    const fromStatus = incident.status || "reported";
    if (!canTransitionIncidentStatus(fromStatus, toStatus)) {
      toast.error(`Cannot move incident from ${fromStatus.replace(/_/g, " ")} to ${toStatus.replace(/_/g, " ")}`);
      return;
    }
    try {
      // Validate + shape audit metadata (pure helper). Entity update carries the operational fields.
      createIncidentReviewEvent({
        incidentId: incident.id,
        fromStatus,
        toStatus,
        actorEmail: actorEmail || "system",
        reason: extra.resolution_notes || extra.corrective_action_plan || `Status -> ${toStatus}`,
      });
    } catch (err) {
      toast.error(err?.message || "Invalid incident transition");
      return;
    }
    // reviewed_by/at, closed_by/at, investigator_email and office_notified are
    // stamped by updateIncident from the authenticated caller. Sending them
    // from here would be advisory at best and forgeable at worst.
    update.mutate({ status: toStatus, ...extra }, {
      onSuccess: () => {
        const labels = {
          under_review: "Marked under review",
          corrective_action: "Moved to corrective action",
          resolved: "Incident resolved",
        };
        toast.success(labels[toStatus] || "Incident updated");
      },
    });
  };

  const acknowledge = () => applyTransition("under_review");

  const startCorrectiveAction = () =>
    applyTransition("corrective_action", {
      corrective_action_plan: capPlan.trim() || notes.trim() || "Corrective action required",
    });

  const resolve = () => {
    if (needsCap && !(capPlan.trim() || incident.corrective_action_plan || notes.trim())) {
      toast.error("High-severity or state-reportable incidents need a corrective action note before resolve");
      return;
    }
    applyTransition("resolved", {
      resolution_notes: notes,
      corrective_action_plan: capPlan.trim() || incident.corrective_action_plan || undefined,
    });
  };

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
              {needsCap && incident.status !== "resolved" && (
                <Badge className="bg-orange-100 text-orange-800">CAP recommended</Badge>
              )}
            </div>
            <p className="font-semibold text-slate-900 truncate">
              {incident.incident_name || (incident.incident_type || "").replace(/_/g, " ")}
            </p>
            <p className="text-xs text-slate-500">
              {incident.patient_name || "Patient"} • {incident.incident_date}
              {incident.incident_time ? ` ${incident.incident_time}` : ""}
              {incident.created_by ? ` • reported by ${incident.created_by}` : ""}
              {incident.reviewed_by ? ` • reviewed by ${incident.reviewed_by}` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {incident.status !== "under_review" && incident.status !== "corrective_action" && incident.status !== "resolved" && (
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
                {incident.photo_urls.filter((url) => isSafeExternalUrl(url)).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={url} alt="Incident" className="h-20 w-20 rounded-lg object-cover border" />
                  </a>
                ))}
              </div>
            )}

            {incident.state_reportable_pdf_url && isSafeExternalUrl(incident.state_reportable_pdf_url) && (
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
                {needsCap && (
                  <Textarea
                    value={capPlan}
                    onChange={(e) => setCapPlan(e.target.value)}
                    placeholder="Corrective action plan…"
                    className="min-h-[64px]"
                  />
                )}
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Resolution notes…"
                  className="min-h-[72px]"
                />
                <div className="flex flex-wrap gap-2">
                  {needsCap && incident.status !== "corrective_action" && (
                    <Button size="sm" variant="outline" onClick={startCorrectiveAction} disabled={update.isPending} className="gap-1.5">
                      Start CAP
                    </Button>
                  )}
                  <Button size="sm" onClick={resolve} disabled={update.isPending} className="gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Resolve incident
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {incident.corrective_action_plan && (
                  <div className="rounded-lg bg-orange-50 border border-orange-100 p-3 text-sm text-slate-700">
                    <p className="text-xs font-semibold text-orange-700 mb-1">Corrective action</p>
                    {incident.corrective_action_plan}
                  </div>
                )}
                {incident.resolution_notes && (
                  <div className="rounded-lg bg-slate-50 border p-3 text-sm text-slate-700">
                    <p className="text-xs font-semibold text-slate-500 mb-1">Resolution</p>
                    {incident.resolution_notes}
                    {incident.closed_by && (
                      <p className="text-xs text-slate-400 mt-2">Closed by {incident.closed_by}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function IncidentReviewQueue() {
  const [statusFilter, setStatusFilter] = useState("open");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: incidents = [], isLoading } = useAgencyScopedQuery({
    queryKey: ["admin-incidents"],
    fetch: () => base44.entities.Incident.list("-created_date", 5000),
    initialData: [],
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (statusFilter === "all") return incidents;
    if (statusFilter === "open") return incidents.filter((i) => i.status !== "resolved" && i.status !== "archived");
    return incidents.filter((i) => (i.status || "reported") === statusFilter);
  }, [incidents, statusFilter]);

  const openCount = incidents.filter((i) => i.status !== "resolved" && i.status !== "archived").length;

  return (
    <div className="space-y-4">
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6">
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
            <IncidentReviewCard key={incident.id} incident={incident} actorEmail={currentUser?.email} />
          ))}
        </div>
      )}
    </div>
  );
}
