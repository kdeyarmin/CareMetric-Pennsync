import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell, Plus, Trash2, AlertCircle } from "lucide-react";

export default function RiskAlertConfiguration({ patientId }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newAlert, setNewAlert] = useState({
    risk_category: 'overall',
    threshold_score: 70,
    alert_on_increase: true,
    alert_on_decrease: false,
    notification_method: 'in_app'
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['riskAlerts', patientId, currentUser?.email],
    queryFn: () => base44.entities.RiskAlert.filter({ 
      patient_id: patientId,
      nurse_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
  });

  const createAlert = useMutation({
    mutationFn: (alertData) => base44.entities.RiskAlert.create({
      ...alertData,
      patient_id: patientId,
      nurse_email: currentUser.email
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskAlerts'] });
      setShowForm(false);
      setNewAlert({
        risk_category: 'overall',
        threshold_score: 70,
        alert_on_increase: true,
        alert_on_decrease: false,
        notification_method: 'in_app'
      });
    }
  });

  const deleteAlert = useMutation({
    mutationFn: (alertId) => base44.entities.RiskAlert.delete(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskAlerts'] });
    }
  });

  const toggleAlert = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.RiskAlert.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskAlerts'] });
    }
  });

  const getRiskCategoryLabel = (category) => {
    const labels = {
      overall: 'Overall Risk',
      hospitalization: 'Hospitalization Risk',
      fall: 'Fall Risk',
      readmission: 'Readmission Risk'
    };
    return labels[category] || category;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-600" />
            Risk Alerts
          </CardTitle>
          <Button onClick={() => setShowForm(!showForm)} size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            New Alert
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="bg-blue-50 rounded-lg p-4 space-y-3 border border-blue-200">
            <h4 className="font-semibold text-sm">Configure New Alert</h4>
            
            <div className="space-y-2">
              <Label>Risk Category</Label>
              <Select
                value={newAlert.risk_category}
                onValueChange={(value) => setNewAlert({ ...newAlert, risk_category: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overall">Overall Risk</SelectItem>
                  <SelectItem value="hospitalization">Hospitalization Risk</SelectItem>
                  <SelectItem value="fall">Fall Risk</SelectItem>
                  <SelectItem value="readmission">Readmission Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Alert When Score Exceeds</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={newAlert.threshold_score}
                onChange={(e) => setNewAlert({ ...newAlert, threshold_score: parseInt(e.target.value) })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Alert on Score Increase</Label>
              <Switch
                checked={newAlert.alert_on_increase}
                onCheckedChange={(checked) => setNewAlert({ ...newAlert, alert_on_increase: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Alert on Score Decrease</Label>
              <Switch
                checked={newAlert.alert_on_decrease}
                onCheckedChange={(checked) => setNewAlert({ ...newAlert, alert_on_decrease: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>Notification Method</Label>
              <Select
                value={newAlert.notification_method}
                onValueChange={(value) => setNewAlert({ ...newAlert, notification_method: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_app">In-App Only</SelectItem>
                  <SelectItem value="email">Email Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => createAlert.mutate(newAlert)} className="flex-1">
                Create Alert
              </Button>
              <Button onClick={() => setShowForm(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Bell className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm">No risk alerts configured</p>
            <p className="text-xs mt-1">Set up alerts to be notified of critical changes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">
                      {getRiskCategoryLabel(alert.risk_category)}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      Threshold: {alert.threshold_score}
                    </Badge>
                    {!alert.is_active && (
                      <Badge className="bg-gray-300 text-gray-700 text-xs">Paused</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">
                    {alert.alert_on_increase && 'Alert on increase'}
                    {alert.alert_on_increase && alert.alert_on_decrease && ' • '}
                    {alert.alert_on_decrease && 'Alert on decrease'}
                    {' • '}
                    {alert.notification_method}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={alert.is_active}
                    onCheckedChange={(checked) => toggleAlert.mutate({ id: alert.id, is_active: checked })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteAlert.mutate(alert.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
            <div className="text-xs text-yellow-900">
              <p className="font-medium mb-1">Alert Tips:</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Set threshold around 70-80 for critical alerts</li>
                <li>Enable both increase/decrease to track improvements</li>
                <li>Run risk analysis regularly to trigger alerts</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}