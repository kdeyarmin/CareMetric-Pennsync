import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Trash2, Database, RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { formatEastern } from "../utils/timezone";

export default function BIToolIntegration() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    bi_tool: "tableau",
    connection_type: "export",
    config: {
      api_key: "",
      endpoint_url: "",
      export_path: ""
    },
    data_sources: ["patients"],
    sync_schedule: {
      frequency: "daily",
      time: "02:00"
    },
    is_active: true
  });

  const queryClient = useQueryClient();

  const { data: integrations = [] } = useQuery({
    queryKey: ['biIntegrations'],
    queryFn: () => base44.entities.BIIntegration.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.BIIntegration.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biIntegrations'] });
      setShowDialog(false);
      resetForm();
      toast.success("Integration created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BIIntegration.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biIntegrations'] });
      setShowDialog(false);
      resetForm();
      toast.success("Integration updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.BIIntegration.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biIntegrations'] });
      toast.success("Integration deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      bi_tool: "tableau",
      connection_type: "export",
      config: {
        api_key: "",
        endpoint_url: "",
        export_path: ""
      },
      data_sources: ["patients"],
      sync_schedule: {
        frequency: "daily",
        time: "02:00"
      },
      is_active: true
    });
    setEditingIntegration(null);
  };

  const handleEdit = (integration) => {
    setEditingIntegration(integration);
    setFormData(integration);
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingIntegration) {
      updateMutation.mutate({ id: editingIntegration.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleDataSource = (source) => {
    const current = formData.data_sources || [];
    if (current.includes(source)) {
      setFormData({
        ...formData,
        data_sources: current.filter(s => s !== source)
      });
    } else {
      setFormData({
        ...formData,
        data_sources: [...current, source]
      });
    }
  };

  const biToolLogos = {
    tableau: "📊",
    powerbi: "📈",
    looker: "🔍",
    metabase: "📉",
    superset: "📐",
    custom: "🔧"
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">BI Tool Integrations</h2>
          <p className="text-gray-600">Connect to external Business Intelligence platforms</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New Integration
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingIntegration ? 'Edit Integration' : 'Create New Integration'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Integration Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>BI Tool</Label>
                  <Select value={formData.bi_tool} onValueChange={(v) => setFormData({ ...formData, bi_tool: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tableau">Tableau</SelectItem>
                      <SelectItem value="powerbi">Power BI</SelectItem>
                      <SelectItem value="looker">Looker</SelectItem>
                      <SelectItem value="metabase">Metabase</SelectItem>
                      <SelectItem value="superset">Apache Superset</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Connection Type</Label>
                  <Select value={formData.connection_type} onValueChange={(v) => setFormData({ ...formData, connection_type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                      <SelectItem value="export">File Export</SelectItem>
                      <SelectItem value="database">Direct Database</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-base mb-3 block">Connection Configuration</Label>
                {(formData.connection_type === 'api' || formData.connection_type === 'webhook') && (
                  <>
                    <div className="mb-3">
                      <Label className="text-xs">API Key / Token</Label>
                      <Input
                        type="password"
                        value={formData.config.api_key}
                        onChange={(e) => setFormData({
                          ...formData,
                          config: { ...formData.config, api_key: e.target.value }
                        })}
                        placeholder="Enter API key"
                      />
                    </div>
                    <div className="mb-3">
                      <Label className="text-xs">Endpoint URL</Label>
                      <Input
                        value={formData.config.endpoint_url}
                        onChange={(e) => setFormData({
                          ...formData,
                          config: { ...formData.config, endpoint_url: e.target.value }
                        })}
                        placeholder="https://api.example.com/data"
                      />
                    </div>
                  </>
                )}
                {formData.connection_type === 'export' && (
                  <div className="mb-3">
                    <Label className="text-xs">Export Path</Label>
                    <Input
                      value={formData.config.export_path}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: { ...formData.config, export_path: e.target.value }
                      })}
                      placeholder="/exports/bi-data"
                    />
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <Label className="text-base mb-3 block">Data Sources</Label>
                <div className="space-y-2">
                  {['patients', 'visits', 'care_plans', 'incidents', 'compliance', 'training', 'outcomes'].map(source => (
                    <div key={source} className="flex items-center space-x-2">
                      <Checkbox
                        id={source}
                        checked={formData.data_sources?.includes(source)}
                        onCheckedChange={() => toggleDataSource(source)}
                      />
                      <label
                        htmlFor={source}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                      >
                        {source.replace('_', ' ')}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-base mb-3 block">Sync Schedule</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Frequency</Label>
                    <Select
                      value={formData.sync_schedule.frequency}
                      onValueChange={(v) => setFormData({
                        ...formData,
                        sync_schedule: { ...formData.sync_schedule, frequency: v }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="realtime">Real-time</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.sync_schedule.frequency !== 'realtime' && (
                    <div>
                      <Label className="text-xs">Time</Label>
                      <Input
                        type="time"
                        value={formData.sync_schedule.time}
                        onChange={(e) => setFormData({
                          ...formData,
                          sync_schedule: { ...formData.sync_schedule, time: e.target.value }
                        })}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingIntegration ? 'Update' : 'Create'} Integration
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl">{biToolLogos[integration.bi_tool]}</span>
                    <div>
                      <h3 className="text-lg font-bold">{integration.name}</h3>
                      <Badge variant={integration.is_active ? "default" : "secondary"} className="mt-1">
                        {integration.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      <span>{integration.bi_tool} • {integration.connection_type}</span>
                    </div>
                    <div>
                      <span className="font-medium">{integration.data_sources?.length || 0} data sources</span>
                      <div className="text-xs text-gray-500 mt-1">
                        {integration.data_sources?.join(', ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      <span>Sync: {integration.sync_schedule?.frequency}</span>
                    </div>
                    {integration.last_sync && (
                      <div className="flex items-center gap-2">
                        {integration.sync_status === 'active' ? (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-600" />
                        )}
                        <span>Last sync: {formatEastern(new Date(integration.last_sync), 'MMM d, h:mm a')}</span>
                      </div>
                    )}
                    {integration.records_synced > 0 && (
                      <div className="text-xs">
                        {integration.records_synced.toLocaleString()} records synced
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(integration)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Delete this integration?')) {
                        deleteMutation.mutate(integration.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {integrations.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No integrations yet</h3>
            <p className="text-gray-600 mb-4">Connect to Tableau, Power BI, or other BI tools to export your data</p>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Integration
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}