import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  XCircle,
  FileText
} from "lucide-react";
import { format } from "date-fns";

export default function EducationTracker({ patient }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = React.useState(null);
  const [teachBackNotes, setTeachBackNotes] = React.useState({});

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['patientEducation', patient?.id],
    queryFn: () => base44.entities.PatientEducationAssignment.filter({ patient_id: patient?.id }, '-assigned_date'),
    enabled: !!patient?.id,
    initialData: []
  });

  const updateAssignmentMutation = useMutation({
    mutationFn: ({ id, updates }) => base44.entities.PatientEducationAssignment.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientEducation', patient?.id] });
    }
  });

  const handleStatusChange = (assignmentId, newStatus) => {
    const updates = { status: newStatus };
    if (newStatus === 'completed') {
      updates.completed_date = format(new Date(), 'yyyy-MM-dd');
      updates.comprehension_verified = true;
      if (teachBackNotes[assignmentId]) {
        updates.teach_back_notes = teachBackNotes[assignmentId];
      }
    }
    updateAssignmentMutation.mutate({ id: assignmentId, updates });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'in_progress': return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'declined': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return <FileText className="w-4 h-4 text-blue-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'declined': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800",
      medium: "bg-yellow-100 text-yellow-800",
      low: "bg-blue-100 text-blue-800"
    };
    return colors[priority] || "bg-slate-100 text-slate-800";
  };

  const stats = {
    total: assignments.length,
    completed: assignments.filter(a => a.status === 'completed').length,
    inProgress: assignments.filter(a => a.status === 'in_progress').length,
    assigned: assignments.filter(a => a.status === 'assigned').length
  };

  return (
    <Card className="border-2 border-green-300">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-green-600" />
          Patient Education Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs text-blue-600">Total</p>
            <p className="text-xl font-bold text-blue-900">{stats.total}</p>
          </div>
          <div className="text-center p-2 bg-green-50 rounded-lg border border-green-200">
            <p className="text-xs text-green-600">Completed</p>
            <p className="text-xl font-bold text-green-900">{stats.completed}</p>
          </div>
          <div className="text-center p-2 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-xs text-yellow-600">In Progress</p>
            <p className="text-xl font-bold text-yellow-900">{stats.inProgress}</p>
          </div>
          <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-600">Assigned</p>
            <p className="text-xl font-bold text-slate-900">{stats.assigned}</p>
          </div>
        </div>

        {/* Assignments List */}
        {isLoading ? (
          <p className="text-sm text-slate-500 text-center py-4">Loading...</p>
        ) : assignments.length === 0 ? (
          <div className="text-center py-8">
            <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No education assigned yet</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3 pr-4">
              {assignments.map((assignment) => {
                const isExpanded = expandedId === assignment.id;
                
                return (
                  <Card 
                    key={assignment.id}
                    className={`border-l-4 ${
                      assignment.status === 'completed' ? 'border-l-green-500' :
                      assignment.status === 'in_progress' ? 'border-l-yellow-500' :
                      'border-l-blue-500'
                    } cursor-pointer hover:shadow-md transition-shadow`}
                    onClick={() => setExpandedId(isExpanded ? null : assignment.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        {getStatusIcon(assignment.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-semibold text-slate-900">{assignment.topic}</h4>
                            <Badge className={getStatusColor(assignment.status)}>
                              {assignment.status.replace('_', ' ')}
                            </Badge>
                            {assignment.priority && (
                              <Badge className={getPriorityColor(assignment.priority)}>
                                {assignment.priority}
                              </Badge>
                            )}
                          </div>

                          <div className="flex gap-3 text-xs text-slate-500 mb-2">
                            <span>Assigned: {format(new Date(assignment.assigned_date), 'MMM d, yyyy')}</span>
                            {assignment.completed_date && (
                              <span className="text-green-600">
                                Completed: {format(new Date(assignment.completed_date), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="mt-3 space-y-3">
                              <div className="bg-white p-3 rounded border">
                                <p className="text-sm text-slate-700">{assignment.content}</p>
                              </div>

                              {assignment.materials_provided?.length > 0 && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="text-xs font-medium text-green-800 mb-1">Key Points Covered:</p>
                                  <ul className="text-xs text-green-900 space-y-0.5">
                                    {assignment.materials_provided.map((material, i) => (
                                      <li key={i}>✓ {material}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div>
                                <label htmlFor={`update-status-${assignment.id}`} className="text-xs font-medium text-slate-600 block mb-1">
                                  Update Status:
                                </label>
                                <Select
                                  value={assignment.status}
                                  onValueChange={(newStatus) => handleStatusChange(assignment.id, newStatus)}
                                >
                                  <SelectTrigger id={`update-status-${assignment.id}`} className="h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="assigned">Assigned</SelectItem>
                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                    <SelectItem value="declined">Declined</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {assignment.status !== 'completed' && (
                                <div>
                                  <label htmlFor={`teach-back-notes-${assignment.id}`} className="text-xs font-medium text-slate-600 block mb-1">
                                    Teach-Back Notes (optional):
                                  </label>
                                  <Textarea
                                    id={`teach-back-notes-${assignment.id}`}
                                    placeholder="Document patient's understanding..."
                                    value={teachBackNotes[assignment.id] || ''}
                                    onChange={(e) => setTeachBackNotes(prev => ({
                                      ...prev,
                                      [assignment.id]: e.target.value
                                    }))}
                                    className="h-16 text-sm"
                                  />
                                </div>
                              )}

                              {assignment.teach_back_notes && (
                                <div className="bg-blue-50 p-2 rounded border border-blue-200">
                                  <p className="text-xs font-medium text-blue-800 mb-1">Teach-Back Verification:</p>
                                  <p className="text-xs text-blue-900">{assignment.teach_back_notes}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}