import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, TrendingUp, Calendar, Loader, LineChart } from "lucide-react";
import { toast } from "sonner";

export default function RevenueProjection() {
  const [projecting, setProjecting] = useState(false);
  const [projection, setProjection] = useState(null);
  const [timeframe, setTimeframe] = useState("30");

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.filter({})
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' })
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => base44.entities.Visit.filter({})
  });

  const generateProjection = async () => {
    setProjecting(true);
    try {
      // Calculate historical metrics
      const paidInvoices = invoices.filter(inv => inv.status === 'paid');
      const totalRevenue = paidInvoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
      const avgRevenuePerVisit = visits.length > 0 ? totalRevenue / visits.length : 0;
      const avgVisitsPerMonth = visits.length / 6; // Assuming 6 months of data

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate revenue projections for the next ${timeframe} days based on historical data.

Historical Data:
- Total Revenue (6 months): $${totalRevenue.toFixed(2)}
- Total Paid Invoices: ${paidInvoices.length}
- Average Revenue per Visit: $${avgRevenuePerVisit.toFixed(2)}
- Average Visits per Month: ${avgVisitsPerMonth.toFixed(0)}
- Active Patients: ${patients.length}
- Recent Visit Trend: ${visits.slice(-30).length} visits in last 30 days

Consider:
1. Seasonal trends
2. Patient load capacity
3. Historical payment patterns
4. Service mix
5. Pending visits and scheduled appointments

Provide realistic projections with best case, expected, and worst case scenarios.`,
        response_json_schema: {
          type: "object",
          properties: {
            timeframe_days: { type: "number" },
            projections: {
              type: "object",
              properties: {
                best_case: {
                  type: "object",
                  properties: {
                    total_revenue: { type: "number" },
                    estimated_visits: { type: "number" },
                    assumptions: { type: "array", items: { type: "string" } }
                  }
                },
                expected: {
                  type: "object",
                  properties: {
                    total_revenue: { type: "number" },
                    estimated_visits: { type: "number" },
                    assumptions: { type: "array", items: { type: "string" } }
                  }
                },
                worst_case: {
                  type: "object",
                  properties: {
                    total_revenue: { type: "number" },
                    estimated_visits: { type: "number" },
                    assumptions: { type: "array", items: { type: "string" } }
                  }
                }
              }
            },
            breakdown: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  expected_revenue: { type: "number" },
                  percentage: { type: "number" }
                }
              }
            },
            recommendations: {
              type: "array",
              items: { type: "string" }
            },
            risks: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setProjection(response);
      toast.success("Revenue projection generated");
    } catch (error) {
      toast.error("Failed to generate projection");
      console.error(error);
    } finally {
      setProjecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="w-5 h-5 text-green-600" />
          Revenue Projection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1 space-y-2">
            <Label>Projection Timeframe (days)</Label>
            <Input
              type="number"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              placeholder="30"
              min="1"
              max="365"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={generateProjection} disabled={projecting}>
              {projecting ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Projecting...
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>

        {projection && (
          <div className="space-y-4">
            {/* Projection Scenarios */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200">
                <p className="text-xs text-red-700 dark:text-red-300 mb-1">Worst Case</p>
                <p className="text-2xl font-bold text-red-900 dark:text-red-100">
                  ${projection.projections?.worst_case?.total_revenue?.toFixed(2)}
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  ~{projection.projections?.worst_case?.estimated_visits} visits
                </p>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border-2 border-blue-300">
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">Expected</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  ${projection.projections?.expected?.total_revenue?.toFixed(2)}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  ~{projection.projections?.expected?.estimated_visits} visits
                </p>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200">
                <p className="text-xs text-green-700 dark:text-green-300 mb-1">Best Case</p>
                <p className="text-2xl font-bold text-green-900 dark:text-green-100">
                  ${projection.projections?.best_case?.total_revenue?.toFixed(2)}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  ~{projection.projections?.best_case?.estimated_visits} visits
                </p>
              </div>
            </div>

            {/* Revenue Breakdown */}
            {projection.breakdown && projection.breakdown.length > 0 && (
              <div className="border rounded-lg p-4">
                <p className="font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Revenue Breakdown
                </p>
                <div className="space-y-2">
                  {projection.breakdown.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{item.category}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{item.percentage}%</span>
                        <span className="font-semibold">${item.expected_revenue?.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {projection.recommendations && projection.recommendations.length > 0 && (
              <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950">
                <p className="font-semibold mb-2 flex items-center gap-2 text-green-900 dark:text-green-100">
                  <TrendingUp className="w-4 h-4" />
                  Recommendations
                </p>
                <ul className="space-y-1 text-sm text-green-800 dark:text-green-200">
                  {projection.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span>•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks */}
            {projection.risks && projection.risks.length > 0 && (
              <div className="border rounded-lg p-4 bg-orange-50 dark:bg-orange-950">
                <p className="font-semibold mb-2 text-orange-900 dark:text-orange-100">
                  Potential Risks
                </p>
                <ul className="space-y-1 text-sm text-orange-800 dark:text-orange-200">
                  {projection.risks.map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span>•</span>
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!projection && (
          <div className="text-center py-8 text-gray-500">
            <LineChart className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm">Set timeframe and generate revenue projections</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}