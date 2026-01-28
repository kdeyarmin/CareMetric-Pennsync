import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FileText, ListTodo, Activity, Plus, Calendar, AlertCircle, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    enabled: !!currentUser
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => base44.entities.Visit.list(),
    enabled: !!currentUser
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({ 
      assigned_to: currentUser?.email,
      status: { "$ne": "completed" }
    }),
    enabled: !!currentUser?.email
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits'],
    queryFn: () => base44.entities.Visit.list('-created_date', 5),
    enabled: !!currentUser
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['patientAlerts'],
    queryFn: () => base44.entities.PatientAlert.list(),
    enabled: !!currentUser
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

  if (!currentUser) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Welcome back, {currentUser.full_name}</h1>
        <p className="text-slate-600 mt-1">Here's what's happening today</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="w-4 h-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patients.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Visits</CardTitle>
            <FileText className="w-4 h-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{visits.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
            <ListTodo className="w-4 h-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tasks.length}</div>
          </CardContent>
        </Card>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
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

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Visits</CardTitle>
            <CardDescription>Latest patient documentation</CardDescription>
          </CardHeader>
          <CardContent>
            {recentVisits.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">No recent visits</p>
            ) : (
              <div className="space-y-3">
                {recentVisits.map((visit) => (
                  <div key={visit.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{visit.patient_name || 'Unknown Patient'}</p>
                      <p className="text-xs text-slate-500">
                        {visit.visit_type || 'Visit'} • {visit.created_date ? formatDistanceToNow(new Date(visit.created_date), { addSuffix: true }) : 'Recently'}
                      </p>
                    </div>
                    <Calendar className="w-4 h-4 text-slate-400" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Critical Alerts */}
      {alerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-900">
              <AlertCircle className="w-5 h-5" />
              Critical Patient Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 p-3 bg-white rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{alert.patient_name}</p>
                    <p className="text-sm text-slate-700">{alert.alert_message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}