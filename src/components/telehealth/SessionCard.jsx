import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Video, Calendar, User, Clock, Copy, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const statusColors = {
  scheduled: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-600"
};

const visitLabels = {
  routine_followup: "Routine Follow-up",
  urgent_care: "Urgent Care",
  medication_review: "Medication Review",
  care_plan_review: "Care Plan Review",
  admission_assessment: "Admission Assessment",
  discharge_planning: "Discharge Planning"
};

export default function SessionCard({ session, onJoin, onCancel, onTextPatient }) {
  const copyLink = async () => {
    if (!session.invite_link) return;
    try {
      await navigator.clipboard.writeText(session.invite_link);
      toast.success("Invite link copied!");
    } catch {
      toast.error("Couldn't copy the link — copy it manually.");
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={statusColors[session.status]}>{session.status}</Badge>
              <span className="text-xs text-slate-500">{visitLabels[session.visit_type] || session.visit_type}</span>
            </div>
            <h3 className="font-semibold text-slate-900 truncate">
              {session.patient_name || "Unknown Patient"}
            </h3>
            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500">
              {session.scheduled_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(session.scheduled_at), "MMM d, h:mm a")}
                </span>
              )}
              {session.host_name && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {session.host_name}
                </span>
              )}
              {session.duration_minutes && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {session.duration_minutes} min
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {(session.status === "scheduled" || session.status === "active") && (
              <Button size="sm" onClick={() => onJoin(session)} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                <Video className="w-4 h-4" />
                Join
              </Button>
            )}
            {session.invite_link && session.status !== "completed" && (
              <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5">
                <Copy className="w-3 h-3" />
                Copy Link
              </Button>
            )}
            {onTextPatient && session.invite_link && session.status !== "completed" && session.status !== "cancelled" && (
              <Button size="sm" variant="outline" onClick={() => onTextPatient(session)} className="gap-1.5">
                <MessageSquare className="w-3 h-3" />
                Text link
              </Button>
            )}
            {session.status === "scheduled" && (
              <Button size="sm" variant="ghost" onClick={() => onCancel(session)} className="text-red-600 hover:bg-red-50 text-xs">
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}