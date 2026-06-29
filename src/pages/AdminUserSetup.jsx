import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Plus, Shield, AlertTriangle, Check, UserCheck } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

export default function AdminUserSetup() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviteRole, setInviteRole] = useState("user");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('-created_date'),
    initialData: [],
    enabled: currentUser?.role === 'admin',
  });

  const inviteUserMutation = useMutation({
    mutationFn: async ({ email, full_name, role }) => {
      return await base44.functions.invoke('createUserWithTempPassword', { email, full_name, role });
    },
    onSuccess: () => {
      toast.success(`Invitation sent to ${inviteEmail}. They will be auto-approved when they sign up.`);
      setInviteEmail("");
      setInviteFullName("");
      setInviteRole("user");
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
    },
    onError: (error) => {
      toast.error(`Failed to invite user: ${error.message}`);
    },
  });

  const handleInviteUser = async () => {
    if (!inviteEmail) {
      toast.error("Please enter an email address");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (!inviteFullName.trim()) {
      toast.error("Please enter the user's full name");
      return;
    }
    inviteUserMutation.mutate({ email: inviteEmail, full_name: inviteFullName.trim(), role: inviteRole });
  };

  const isAdmin = currentUser?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-2">Access Denied</p>
            <p>Only administrators can access this page.</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={UserCheck}
        eyebrow="Manage"
        title="User Setup"
        description="Manage user invitations and setup new team members"
        favoritePage="AdminUserSetup"
      />

      {/* Invite New User */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Invite New User
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                type="text"
                placeholder="e.g. Kevin Deyarmin"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger id="role" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={handleInviteUser}
              disabled={inviteUserMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 w-full md:w-auto"
            >
              <Mail className="w-4 h-4 mr-2" />
              {inviteUserMutation.isPending ? "Sending..." : "Send Invitation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Users ({allUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {allUsers.length === 0 ? (
            <EmptyState icon={Shield} title="No users yet" description="Start by inviting your team members above." />
          ) : (
            <div className="space-y-3">
              {allUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{user.full_name}</p>
                    <p className="text-sm text-slate-500">{user.email}</p>
                  </div>
                  <Badge
                    variant={user.role === 'admin' ? 'default' : 'outline'}
                    className="ml-4 flex-shrink-0"
                  >
                    {user.role === 'admin' ? (
                      <>
                        <Shield className="w-3 h-3 mr-1" />
                        Admin
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3 mr-1" />
                        User
                      </>
                    )}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}