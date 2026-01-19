import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { AlertCircle, TrendingUp, Zap, CheckCircle } from "lucide-react";

export default function DocumentAutomationDashboard() {
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["automationWorkflows"],
    queryFn: () => base44.entities.DocumentAutomationWorkflow.list("-created_date"),
  });

  // Calculate metrics
  const totalWorkflows = workflows.length;
  const activeWorkflows = workflows.filter((w) => w.is_active).length;
  const totalTriggered = workflows.reduce((sum, w) => sum + (w.trigger_count || 0), 0);
  const workflowsWithErrors = workflows.filter((w) => w.error_log?.length > 0).length;

  // Chart data
  const triggerData = workflows.map((w) => ({
    name: w.workflow_name.substring(0, 15),
    triggers: w.trigger_count || 0,
    errors: w.error_log?.length || 0,
  }));

  const errorRateData = workflows
    .filter((w) => w.trigger_count > 0)
    .map((w) => ({
      name: w.workflow_name.substring(0, 15),
      error_rate: w.error_log?.length
        ? ((w.error_log.length / w.trigger_count) * 100).toFixed(1)
        : 0,
    }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">{totalWorkflows}</div>
              <p className="text-sm text-gray-600 mt-1">Total Workflows</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{activeWorkflows}</div>
              <p className="text-sm text-gray-600 mt-1">Active</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600">{totalTriggered}</div>
              <p className="text-sm text-gray-600 mt-1">Total Triggers</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600">{workflowsWithErrors}</div>
              <p className="text-sm text-gray-600 mt-1">With Errors</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow Triggers</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={triggerData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="triggers" fill="#3b82f6" />
                <Bar dataKey="errors" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Error Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={errorRateData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip formatter={(value) => `${value}%`} />
                <Line type="monotone" dataKey="error_rate" stroke="#ef4444" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Workflow Status</h3>
        <div className="grid gap-4">
          {workflows.map((workflow) => (
            <Card key={workflow.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold">{workflow.workflow_name}</h4>
                      <Badge
                        className={
                          workflow.is_active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }
                      >
                        {workflow.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Zap className="w-4 h-4 text-blue-500" />
                        <span>{workflow.trigger_count || 0} triggers</span>
                      </div>

                      {workflow.error_log?.length > 0 && (
                        <div className="flex items-center gap-1 text-red-600">
                          <AlertCircle className="w-4 h-4" />
                          <span>{workflow.error_log.length} errors</span>
                        </div>
                      )}

                      {workflow.last_triggered && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <CheckCircle className="w-4 h-4" />
                          <span>
                            Last:{" "}
                            {new Date(workflow.last_triggered).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {workflow.error_log?.length > 0 && selectedWorkflow === workflow.id && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-red-600">
                          Recent Errors:
                        </p>
                        {workflow.error_log.slice(-3).map((error, idx) => (
                          <div
                            key={idx}
                            className="text-xs bg-red-50 p-2 rounded border border-red-200"
                          >
                            <p className="font-mono text-red-700">
                              {error.error_message}
                            </p>
                            <p className="text-red-500 text-xs mt-1">
                              {new Date(error.timestamp).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelectedWorkflow(
                        selectedWorkflow === workflow.id ? null : workflow.id
                      )
                    }
                  >
                    {selectedWorkflow === workflow.id ? "Hide" : "Details"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}