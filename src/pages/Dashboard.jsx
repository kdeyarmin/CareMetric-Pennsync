import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayEastern } from "../components/utils/timezone";

export default function Dashboard() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const user = await base44.auth.me();
      console.log('User loaded:', user);
      return user;
    }
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['todayVisits'],
    queryFn: async () => {
      const today = todayEastern();
      const data = await base44.entities.Visit.filter({ visit_date: today });
      return data || [];
    },
    enabled: !!currentUser
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const data = await base44.entities.Patient.list(500, '-updated_date');
      return data || [];
    },
    enabled: !!currentUser
  });

  const { data: nurseTasks = [] } = useQuery({
    queryKey: ['nurseTasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({
      assigned_to: currentUser?.email,
      status: { "$ne": "completed" }
    }),
    enabled: !!currentUser?.email
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-slate-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Please log in</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto min-h-screen">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Dashboard - {currentUser?.full_name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p>✅ Dashboard loaded successfully</p>
            <p>Email: {currentUser?.email}</p>
            <p>Role: {currentUser?.role}</p>
            <p>Credential: {currentUser?.credential_type || 'None'}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Patients</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{patients?.length || 0}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Visits Today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{visits?.length || 0}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{nurseTasks?.length || 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}