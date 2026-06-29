import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function FaxRetrySettings() {
  const queryClient = useQueryClient();

  const { data: configs = [] } = useQuery({
    queryKey: ['fax-retry-config'],
    queryFn: () => base44.entities.FaxRetryConfig.list('-created_date', 1),
    initialData: []
  });

  const config = configs[0] || null;

  const [formData, setFormData] = useState({
    max_retries: config?.max_retries || 3,
    retry_delay_minutes: config?.retry_delay_minutes || 15,
    auto_retry_enabled: config?.auto_retry_enabled ?? true,
    notify_on_final_failure: config?.notify_on_final_failure ?? true,
    priority_multiplier: config?.priority_multiplier || {
      urgent: 0.5,
      high: 1,
      normal: 1,
      low: 2
    }
  });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (config) {
        return base44.entities.FaxRetryConfig.update(config.id, data);
      }
      return base44.entities.FaxRetryConfig.create({ ...data, is_active: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-retry-config'] });
      toast.success("Retry settings saved");
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  React.useEffect(() => {
    if (config) {
      setFormData({
        max_retries: config.max_retries || 3,
        retry_delay_minutes: config.retry_delay_minutes || 15,
        auto_retry_enabled: config.auto_retry_enabled ?? true,
        notify_on_final_failure: config.notify_on_final_failure ?? true,
        priority_multiplier: config.priority_multiplier || {
          urgent: 0.5,
          high: 1,
          normal: 1,
          low: 2
        }
      });
    }
  }, [config]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          Automatic Retry Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Auto Retry Toggle */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex-1">
              <Label className="text-base font-semibold">Enable Automatic Retry</Label>
              <p className="text-sm text-slate-600 mt-1">
                Automatically retry failed faxes based on configuration
              </p>
            </div>
            <Switch
              checked={formData.auto_retry_enabled}
              onCheckedChange={(checked) => 
                setFormData({ ...formData, auto_retry_enabled: checked })
              }
            />
          </div>

          {/* Basic Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Maximum Retries</Label>
              <Input
                type="number"
                min="1"
                max="10"
                value={formData.max_retries}
                onChange={(e) => 
                  setFormData({ ...formData, max_retries: parseInt(e.target.value) })
                }
              />
              <p className="text-xs text-slate-500">
                Number of retry attempts before giving up
              </p>
            </div>

            <div className="space-y-2">
              <Label>Retry Delay (minutes)</Label>
              <Input
                type="number"
                min="5"
                max="120"
                value={formData.retry_delay_minutes}
                onChange={(e) => 
                  setFormData({ ...formData, retry_delay_minutes: parseInt(e.target.value) })
                }
              />
              <p className="text-xs text-slate-500">
                Base delay between retry attempts
              </p>
            </div>
          </div>

          {/* Priority Multipliers */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Priority Delay Multipliers</Label>
            <p className="text-sm text-slate-600">
              Adjust retry delays based on fax priority (1.0 = normal delay)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-red-600">Urgent (faster)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={formData.priority_multiplier.urgent}
                  onChange={(e) => 
                    setFormData({
                      ...formData,
                      priority_multiplier: {
                        ...formData.priority_multiplier,
                        urgent: parseFloat(e.target.value)
                      }
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-orange-600">High</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={formData.priority_multiplier.high}
                  onChange={(e) => 
                    setFormData({
                      ...formData,
                      priority_multiplier: {
                        ...formData.priority_multiplier,
                        high: parseFloat(e.target.value)
                      }
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-blue-600">Normal</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={formData.priority_multiplier.normal}
                  onChange={(e) => 
                    setFormData({
                      ...formData,
                      priority_multiplier: {
                        ...formData.priority_multiplier,
                        normal: parseFloat(e.target.value)
                      }
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">Low (slower)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={formData.priority_multiplier.low}
                  onChange={(e) => 
                    setFormData({
                      ...formData,
                      priority_multiplier: {
                        ...formData.priority_multiplier,
                        low: parseFloat(e.target.value)
                      }
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex-1">
              <Label className="text-sm font-semibold">Notify on Final Failure</Label>
              <p className="text-xs text-slate-600 mt-1">
                Send email when all retry attempts are exhausted
              </p>
            </div>
            <Switch
              checked={formData.notify_on_final_failure}
              onCheckedChange={(checked) => 
                setFormData({ ...formData, notify_on_final_failure: checked })
              }
            />
          </div>

          {/* Info Alert */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold mb-1">How it works:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Failed faxes are automatically retried after the configured delay</li>
                <li>Priority multipliers adjust delays (e.g., 0.5 = half delay for urgent)</li>
                <li>After max retries, sender receives notification</li>
                <li>Webhooks trigger real-time retry processing</li>
              </ul>
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full"
            disabled={saveMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            Save Configuration
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}