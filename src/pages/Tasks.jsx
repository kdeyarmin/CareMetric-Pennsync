import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Plus, CheckCircle2, Clock, AlertTriangle, Filter, 
  Repeat, Bell, Search, Calendar, X
} from "lucide-react";
import { format, parseISO, isPast, isToday, isFuture } from "date-fns";
import { todayEastern } from "../components/utils/timezone";
import TaskNotifications from "../components/tasks/TaskNotifications";
import RecurringTaskManager from "../components/tasks/RecurringTaskManager";

export default function Tasks() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showRecurringSettings, setShowRecurringSettings] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("pending");
  const queryClient = useQueryClient();

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    type: "other",
    priority: "medium",
    status: "pending",
    due_date: todayEastern(),
    due_time: "",
    notification_preferences: {
      enabled: true,
      notify_before_hours: 24,
      notify_on_overdue: true
    }
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['allTasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({ assigned_to: currentUser?.email }, '-created_date'),
    enabled: !!currentUser?.email,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100),
  });

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => base44.entities.Task.create({
      ...taskData,
      assigned_to: currentUser?.email
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
      setShowForm(false);
      setNewTask({
        title: "",
        description: "",
        type: "other",
        priority: "medium",
        status: "pending",
        due_date: todayEastern(),
        due_time: "",
        notification_preferences: {
          enabled: true,
          notify_before_hours: 24,
          notify_on_overdue: true
        }
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
      setEditingTask(null);
      setShowForm(false);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => base44.entities.Task.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
    },
  });

  const handleSubmit = () => {
    if (editingTask) {
      updateTaskMutation.mutate({ id: editingTask.id, data: newTask });
    } else {
      createTaskMutation.mutate(newTask);
    }
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setNewTask(task);
    setShowForm(true);
  };

  const handleComplete = (task) => {
    updateTaskMutation.mutate({ 
      id: task.id, 
      data: { 
        status: 'completed',
        completion_notes: 'Marked complete'
      }
    });
  };

  const handleRecurringSave = (recurringSettings) => {
    const taskData = { ...newTask, ...recurringSettings };
    if (editingTask) {
      updateTaskMutation.mutate({ id: editingTask.id, data: taskData });
    } else {
      createTaskMutation.mutate(taskData);
    }
    setShowRecurringSettings(false);
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         task.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    return matchesSearch && matchesPriority && matchesStatus;
  });

  const categorizedTasks = {
    overdue: filteredTasks.filter(t => t.due_date && isPast(parseISO(t.due_date)) && !isToday(parseISO(t.due_date)) && t.status === 'pending'),
    today: filteredTasks.filter(t => t.due_date && isToday(parseISO(t.due_date)) && t.status === 'pending'),
    upcoming: filteredTasks.filter(t => t.due_date && isFuture(parseISO(t.due_date)) && !isToday(parseISO(t.due_date)) && t.status === 'pending'),
    noDueDate: filteredTasks.filter(t => !t.due_date && t.status === 'pending'),
    completed: filteredTasks.filter(t => t.status === 'completed'),
  };

  const getPriorityColor = (priority) => {
    const colors = {
      critical: "bg-red-600 text-white",
      high: "bg-orange-500 text-white",
      medium: "bg-yellow-500 text-white",
      low: "bg-blue-500 text-white"
    };
    return colors[priority] || colors.medium;
  };

  const getPriorityIcon = (priority) => {
    if (priority === 'critical' || priority === 'high') {
      return <AlertTriangle className="w-4 h-4" />;
    }
    return <Clock className="w-4 h-4" />;
  };

  const TaskCard = ({ task, category }) => (
    <Card className={`${category === 'overdue' ? 'border-red-300 bg-red-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge className={getPriorityColor(task.priority)}>
                {getPriorityIcon(task.priority)}
                <span className="ml-1">{task.priority}</span>
              </Badge>
              {task.is_recurring && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                  <Repeat className="w-3 h-3 mr-1" />
                  {task.recurrence_type}
                </Badge>
              )}
              <Badge variant="outline">{task.type}</Badge>
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{task.title}</h3>
            {task.description && (
              <p className="text-sm text-gray-600 mb-2">{task.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {task.due_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {format(parseISO(task.due_date), 'MMM d, yyyy')}
                  {task.due_time && ` at ${task.due_time}`}
                </span>
              )}
              {task.notification_preferences?.enabled && (
                <span className="flex items-center gap-1">
                  <Bell className="w-3 h-3" />
                  Notifications on
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {task.status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleComplete(task)}
                className="h-8"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Complete
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleEdit(task)}
              className="h-8"
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => deleteTaskMutation.mutate(task.id)}
              className="h-8 text-red-600 hover:text-red-700"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">My Tasks</h1>
        <Button
          onClick={() => {
            setShowForm(true);
            setEditingTask(null);
            setNewTask({
              title: "",
              description: "",
              type: "other",
              priority: "medium",
              status: "pending",
              due_date: todayEastern(),
              due_time: "",
              notification_preferences: {
                enabled: true,
                notify_before_hours: 24,
                notify_on_overdue: true
              }
            });
          }}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </div>

      <TaskNotifications userEmail={currentUser?.email} compact={true} />

      {(showForm || showRecurringSettings) && (
        <Card className="mb-6 border-indigo-300 bg-indigo-50">
          <CardHeader>
            <CardTitle>{editingTask ? 'Edit Task' : 'Create New Task'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showRecurringSettings ? (
              <>
                <div>
                  <Label>Title *</Label>
                  <Input
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    placeholder="Task title"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                    placeholder="Task details"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Priority *</Label>
                    <Select
                      value={newTask.priority}
                      onValueChange={(value) => setNewTask({...newTask, priority: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select
                      value={newTask.type}
                      onValueChange={(value) => setNewTask({...newTask, type: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="call">Call</SelectItem>
                        <SelectItem value="notify">Notify</SelectItem>
                        <SelectItem value="schedule">Schedule</SelectItem>
                        <SelectItem value="document">Document</SelectItem>
                        <SelectItem value="followup">Follow-up</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Due Date</Label>
                    <Input
                      type="date"
                      value={newTask.due_date}
                      onChange={(e) => setNewTask({...newTask, due_date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Due Time</Label>
                    <Input
                      type="time"
                      value={newTask.due_time}
                      onChange={(e) => setNewTask({...newTask, due_time: e.target.value})}
                    />
                  </div>
                </div>
                <div>
                  <Label>Patient (optional)</Label>
                  <Select
                    value={newTask.patient_id || ""}
                    onValueChange={(value) => setNewTask({...newTask, patient_id: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select patient" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>No patient</SelectItem>
                      {patients.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.first_name} {p.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-between pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowRecurringSettings(true)}
                  >
                    <Repeat className="w-4 h-4 mr-2" />
                    Recurring Settings
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowForm(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSubmit} className="bg-indigo-600 hover:bg-indigo-700">
                      {editingTask ? 'Update' : 'Create'} Task
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <RecurringTaskManager
                task={newTask}
                onSave={handleRecurringSave}
                onCancel={() => setShowRecurringSettings(false)}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32">
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
      </div>

      <Tabs defaultValue="overdue" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overdue" className="relative">
            Overdue
            {categorizedTasks.overdue.length > 0 && (
              <Badge className="ml-2 bg-red-600 text-white">{categorizedTasks.overdue.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="today" className="relative">
            Today
            {categorizedTasks.today.length > 0 && (
              <Badge className="ml-2">{categorizedTasks.today.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            Upcoming
            {categorizedTasks.upcoming.length > 0 && (
              <Badge className="ml-2">{categorizedTasks.upcoming.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="noDueDate">No Due Date</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="overdue" className="space-y-3">
          {categorizedTasks.overdue.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No overdue tasks
              </CardContent>
            </Card>
          ) : (
            categorizedTasks.overdue.map(task => (
              <TaskCard key={task.id} task={task} category="overdue" />
            ))
          )}
        </TabsContent>

        <TabsContent value="today" className="space-y-3">
          {categorizedTasks.today.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No tasks due today
              </CardContent>
            </Card>
          ) : (
            categorizedTasks.today.map(task => (
              <TaskCard key={task.id} task={task} category="today" />
            ))
          )}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-3">
          {categorizedTasks.upcoming.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No upcoming tasks
              </CardContent>
            </Card>
          ) : (
            categorizedTasks.upcoming.map(task => (
              <TaskCard key={task.id} task={task} category="upcoming" />
            ))
          )}
        </TabsContent>

        <TabsContent value="noDueDate" className="space-y-3">
          {categorizedTasks.noDueDate.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No tasks without due dates
              </CardContent>
            </Card>
          ) : (
            categorizedTasks.noDueDate.map(task => (
              <TaskCard key={task.id} task={task} category="noDueDate" />
            ))
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-3">
          {categorizedTasks.completed.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No completed tasks
              </CardContent>
            </Card>
          ) : (
            categorizedTasks.completed.map(task => (
              <TaskCard key={task.id} task={task} category="completed" />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}