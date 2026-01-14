import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BillingDashboard from "../components/billing/BillingDashboard";
import InvoiceGenerator from "../components/billing/InvoiceGenerator";
import ServiceCodeManager from "../components/billing/ServiceCodeManager";
import InsuranceProviderManager from "../components/billing/InsuranceProviderManager";

export default function BillingModule() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6">
      <h1 className="text-4xl font-bold mb-8">Billing & Invoicing</h1>
      
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="invoices">Generate Invoices</TabsTrigger>
          <TabsTrigger value="services">Service Codes</TabsTrigger>
          <TabsTrigger value="insurance">Insurance Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <BillingDashboard key={refreshKey} />
        </TabsContent>

        <TabsContent value="invoices">
          <InvoiceGenerator onInvoiceCreated={() => setRefreshKey(refreshKey + 1)} />
        </TabsContent>

        <TabsContent value="services">
          <ServiceCodeManager />
        </TabsContent>

        <TabsContent value="insurance">
          <InsuranceProviderManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}