import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { 
  DollarSign, 
  FileText, 
  TrendingUp, 
  Plus,
  Receipt,
  BarChart3
} from "lucide-react";

import InvoiceManager from "../components/billing/InvoiceManager";
import PaymentTracker from "../components/billing/PaymentTracker";
import FinancialReports from "../components/billing/FinancialReports";
import CreateInvoiceDialog from "../components/billing/CreateInvoiceDialog";

export default function BillingInvoicing() {
  const [activeTab, setActiveTab] = useState("invoices");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list('-created_date', 1000)
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["payments"],
    queryFn: () => base44.entities.PaymentRecord.list('-created_date', 1000)
  });

  // Calculate stats
  const totalRevenue = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, inv) => sum + (inv.total_amount || 0), 0);

  const outstandingAmount = invoices
    .filter(i => ['sent', 'partial', 'overdue'].includes(i.status))
    .reduce((sum, inv) => sum + (inv.balance_due || 0), 0);

  const overdueInvoices = invoices.filter(i => 
    i.status === 'overdue' || 
    (i.status === 'sent' && new Date(i.due_date) < new Date())
  ).length;

  const recentPayments = payments
    .filter(p => {
      const paymentDate = new Date(p.payment_date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return paymentDate >= thirtyDaysAgo;
    })
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Billing & Invoicing
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage invoices, track payments, and generate financial reports
            </p>
          </div>
          <CreateInvoiceDialog />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                From paid invoices
              </p>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Outstanding
              </CardTitle>
              <FileText className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                ${outstandingAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Pending payment
              </p>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Recent Payments
              </CardTitle>
              <Receipt className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                ${recentPayments.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Last 30 days
              </p>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Overdue
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {overdueInvoices}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Invoices overdue
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="space-y-4 mt-6">
            <InvoiceManager invoices={invoices} />
          </TabsContent>

          <TabsContent value="payments" className="space-y-4 mt-6">
            <PaymentTracker payments={payments} invoices={invoices} />
          </TabsContent>

          <TabsContent value="reports" className="space-y-4 mt-6">
            <FinancialReports invoices={invoices} payments={payments} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}