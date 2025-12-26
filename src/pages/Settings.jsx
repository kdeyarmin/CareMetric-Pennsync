import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Settings as SettingsIcon, Database } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import DataRetentionSettings from "../components/settings/DataRetentionSettings";

export default function Settings() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600">Manage your account and data preferences</p>
      </div>

      <div className="space-y-6">
        {/* Profile Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-blue-600" />
              Profile Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-500">Name</p>
              <p className="text-gray-900">{currentUser?.full_name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Email</p>
              <p className="text-gray-900">{currentUser?.email}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Credential Type</p>
              <p className="text-gray-900">{currentUser?.credential_type || 'RN'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Data Retention Settings */}
        <DataRetentionSettings />
      </div>
    </div>
  );
}