import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  Users,
} from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

export default function DocumentAnalyticsDashboard() {
  const { data: documents = [] } = useQuery({
    queryKey: ["documents"],
    queryFn: () => base44.entities.DocumentRecord.list("-created_date", 500),
  });

  const { data: signatures = [] } = useQuery({
    queryKey: ["signatures"],
    queryFn: () => base44.entities.DigitalSignature.list("-created_date", 500),
  });

  const analytics = useMemo(() => {
    const totalDocs = documents.length;
    const signedDocs = documents.filter((d) => d.is_signed).length;
    const pendingDocs = documents.filter(
      (d) => d.signature_status === "pending"
    ).length;

    // Category breakdown
    const categoryData = documents.reduce((acc, doc) => {
      const cat = doc.category || "uncategorized";
      const existing = acc.find((c) => c.category === cat);
      if (existing) {
        existing.count += 1;
      } else {
        acc.push({ category: cat, count: 1 });
      }
      return acc;
    }, []);

    // Signature status breakdown
    const statusData = [
      {
        name: "Signed",
        value: signedDocs,
        color: "#10b981",
      },
      {
        name: "Pending",
        value: pendingDocs,
        color: "#f59e0b",
      },
      {
        name: "Unsigned",
        value: totalDocs - signedDocs - pendingDocs,
        color: "#ef4444",
      },
    ];

    // Signature method breakdown
    const methodData = signatures.reduce((acc, sig) => {
      const method = sig.signature_method || "unknown";
      const existing = acc.find((m) => m.method === method);
      if (existing) {
        existing.count += 1;
      } else {
        acc.push({ method, count: 1 });
      }
      return acc;
    }, []);

    // Signing completion rate
    const completionRate = totalDocs > 0 ? ((signedDocs / totalDocs) * 100).toFixed(1) : 0;

    // Average signing time
    const avgSigningTime = signatures.length
      ? (
          signatures.reduce((sum, sig) => {
            const created = new Date(sig.created_date);
            const diff = Date.now() - created.getTime();
            return sum + diff;
          }, 0) / signatures.length
        ).toFixed(0)
      : 0;

    // MFA adoption
    const mfaCount = signatures.filter((s) => s.mfa_verified).length;
    const mfaAdoption = signatures.length
      ? ((mfaCount / signatures.length) * 100).toFixed(1)
      : 0;

    return {
      totalDocs,
      signedDocs,
      pendingDocs,
      completionRate,
      categoryData,
      statusData,
      methodData,
      avgSigningTime,
      mfaAdoption,
      totalSignatures: signatures.length,
    };
  }, [documents, signatures]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Documents</p>
                <p className="text-2xl font-bold">{analytics.totalDocs}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Completion Rate</p>
                <p className="text-2xl font-bold">{analytics.completionRate}%</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Pending Signatures</p>
                <p className="text-2xl font-bold">{analytics.pendingDocs}</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">MFA Adoption</p>
                <p className="text-2xl font-bold">{analytics.mfaAdoption}%</p>
              </div>
              <AlertCircle className="w-8 h-8 text-purple-500 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="category">By Category</TabsTrigger>
          <TabsTrigger value="methods">Signature Methods</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Signature Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {analytics.statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="category">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents by Category</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.categoryData.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No data available
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.categoryData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="methods">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Signature Methods Used</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.methodData.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No signatures yet
                </p>
              ) : (
                <div className="space-y-3">
                  {analytics.methodData.map((method) => (
                    <div
                      key={method.method}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded"
                    >
                      <span className="font-medium text-sm capitalize">
                        {method.method}
                      </span>
                      <Badge className="bg-blue-100 text-blue-800">
                        {method.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-green-50 rounded">
              <p className="text-xs text-gray-600">Signed Documents</p>
              <p className="text-xl font-bold text-green-700">
                {analytics.signedDocs}
              </p>
            </div>
            <div className="p-3 bg-blue-50 rounded">
              <p className="text-xs text-gray-600">MFA Secured</p>
              <p className="text-xl font-bold text-blue-700">
                {Math.round((analytics.mfaAdoption * analytics.totalSignatures) / 100)}
              </p>
            </div>
            <div className="p-3 bg-amber-50 rounded">
              <p className="text-xs text-gray-600">Pending Review</p>
              <p className="text-xl font-bold text-amber-700">
                {analytics.pendingDocs}
              </p>
            </div>
            <div className="p-3 bg-purple-50 rounded">
              <p className="text-xs text-gray-600">Total Signatures</p>
              <p className="text-xl font-bold text-purple-700">
                {analytics.totalSignatures}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}