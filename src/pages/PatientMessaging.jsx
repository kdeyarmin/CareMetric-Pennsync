import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MessageTemplateManager from "../components/messaging/MessageTemplateManager";
import SecurePatientMessaging from "../components/messaging/SecurePatientMessaging";
import MessageHistory from "../components/messaging/MessageHistory";

export default function PatientMessaging() {
  return (
    <div className="p-6">
      <h1 className="text-4xl font-bold mb-8">Patient Communication</h1>

      <Tabs defaultValue="messaging" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="messaging">Secure Messaging</TabsTrigger>
          <TabsTrigger value="templates">Message Templates</TabsTrigger>
          <TabsTrigger value="history">Message History</TabsTrigger>
        </TabsList>

        <TabsContent value="messaging">
          <SecurePatientMessaging />
        </TabsContent>

        <TabsContent value="templates">
          <MessageTemplateManager />
        </TabsContent>

        <TabsContent value="history">
          <MessageHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}