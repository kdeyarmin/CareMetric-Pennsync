import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";

export default function DashboardCustomizer({ user }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  
  // Default widget configuration
  const defaultWidgets = {
    providerMetrics: true,
    priorityAlerts: true,
    taskList: true,
    complianceScore: true,
    patientAlerts: true,
    clinicalSupport: true,
    training: true,
    coaching: true,
    careGaps: true,
    riskAlerts: true,
    offlineSync: true,
    routeOptimizer: true
  };

  const [widgetConfig, setWidgetConfig] = useState(
    user?.dashboard_config || defaultWidgets
  );

  const saveMutation = useMutation({
    mutationFn: async (config) => {
      await base44.auth.updateMe({
        dashboard_config: config
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['currentUser']);
      toast.success('Dashboard customized');
      setOpen(false);
    }
  });

  const handleSave = () => {
    saveMutation.mutate(widgetConfig);
  };

  const widgets = [
    { key: 'providerMetrics', label: 'Provider-Specific Metrics', description: 'Stats relevant to your role' },
    { key: 'priorityAlerts', label: 'Priority Alerts', description: 'High-priority items for your specialty' },
    { key: 'taskList', label: 'Task Management', description: 'Intelligent task prioritization' },
    { key: 'complianceScore', label: 'Compliance Dashboard', description: 'Your compliance metrics' },
    { key: 'patientAlerts', label: 'Patient Alerts', description: 'Real-time patient notifications' },
    { key: 'clinicalSupport', label: 'Clinical Decision Support', description: 'AI-powered clinical guidance' },
    { key: 'training', label: 'Training Recommendations', description: 'Personalized learning suggestions' },
    { key: 'coaching', label: 'Performance Coaching', description: 'AI coaching insights' },
    { key: 'careGaps', label: 'Care Gap Identifier', description: 'Proactive care gap analysis' },
    { key: 'riskAlerts', label: 'Risk Alerts', description: 'Patient risk stratification' },
    { key: 'offlineSync', label: 'Offline Data Manager', description: 'Offline capabilities' },
    { key: 'routeOptimizer', label: 'Route Optimizer', description: 'Smart visit scheduling' }
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          Customize Dashboard
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize Your Dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-gray-600">
            Choose which widgets to display on your dashboard. Changes apply immediately.
          </p>
          
          <div className="space-y-3">
            {widgets.map((widget) => (
              <Card key={widget.key}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <Label htmlFor={widget.key} className="font-semibold">
                        {widget.label}
                      </Label>
                      <p className="text-sm text-gray-600 mt-1">
                        {widget.description}
                      </p>
                    </div>
                    <Switch
                      id={widget.key}
                      checked={widgetConfig[widget.key]}
                      onCheckedChange={(checked) => 
                        setWidgetConfig({ ...widgetConfig, [widget.key]: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} className="flex-1" disabled={saveMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              Save Preferences
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}