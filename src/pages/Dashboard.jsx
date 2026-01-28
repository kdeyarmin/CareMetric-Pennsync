import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FileText, ListTodo, Activity, Plus, Calendar, AlertCircle, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        console.error('Auth error:', error);
        return null;
      }
    }
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Activity className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-slate-600">Please log in to view the dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Welcome back, {currentUser.full_name}</h1>
        <p className="text-slate-600 mt-1">Here's what's happening today</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Activity className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">Active</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks and workflows</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <a href="/SmartNoteAssistant">
            <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
              <FileText className="w-5 h-5" />
              <span className="text-sm">Create Note</span>
            </Button>
          </a>
          <a href="/Patients">
            <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
              <Users className="w-5 h-5" />
              <span className="text-sm">View Patients</span>
            </Button>
          </a>
          <a href="/Tasks">
            <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
              <ListTodo className="w-5 h-5" />
              <span className="text-sm">My Tasks</span>
            </Button>
          </a>
          <a href="/DocumentGenerator">
            <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
              <Plus className="w-5 h-5" />
              <span className="text-sm">Generate Doc</span>
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}