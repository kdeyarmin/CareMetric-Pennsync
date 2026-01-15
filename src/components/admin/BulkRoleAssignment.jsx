import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

export default function BulkRoleAssignment() {
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const queryClient = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.asServiceRole.entities.User.list(),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list(),
  });

  const { data: userPermissions = [] } = useQuery({
    queryKey: ['userPermissions'],
    queryFn: () => base44.entities.UserPermission.list(),
  });

  const assignRolesMutation = useMutation({
    mutationFn: async () => {
      for (const userEmail of selectedUsers) {
        const existing = userPermissions.find(p => p.user_email === userEmail);
        const permData = {
          user_email: userEmail,
          role_name: selectedRole,
          assigned_date: new Date().toISOString(),
          assigned_by: (await base44.auth.me()).email,
        };

        if (existing) {
          await base44.entities.UserPermission.update(existing.id, permData);
        } else {
          await base44.entities.UserPermission.create(permData);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userPermissions'] });
      setSelectedUsers([]);
      setSelectedRole('');
      toast.success(`Role assigned to ${selectedUsers.length} user(s)`);
    },
    onError: () => toast.error('Failed to assign roles'),
  });

  const toggleUserSelection = (email) => {
    setSelectedUsers(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Role Assignment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Select Users</label>
          <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
            {users.map(user => (
              <div key={user.email} className="flex items-center gap-2">
                <Checkbox
                  checked={selectedUsers.includes(user.email)}
                  onCheckedChange={() => toggleUserSelection(user.email)}
                />
                <span className="text-sm">{user.full_name} ({user.email})</span>
              </div>
            ))}
          </div>
          {selectedUsers.length > 0 && (
            <p className="text-sm text-blue-600 mt-2">{selectedUsers.length} user(s) selected</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Select Role</label>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a role..." />
            </SelectTrigger>
            <SelectContent>
              {roles.map(role => (
                <SelectItem key={role.id} value={role.name}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedUsers.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Select at least one user and a role to proceed.</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => assignRolesMutation.mutate()}
          disabled={selectedUsers.length === 0 || !selectedRole || assignRolesMutation.isPending}
          className="w-full"
        >
          {assignRolesMutation.isPending ? (
            <>
              <Loader2 className="animate-spin mr-2 h-4 w-4" />
              Assigning...
            </>
          ) : (
            `Assign Role to ${selectedUsers.length} User(s)`
          )}
        </Button>
      </CardContent>
    </Card>
  );
}