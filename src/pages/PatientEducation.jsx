import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PatientEducationLibrary from '../components/education/PatientEducationLibrary';
import AdminEducationManager from '../components/education/AdminEducationManager';
import PullToRefresh from '../components/mobile/PullToRefresh';

export default function PatientEducation() {
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = currentUser?.role === 'admin';

  if (isLoading) return <div className="p-4">Loading...</div>;

  return (
    <PullToRefresh onRefresh={async () => {
      // Refresh data
    }}>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <Tabs defaultValue={isAdmin ? "manage" : "browse"} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="browse">
              📚 Browse Materials
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="manage">
                ⚙️ Manage Materials
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="browse" className="mt-6">
            <PatientEducationLibrary />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="manage" className="mt-6">
              <AdminEducationManager />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PullToRefresh>
  );
}