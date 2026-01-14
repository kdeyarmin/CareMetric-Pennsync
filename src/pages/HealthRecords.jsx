import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PatientHealthRecordViewer from "../components/healthRecords/PatientHealthRecordViewer";
import ProviderHealthRecordManager from "../components/healthRecords/ProviderHealthRecordManager";
import ImmunizationManager from "../components/healthRecords/ImmunizationManager";

export default function HealthRecords() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const isProvider = currentUser && currentUser.role !== 'patient';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-2">Health Records</h1>
        <p className="text-gray-600">View and manage your comprehensive medical history</p>
      </div>

      {isProvider ? (
        <Tabs defaultValue="view" className="space-y-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="view">View Records</TabsTrigger>
            <TabsTrigger value="manage">Manage Patient Records</TabsTrigger>
          </TabsList>

          <TabsContent value="view">
            <PatientHealthRecordViewer />
          </TabsContent>

          <TabsContent value="manage">
            <div className="text-sm text-gray-600 mb-4">
              Select a patient to manage their health records
            </div>
            <PatientHealthRecordViewer />
          </TabsContent>
        </Tabs>
      ) : (
        <PatientHealthRecordViewer />
      )}
    </div>
  );
}