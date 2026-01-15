import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trash2, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

const AVAILABLE_PERMISSIONS = [
  'view_patients',
  'edit_patients',
  'create_patients',
  'delete_patients',
  'view_visits',
  'create_visits',
  'edit_visits',
  'view_care_plans',
  'create_care_plans',
  'edit_care_plans',
  'manage_tasks',
  'view_training',
  'manage_training',
  'view_compliance',
  'manage_compliance',
  'view_analytics',
  'manage_users',
];

const MODULE_OPTIONS = [
  'patients',
  'visits',
  'care_plans',
  'tasks',
  'training',
  'compliance',
  'analytics',
  'billing',
  'admin',
];

export default function RoleManager() {
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', permissions: [], module_access: {} });
  const queryClient = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Role.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      resetForm();
      toast.success('Role created successfully');
    },
    onError: () => toast.error('Failed to create role'),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Role.update(editingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      resetForm();
      toast.success('Role updated successfully');
    },
    onError: () => toast.error('Failed to update role'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Role.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted successfully');
    },
    onError: () => toast.error('Failed to delete role'),
  });

  const handleSubmit = () => {
    if (!formData.name) {
      toast.error('Role name is required');
      return;
    }

    const data = {
      ...formData,
      module_access: Object.fromEntries(
        MODULE_OPTIONS.map(m => [m, formData.module_access?.[m] ?? false])
      ),
    };

    if (editingId) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', description: '', permissions: [], module_access: {} });
    setEditingId(null);
  };

  const handleEdit = (role) => {
    setEditingId(role.id);
    setFormData({
      name: role.name,
      description: role.description || '',
      permissions: role.permissions || [],
      module_access: role.module_access || {},
    });
  };

  const togglePermission = (perm) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const toggleModule = (module) => {
    setFormData(prev => ({
      ...prev,
      module_access: {
        ...prev.module_access,
        [module]: !prev.module_access[module],
      },
    }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Edit Role' : 'Create New Role'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Role Name</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Clinical Manager"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe this role's purpose"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Module Access</label>
            <div className="grid grid-cols-2 gap-2">
              {MODULE_OPTIONS.map(module => (
                <div key={module} className="flex items-center gap-2">
                  <Checkbox
                    checked={formData.module_access?.[module] ?? false}
                    onCheckedChange={() => toggleModule(module)}
                  />
                  <span className="text-sm capitalize">{module.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Permissions</label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_PERMISSIONS.map(perm => (
                <div key={perm} className="flex items-center gap-2">
                  <Checkbox
                    checked={formData.permissions.includes(perm)}
                    onCheckedChange={() => togglePermission(perm)}
                  />
                  <span className="text-sm">{perm.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? 'Update Role' : 'Create Role'}
            </Button>
            {editingId && <Button variant="outline" onClick={resetForm}>Cancel</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div>
          ) : (
            <div className="space-y-2">
              {roles.map(role => (
                <div key={role.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h3 className="font-medium">{role.name}</h3>
                    <p className="text-sm text-gray-600">{role.description}</p>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {role.permissions?.slice(0, 3).map(perm => (
                        <Badge key={perm} variant="outline" className="text-xs">
                          {perm}
                        </Badge>
                      ))}
                      {role.permissions?.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{role.permissions.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(role)}
                      disabled={role.is_system_role}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(role.id)}
                      disabled={role.is_system_role || deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
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