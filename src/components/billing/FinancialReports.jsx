import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Calendar } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function FinancialReports({ invoices = [], payments = [] }) {
  const [dateRange, setDateRange] = useState("30days");

  const getFilteredData = () => {
    const now = new Date();
    const daysAgo = dateRange === "30days" ? 30 : dateRange === "90days" ? 90 : 365;
    const cutoff = new Date(now.setDate(now.getDate() - daysAgo));

    return {
      invoices: invoices.filter(i => new Date(i.invoice_date) >= cutoff),
      payments: payments.filter(p => new Date(p.payment_date) >= cutoff)
    };
  };

  const { invoices: filteredInvoices, payments: filteredPayments } = getFilteredData();

  // Revenue by month
  const monthlyRevenue = filteredPayments.reduce((acc, payment) => {
    const month = new Date(payment.payment_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    acc[month] = (acc[month] || 0) + payment.amount;
    return acc;
  }, {});

  const revenueData = Object.entries(monthlyRevenue).map(([month, amount]) => ({
    month,
    revenue: amount
  }));

  // Invoice status distribution
  const statusCounts = filteredInvoices.reduce((acc, inv) => {
    acc[inv.status] = (acc[inv.status] || 0) + 1;
    return acc;
  }, {});

  const statusData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status,
    value: count
  }));

  const COLORS = {
    paid: '#10b981',
    sent: '#3b82f6',
    draft: '#6b7280',
    partial: '#f59e0b',
    overdue: '#ef4444',
    cancelled: '#9ca3af'
  };

  // Payment method distribution
  const paymentMethodCounts = filteredPayments.reduce((acc, payment) => {
    acc[payment.payment_method] = (acc[payment.payment_method] || 0) + payment.amount;
    return acc;
  }, {});

  const paymentMethodData = Object.entries(paymentMethodCounts).map(([method, amount]) => ({
    method: method?.replace(/_/g, ' '),
    amount
  }));

  // Key metrics
  const totalRevenue = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalInvoiced = filteredInvoices.reduce((sum, i) => sum + (i.total_amount || 0), 0);
  const totalOutstanding = filteredInvoices
    .filter(i => ['sent', 'partial', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (i.balance_due || 0), 0);
  const collectionRate = totalInvoiced > 0 ? (totalRevenue / totalInvoiced * 100) : 0;

  const exportReport = () => {
    const reportData = {
      period: dateRange,
      generated: new Date().toISOString(),
      summary: {
        totalRevenue,
        totalInvoiced,
        totalOutstanding,
        collectionRate
      },
      invoices: filteredInvoices,
      payments: filteredPayments
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-report-${dateRange}-${Date.now()}.json`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Financial Reports</CardTitle>
            <div className="flex gap-2">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
                <option value="365days">Last Year</option>
              </select>
              <Button variant="outline" onClick={exportReport}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</div>
            <div className="text-2xl font-bold text-green-600 mt-1">
              ${totalRevenue.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Invoiced</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">
              ${totalInvoiced.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Outstanding</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">
              ${totalOutstanding.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Collection Rate</div>
            <div className="text-2xl font-bold text-purple-600 mt-1">
              {collectionRate.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invoice Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Payment Methods</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={paymentMethodData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="method" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Bar dataKey="amount" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}