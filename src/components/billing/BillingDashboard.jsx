import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DollarSign, FileText, TrendingUp, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function BillingDashboard() {
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.list('-created_date', 100),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => base44.entities.Payment.list('-created_date', 100),
  });

  const calculateMetrics = () => {
    const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
    const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.remaining_balance || 0), 0);
    const paidCount = invoices.filter(inv => inv.status === 'paid').length;

    return {
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      paidCount,
      overdueCount: invoices.filter(inv => inv.status === 'overdue').length,
    };
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-800',
      sent: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      overdue: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const metrics = calculateMetrics();

  return (
    <div className="space-y-6">
      {/* Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Invoiced</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  ${metrics.totalInvoiced.toFixed(2)}
                </p>
              </div>
              <FileText className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Paid</p>
                <p className="text-2xl font-bold text-green-600 mt-2">
                  ${metrics.totalPaid.toFixed(2)}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-600">Outstanding</p>
                <p className="text-2xl font-bold text-orange-600 mt-2">
                  ${metrics.totalOutstanding.toFixed(2)}
                </p>
              </div>
              <AlertCircle className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-600">Collection Rate</p>
                <p className="text-2xl font-bold text-purple-600 mt-2">
                  {metrics.totalInvoiced > 0 
                    ? ((metrics.totalPaid / metrics.totalInvoiced) * 100).toFixed(1)
                    : '0'
                  }%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices and Payments Tabs */}
      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="invoices">
            Invoices ({invoices.length})
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments ({payments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Invoice #</th>
                      <th className="text-left py-2 px-2">Visit Type</th>
                      <th className="text-left py-2 px-2">Amount</th>
                      <th className="text-left py-2 px-2">Paid</th>
                      <th className="text-left py-2 px-2">Balance</th>
                      <th className="text-left py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.slice(0, 10).map((invoice) => (
                      <tr key={invoice.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-2 font-semibold">{invoice.invoice_number}</td>
                        <td className="py-2 px-2 text-gray-600">
                          {invoice.visit_type?.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2 px-2">${invoice.amount?.toFixed(2)}</td>
                        <td className="py-2 px-2 text-green-600">
                          ${(invoice.amount_paid || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-orange-600">
                          ${(invoice.remaining_balance || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2">
                          <Badge className={getStatusColor(invoice.status)}>
                            {invoice.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {invoices.length === 0 && (
                <p className="text-center text-gray-500 py-8">No invoices found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Invoice #</th>
                      <th className="text-left py-2 px-2">Amount</th>
                      <th className="text-left py-2 px-2">Payment Date</th>
                      <th className="text-left py-2 px-2">Method</th>
                      <th className="text-left py-2 px-2">Payor</th>
                      <th className="text-left py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 10).map((payment) => (
                      <tr key={payment.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-2 font-semibold">{payment.invoice_id}</td>
                        <td className="py-2 px-2 text-green-600 font-semibold">
                          ${payment.amount?.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-gray-600">
                          {new Date(payment.payment_date).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-2">
                          {payment.payment_method?.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2 px-2 text-gray-600">{payment.payor}</td>
                        <td className="py-2 px-2">
                          <Badge className="bg-green-100 text-green-800">
                            {payment.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {payments.length === 0 && (
                <p className="text-center text-gray-500 py-8">No payments recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}