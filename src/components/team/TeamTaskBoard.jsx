import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, CheckCircle2, Clock, AlertTriangle, User, Calendar, X, Loader2
} from "lucide-react";
import { format, parseISO, isPast, isToday } from "date-fns";
import { todayEastern } from "@/components/utils/timezone";
import { toast } from "sonner";

export default function TeamTaskBoard({ agencyId, currentUser, teamMembers }) {
  const [showForm, setShowForm] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterStatus, setFilterStatus] = useState("pending");
  const queryClient = useQueryClient();

  const [newTask, setNewTask] = useState({
    title: "", description: "", priority: "medium", type: "other",
    assigned_to: "", due_date: todayEastern(), patient_id: "",
  });

  // Fetch all tasks created by agency members (we'll use the wider list)
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["teamTasks", agencyId],
    queryFn: async () => {
      // For admins, fetch all tasks; for regular users, tasks they created or are assigned to
      const tasks = await base44.entities.Task.list("-created_date", 500);
      return tasks;
    },
    enabled: !!agencyId,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 200),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamTasks"] });
      setShowForm(false);
      setNewTask({ title: "", description: "", priority: "medium", type: "other", assigned_to: "", due_date: todayEastern(), patient_id: "" });
      toast.success("Task assigned");
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id) => base44.entities.Task.update(id, { status: "completed", completion_notes: `Completed by ${currentUser?.full_name}` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamTasks"] });
      toast.success("Task completed");
    },
  });

  const handleCreate = () => {
    if (!newTask.title.trim()) { toast.error("Title required"); return; }
    if (!newTask.assigned_to) { toast.error("Please assign to a team member"); return; }
    createMutation.mutate({
      ...newTask,
      source: "manual",
      status: "pending",
      notification_preferences: { enabled: true, notify_before_hours: 24, notify_on_overdue: true },
    });
  };

  const filtered = allTasks.filter(t => {
    const matchAssignee = filterAssignee === "all" || t.assigned_to === filterAssignee;
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchAssignee && matchStatus;
  });

  const PRIORITY_COLORS = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-blue-100 text-blue-800",
    low: "bg-slate-100 text-slate-700",
  };

  const getMemberName = (email) => {
    const m = teamMembers.find(u => u.email === email);
    return m?.full_name || email;
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap flex-1">
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue placeholder="Filter by assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Members</SelectItem>
              {teamMembers.map(m => (
                <SelectItem key={m.email} value={m.email}>{m.full_name || m.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Assign Task
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Title *</Label>
                <Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="Task title" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Assign To *</Label>
                <Select value={newTask.assigned_to} onValueChange={(v) => setNewTask({ ...newTask, assigned_to: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select team member" /></SelectTrigger>
                  <SelectContent>
                    {teamMembers.map(m => (
                      <SelectItem key={m.email} value={m.email}>{m.full_name || m.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} placeholder="Description" className="text-sm h-16" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={newTask.type} onValueChange={(v) => setNewTask({ ...newTask, type: v })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                    <SelectItem value="followup">Follow-up</SelectItem>
                    <SelectItem value="schedule">Schedule</SelectItem>
                    <SelectItem value="coordinate">Coordinate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={newTask.due_date} onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })} className="h-9 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Patient</Label>
                <Select value={newTask.patient_id || ""} onValueChange={(v) => setNewTask({ ...newTask, patient_id: v })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>None</SelectItem>
                    {patients.slice(0, 50).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign Task"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task List */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400 text-sm">No tasks match your filters</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => {
            const isOverdue = task.due_date && task.status === "pending" && isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date));
            return (
              <Card key={task.id} className={`${isOverdue ? "border-l-4 border-l-red-400" : ""}`}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium} >
                          {task.priority === "critical" || task.priority === "high" ? <AlertTriangle className="w-3 h-3 mr-0.5" /> : <Clock className="w-3 h-3 mr-0.5" />}
                          {task.priority}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{task.type}</Badge>
                        {task.status === "completed" && <Badge className="bg-green-100 text-green-700 text-[10px]">Done</Badge>}
                        {isOverdue && <Badge className="bg-red-100 text-red-700 text-[10px]">Overdue</Badge>}
                      </div>
                      <h4 className="font-semibold text-sm text-slate-900">{task.title}</h4>
                      {task.description && <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{task.description}</p>}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {getMemberName(task.assigned_to)}</span>
                        {task.due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(parseISO(task.due_date), "MMM d")}</span>}
                      </div>
                    </div>
                    {task.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => completeMutation.mutate(task.id)} className="flex-shrink-0 h-8 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Done
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}