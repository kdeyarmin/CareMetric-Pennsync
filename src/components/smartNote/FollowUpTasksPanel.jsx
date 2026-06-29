import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X } from "lucide-react";

const PRIORITY_STYLES = {
  high: "bg-red-100 text-red-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
};

const TYPE_EMOJI = {
  call: "📞",
  notify: "📢",
  schedule: "📅",
  order: "📋",
  coordinate: "🤝",
  document: "📝",
  safety: "⚠️",
  followup: "🔄",
  other: "•",
};

export default function FollowUpTasksPanel({ tasks = [], onDismiss }) {
  if (!tasks.length) return null;

  return (
    <Card className="border-2 border-green-300 bg-green-50 shadow-md animate-fade-in">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-green-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            {tasks.length} Follow-up Task{tasks.length !== 1 ? "s" : ""} Auto-Created
          </CardTitle>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-700 hover:bg-green-100"
              onClick={onDismiss}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-green-700 mt-0.5">
          AI extracted these follow-up tasks from your finalized note and synced them to Task Management.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pb-4 px-4">
        {tasks.map((task, i) => (
          <div
            key={task.id || i}
            className="bg-white rounded-lg border border-green-200 p-3 flex items-start gap-3"
          >
            <span className="text-lg shrink-0">{TYPE_EMOJI[task.type] || "•"}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 leading-tight">{task.title}</p>
                <Badge className={`shrink-0 text-xs ${PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium}`}>
                  {task.priority}
                </Badge>
              </div>
              {task.due_date && (
                <p className="text-xs text-slate-500 mt-0.5">Due: {task.due_date}</p>
              )}
              {task.ai_reason && (
                <p className="text-xs text-slate-500 mt-0.5 italic">{task.ai_reason}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}