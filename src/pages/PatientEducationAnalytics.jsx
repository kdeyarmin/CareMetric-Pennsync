import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import MaterialAnalyticsDashboard from '@/components/education/MaterialAnalyticsDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader } from 'lucide-react';

export default function PatientEducationAnalytics() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    },
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-900">Access Restricted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-yellow-800">
              This page is only available to administrators.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Patient Education Analytics</h1>
        <p className="text-slate-600 mt-2">
          Track material performance, user engagement, and patient completion rates
        </p>
      </div>

      <MaterialAnalyticsDashboard />
    </div>
  );
}