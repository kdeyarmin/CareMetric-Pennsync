import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

const PRIORITY_STYLE = {
  critical: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-slate-100 text-slate-600",
};

const TYPE_EMOJI = {
  call: "📞", notify: "📢", schedule: "📅", order: "📦",
  coordinate: "🤝", document: "📝", safety: "🛡️", followup: "🔄", other: "📌",
};

export default function TaskResultList({ result }) {
  const [showAll, setShowAll] = useState(false);

  if (!result) return null;

  const tasks = result.tasks || result.generated_tasks || [];
  const displayed = showAll ? tasks : tasks.slice(0, 3);

  return (
    <div className="space-y-1.5">
      {/* Summary */}
      {result.summary && (
        <p className="text-[10px] text-slate-500 italic mb-1">{result.summary}</p>
      )}

      {/* Created badge */}
      {result.tasks_created > 0 && (
        <div className="flex items-center gap-1 mb-1">
          <CheckCircle2 className="w-3 h-3 text-blue-600" />
          <span className="text-[10px] font-semibold text-blue-700">
            {result.tasks_created} task(s) created in system
          </span>
        </div>
      )}

      {tasks.length === 0 && (
        <p className="text-[10px] text-slate-400 text-center py-2">No tasks identified</p>
      )}

      {/* Task items */}
      {displayed.map((task, i) => (
        <div key={i} className="p-2 rounded border border-slate-200/50 bg-gradient-to-br from-blue-50/30 to-slate-50/40">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-xs">{TYPE_EMOJI[task.type] || "📌"}</span>
            <Badge className={`text-[8px] px-1 py-0 ${PRIORITY_STYLE[task.priority]}`}>
              {task.priority}
            </Badge>
            <Badge variant="outline" className="text-[8px] px-1 py-0">{task.type}</Badge>
            {task.due_in_days !== undefined && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                Due: {task.due_in_days}d
              </Badge>
            )}
            {task.target_role && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                {task.target_role}
              </Badge>
            )}
          </div>
          <p className="text-[11px] font-medium text-slate-800">{task.title}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">{task.description}</p>
          {task.ai_reason && (
            <p className="text-[9px] text-slate-400 mt-0.5 italic">AI: {task.ai_reason}</p>
          )}
        </div>
      ))}

      {tasks.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[10px] text-blue-600 hover:underline flex items-center gap-1 mx-auto"
        >
          {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showAll ? "Show less" : `Show all ${tasks.length} tasks`}
        </button>
      )}
    </div>
  );
}