import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProviderScheduleCalendar from "../components/scheduling/ProviderScheduleCalendar";
import ProviderAvailabilityManager from "../components/scheduling/ProviderAvailabilityManager";

export default function ProviderScheduling() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Schedule Management</h1>

      <Tabs defaultValue="calendar" className="space-y-4">
        <TabsList className="grid grid-cols-1 sm:grid-cols-2 w-full max-w-md mx-auto">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="availability">My Availability</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <ProviderScheduleCalendar />
        </TabsContent>

        <TabsContent value="availability">
          <ProviderAvailabilityManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}