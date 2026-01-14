import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b'];

export default function FinancialReportGenerator({ dateRange, setDateRange, report }) {
  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financial Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              />
            </div>
          </div>
          <p className="text-gray-600 text-sm">Select dates and navigate to Reports tab to generate.</p>
        </CardContent>
      </Card>
    );
  }

  const invoiceStatusData = [
    { name: 'Paid', value: report.invoiceStatus.paid },
    { name: 'Partially Paid', value: report.invoiceStatus.partiallyPaid },
    { name: 'Pending', value: report.invoiceStatus.pending },
    { name: 'Overdue', value: report.invoiceStatus.overdue }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Total Invoices</p>
            <p className="text-3xl font-bold">{report.summary.totalInvoices}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Total Revenue</p>
            <p className="text-3xl font-bold">${report.summary.totalRevenue}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Outstanding Balance</p>
            <p className="text-3xl font-bold text-orange-600">${report.summary.outstandingBalance}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600">Collection Rate</p>
            <p className="text-3xl font-bold text-green-600">{report.summary.collectionRate}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoice Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={invoiceStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {invoiceStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Paid</span>
              <span className="font-semibold">${report.summary.totalPaid}</span>
            </div>
            <div className="flex justify-between pb-3 border-b">
              <span className="text-gray-600">Outstanding</span>
              <span className="font-semibold">${report.summary.outstandingBalance}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-600">Paid Invoices</p>
                <p className="text-xl font-bold text-green-600">{report.invoiceStatus.paid}</p>
              </div>
              <div>
                <p className="text-gray-600">Overdue</p>
                <p className="text-xl font-bold text-red-600">{report.invoiceStatus.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}