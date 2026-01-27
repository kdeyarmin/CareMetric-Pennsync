import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Plus, Archive, AlertCircle, CheckCircle2, Calendar, Loader2 } from 'lucide-react';

export default function DataArchivalManagement() {
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [formData, setFormData] = useState({
    policy_name: '',
    entity_type: '',
    retention_days: 90,
    is_automatic: false,
    schedule: 'weekly'
  });
  const queryClient = useQueryClient();

  // Fetch archival policies
  const { data: policies, isLoading: policiesLoading } = useQuery({
    queryKey: ['archivalPolicies'],
    queryFn: () => base44.entities.DataArchivePolicy.list()
  });

  // Fetch archived records count
  const { data: archivedRecords } = useQuery({
    queryKey: ['archivedRecords'],
    queryFn: () => base44.entities.ArchivedRecord.filter({ status: 'archived' })
  });

  // Create policy mutation
  const createPolicyMutation = useMutation({
    mutationFn: (data) => base44.entities.DataArchivePolicy.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archivalPolicies'] });
      toast.success('Policy created successfully');
      setShowCreatePolicy(false);
      setFormData({ policy_name: '', entity_type: '', retention_days: 90, is_automatic: false, schedule: 'weekly' });
    },
    onError: (error) => {
      toast.error(`Failed to create policy: ${error.message}`);
    }
  });

  // Execute archival mutation
  const executeMutation = useMutation({
    mutationFn: (policyId) => base44.functions.invoke('executeDataArchival', { policy_id: policyId, manual: true }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['archivalPolicies'] });
      queryClient.invalidateQueries({ queryKey: ['archivedRecords'] });
      toast.success(`Successfully archived ${response.data.archived_count} records`);
    },
    onError: (error) => {
      toast.error(`Archival failed: ${error.message}`);
    }
  });

  // Toggle policy mutation
  const togglePolicyMutation = useMutation({
    mutationFn: (policy) => base44.entities.DataArchivePolicy.update(policy.id, { is_active: !policy.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archivalPolicies'] });
      toast.success('Policy updated');
    }
  });

  const handleCreatePolicy = async () => {
    if (!formData.policy_name || !formData.entity_type) {
      toast.error('Fill in all required fields');
      return;
    }
    createPolicyMutation.mutate(formData);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Data Archival Management</h1>
            <p className="text-gray-600 mt-2">Configure retention and archival policies</p>
          </div>
          <Dialog open={showCreatePolicy} onOpenChange={setShowCreatePolicy}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Policy
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Archival Policy</DialogTitle>
                <DialogDescription>Set up automatic or manual data archival</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="policy_name">Policy Name</Label>
                  <Input
                    id="policy_name"
                    placeholder="e.g., Archive Old Visits"
                    value={formData.policy_name}
                    onChange={(e) => setFormData({ ...formData, policy_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="entity_type">Entity Type</Label>
                  <Select value={formData.entity_type} onValueChange={(value) => setFormData({ ...formData, entity_type: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select entity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Visit">Visit</SelectItem>
                      <SelectItem value="Note">Note</SelectItem>
                      <SelectItem value="PatientEducationAssignment">Education Assignment</SelectItem>
                      <SelectItem value="ComplianceViolation">Compliance Violation</SelectItem>
                      <SelectItem value="Task">Task</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="retention_days">Retention Days</Label>
                  <Input
                    id="retention_days"
                    type="number"
                    value={formData.retention_days}
                    onChange={(e) => setFormData({ ...formData, retention_days: parseInt(e.target.value) })}
                    min="30"
                    max="2555"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_automatic"
                    checked={formData.is_automatic}
                    onChange={(e) => setFormData({ ...formData, is_automatic: e.target.checked })}
                  />
                  <Label htmlFor="is_automatic" className="cursor-pointer">Enable Automatic Archival</Label>
                </div>
                {formData.is_automatic && (
                  <div>
                    <Label htmlFor="schedule">Schedule</Label>
                    <Select value={formData.schedule} onValueChange={(value) => setFormData({ ...formData, schedule: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={handleCreatePolicy} disabled={createPolicyMutation.isPending} className="w-full">
                  {createPolicyMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Create Policy
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Active Policies</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{policies?.filter(p => p.is_active).length || 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Archived Records</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{archivedRecords?.length || 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Total Archived</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{policies?.reduce((sum, p) => sum + (p.records_archived || 0), 0) || 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Policies List */}
        <Card>
          <CardHeader>
            <CardTitle>Archival Policies</CardTitle>
            <CardDescription>Manage data retention and archival schedules</CardDescription>
          </CardHeader>
          <CardContent>
            {policiesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : policies?.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>No policies configured. Create one to get started.</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {policies.map((policy) => (
                  <div key={policy.id} className="border rounded-lg p-4 hover:bg-gray-50 transition">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg">{policy.policy_name}</h3>
                          <Badge variant={policy.is_active ? 'default' : 'secondary'}>
                            {policy.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          {policy.is_automatic && <Badge variant="outline">Automatic</Badge>}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          Entity: <strong>{policy.entity_type}</strong> • Retention: <strong>{policy.retention_days} days</strong>
                        </p>
                        {policy.is_automatic && (
                          <p className="text-sm text-gray-600 flex items-center gap-2 mb-2">
                            <Calendar className="w-4 h-4" />
                            Runs <strong>{policy.schedule}</strong>
                            {policy.last_run && ` • Last run: ${new Date(policy.last_run).toLocaleDateString()}`}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          Total archived: {policy.records_archived || 0} records
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => togglePolicyMutation.mutate(policy)}
                        >
                          {policy.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => executeMutation.mutate(policy.id)}
                          disabled={executeMutation.isPending}
                        >
                          {executeMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Archive className="w-4 h-4" />
                          )}
                          Archive Now
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}