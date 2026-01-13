import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, DollarSign, BarChart3 } from 'lucide-react';
import InvoiceGenerator from '@/components/billing/InvoiceGenerator';
import PaymentRecorder from '@/components/billing/PaymentRecorder';
import BillingDashboard from '@/components/billing/BillingDashboard';

export default function BillingModule() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">Billing Module</h1>
          <p className="text-lg text-gray-600">
            Generate invoices, track payments, and manage billing operations
          </p>
        </div>

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="dashboard">
              <BarChart3 className="w-4 h-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="invoice">
              <FileText className="w-4 h-4 mr-2" />
              Generate Invoice
            </TabsTrigger>
            <TabsTrigger value="payment">
              <DollarSign className="w-4 h-4 mr-2" />
              Record Payment
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <BillingDashboard />
          </TabsContent>

          <TabsContent value="invoice" className="space-y-6">
            <div className="max-w-2xl">
              <InvoiceGenerator />
            </div>
          </TabsContent>

          <TabsContent value="payment" className="space-y-6">
            <div className="max-w-2xl">
              <PaymentRecorder />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}