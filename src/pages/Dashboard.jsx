import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FileText, ListTodo, Activity, Plus } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 mt-1">Welcome to CareMetric AI</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" />
              <span className="text-2xl font-bold text-green-600">Active</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}