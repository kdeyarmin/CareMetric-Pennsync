import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, AlertCircle, PlayCircle } from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function WorkflowExecutionMonitor() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: executions = [] } = useQuery({
    queryKey: ['workflowExecutions'],
    queryFn: () => base44.entities.WorkflowExecution.list('-created_date', 100)
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
      case 'approved':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'rejected':
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'in_progress':
        return <PlayCircle className="w-5 h-5 text-blue-600" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      in_progress: "bg-blue-100 text-blue-800",
      approved: "bg-green-100 text-green-800",
      completed: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      cancelled: "bg-gray-100 text-gray-800"
    };
    return colors[status] || colors.pending;
  };

  const filteredExecutions = executions.filter(exec => {
    const matchesStatus = statusFilter === 'all' || exec.status === statusFilter;
    const matchesSearch = !searchTerm || 
      exec.workflow_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exec.triggered_by.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Workflow Execution Monitor</h2>
        <p className="text-gray-600">Track the status and history of workflow executions</p>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Input
          placeholder="Search by workflow name or user..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-md"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Execution List */}
      <div className="space-y-3">
        {filteredExecutions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No workflow executions found</p>
            </CardContent>
          </Card>
        ) : (
          filteredExecutions.map((exec) => (
            <Card key={exec.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex gap-4 flex-1">
                    <div className="mt-1">
                      {getStatusIcon(exec.status)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold">{exec.workflow_name}</h3>
                        <Badge className={getStatusColor(exec.status)}>
                          {exec.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <div className="flex gap-4">
                          <span>Triggered by: {exec.triggered_by}</span>
                          <span>•</span>
                          <span>Event: {exec.trigger_event.replace('_', ' ')}</span>
                        </div>
                        <div>
                          Started: {formatEastern(new Date(exec.created_date), 'MMM d, yyyy h:mm a')}
                        </div>
                        {exec.completion_date && (
                          <div>
                            Completed: {formatEastern(new Date(exec.completion_date), 'MMM d, yyyy h:mm a')}
                          </div>
                        )}
                        {exec.step_history && exec.step_history.length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs font-medium text-gray-700 mb-2">Step History:</p>
                            <div className="space-y-1">
                              {exec.step_history.map((step, idx) => (
                                <div key={idx} className="text-xs flex items-center gap-2">
                                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                                  <span>{step.step_name}</span>
                                  <span className="text-gray-400">•</span>
                                  <span>{step.actor}</span>
                                  <span className="text-gray-400">•</span>
                                  <span>{formatEastern(new Date(step.timestamp), 'MMM d, h:mm a')}</span>
                                  {step.notes && (
                                    <>
                                      <span className="text-gray-400">•</span>
                                      <span className="italic">{step.notes}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {exec.rejection_reason && (
                          <div className="mt-2 text-red-600">
                            Rejection reason: {exec.rejection_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}