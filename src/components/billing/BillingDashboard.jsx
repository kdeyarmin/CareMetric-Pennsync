import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DollarSign, FileText, AlertCircle, CheckCircle, Clock } from "lucide-react";
import InvoiceList from "./InvoiceList";
import FinancialReportGenerator from "./FinancialReportGenerator";

export default function BillingDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const { data: invoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list(),
    initialData: []
  });

  const { data: report } = useQuery({
    queryKey: ["financialReport", dateRange],
    queryFn: async () => {
      const { data } = await base44.functions.invoke('generateFinancialReport', {
        startDate: dateRange.start,
        endDate: dateRange.end
      });
      return data;
    },
    enabled: activeTab === "reports"
  });

  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0);
  const outstanding = totalRevenue - totalPaid;
  const paidInvoices = invoices.filter(inv => inv.status === 'paid').length;
  const overdueInvoices = invoices.filter(inv => new Date(inv.due_date) < new Date() && inv.status !== 'paid').length;

  const handleSendReminders = async () => {
    await base44.functions.invoke('sendPaymentReminders', {});
    alert('Payment reminders sent!');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Billing Dashboard</h1>
        <div className="flex gap-2">
          <Button variant={activeTab === "overview" ? "default" : "outline"} onClick={() => setActiveTab("overview")}>Overview</Button>
          <Button variant={activeTab === "invoices" ? "default" : "outline"} onClick={() => setActiveTab("invoices")}>Invoices</Button>
          <Button variant={activeTab === "reports" ? "default" : "outline"} onClick={() => setActiveTab("reports")}>Reports</Button>
        </div>
      </div>

      {activeTab === "overview" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Revenue</p>
                    <p className="text-2xl font-bold">${totalRevenue.toFixed(2)}</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Paid</p>
                    <p className="text-2xl font-bold">${totalPaid.toFixed(2)}</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Outstanding</p>
                    <p className="text-2xl font-bold">${outstanding.toFixed(2)}</p>
                  </div>
                  <AlertCircle className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Overdue Invoices</p>
                    <p className="text-2xl font-bold">{overdueInvoices}</p>
                  </div>
                  <Clock className="w-8 h-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Total Invoices</p>
                  <p className="text-xl font-semibold">{invoices.length}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Paid</p>
                  <Badge className="mt-2">{paidInvoices}</Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Pending</p>
                  <Badge variant="outline" className="mt-2">{invoices.filter(i => i.status === 'pending').length}</Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Collection Rate</p>
                  <p className="text-lg font-semibold">{((totalPaid / totalRevenue) * 100).toFixed(1)}%</p>
                </div>
              </div>
              <Button onClick={handleSendReminders} className="mt-4">Send Payment Reminders</Button>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "invoices" && <InvoiceList />}

      {activeTab === "reports" && (
        <FinancialReportGenerator 
          dateRange={dateRange} 
          setDateRange={setDateRange} 
          report={report} 
        />
      )}
    </div>
  );
}