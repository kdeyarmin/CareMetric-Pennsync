import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BulkRoleAssignment from '@/components/admin/BulkRoleAssignment';
import RoleManager from '@/components/admin/RoleManager';
import EnhancedUserActivityLog from '@/components/admin/EnhancedUserActivityLog';
import { Users, Shield, BarChart3 } from 'lucide-react';

export default function AdminUserManagement() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">User Management</h1>
        <p className="text-gray-600">Manage roles, permissions, and monitor user activity</p>
      </div>

      <Tabs defaultValue="bulk-assign" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bulk-assign" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Bulk Assign
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Roles & Permissions
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Activity Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bulk-assign">
          <BulkRoleAssignment />
        </TabsContent>

        <TabsContent value="roles">
          <RoleManager />
        </TabsContent>

        <TabsContent value="activity">
          <EnhancedUserActivityLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}