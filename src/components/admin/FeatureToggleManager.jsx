import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';

const AVAILABLE_FEATURES = [
  'Smart Notes Assistant',
  'Visit Scribe',
  'Care Plan Management',
  'Document Generation & Template Library',
  'OASIS & Compliance',
  'Analytics Dashboard',
  'Training & Development',
  'Task Management',
  'Telehealth',
  'Document Analyzer',
  'ICD-10 Code Suggestions',
  'Readmission Risk Prediction',
  'Patient Risk Alerts',
  'Clinical Decision Support',
  'Billing Optimization'
];

export default function FeatureToggleManager() {
  const [newFeature, setNewFeature] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [newTeam, setNewTeam] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  const queryClient = useQueryClient();

  const { data: toggles = [], isLoading } = useQuery({
    queryKey: ['featureToggles'],
    queryFn: () => base44.entities.FeatureToggle.list('-created_date')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FeatureToggle.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['featureToggles'] });
      setNewFeature('');
      setNewRole('user');
      setNewTeam('');
      toast.success('Feature toggle created');
    },
    onError: (error) => toast.error(error.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, enabled, description }) =>
      base44.entities.FeatureToggle.update(id, { enabled, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['featureToggles'] });
      toast.success('Feature toggle updated');
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FeatureToggle.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['featureToggles'] });
      toast.success('Feature toggle deleted');
    },
    onError: (error) => toast.error(error.message)
  });

  const handleAddToggle = (e) => {
    e.preventDefault();
    if (!newFeature) {
      toast.error('Please select a feature');
      return;
    }

    createMutation.mutate({
      feature_name: newFeature,
      role: newRole,
      team_name: newTeam || null,
      enabled: true
    });
  };

  const filteredToggles = filterRole === 'all' 
    ? toggles 
    : toggles.filter(t => t.role === filterRole);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create New Feature Toggle</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddToggle} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Select value={newFeature} onValueChange={setNewFeature}>
                <SelectTrigger>
                  <SelectValue placeholder="Select feature" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_FEATURES.map(feature => (
                    <SelectItem key={feature} value={feature}>
                      {feature}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Input
                placeholder="Team name (optional)"
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
              />

              <Button type="submit" disabled={createMutation.isPending}>
                <Plus className="w-4 h-4 mr-2" /> Add Toggle
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Feature Toggles</CardTitle>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : filteredToggles.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No feature toggles configured. Create one above to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredToggles.map(toggle => (
                <div
                  key={toggle.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-medium">{toggle.feature_name}</div>
                    <div className="text-sm text-gray-500">
                      Role: <span className="font-semibold">{toggle.role}</span>
                      {toggle.team_name && ` • Team: ${toggle.team_name}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        {toggle.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <Switch
                        checked={toggle.enabled}
                        onCheckedChange={(enabled) =>
                          updateMutation.mutate({
                            id: toggle.id,
                            enabled,
                            description: toggle.description
                          })
                        }
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(toggle.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}