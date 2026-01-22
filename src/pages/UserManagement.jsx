import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import UserManagement from "../components/admin/UserManagement";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Loader2 } from "lucide-react";

export default function UserManagementPage() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('-created_date', 1000),
    enabled: !!currentUser && currentUser.role === 'admin'
  });

  // Admin check
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert className="bg-red-50 border-red-200">
          <Shield className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-1">Access Denied</p>
            <p className="text-sm">This page is only accessible to administrators.</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">User Management</h1>
        <p className="text-gray-600 dark:text-gray-400">Manage user accounts, roles, and permissions</p>
      </div>

      {usersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <UserManagement users={allUsers} currentUser={currentUser} />
      )}
    </div>
  );
}