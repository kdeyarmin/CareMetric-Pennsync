import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, DollarSign, FileText, CheckCircle2, Loader } from "lucide-react";
import { toast } from "sonner";

export default function MissedChargeDetector({ dateRange = 30 }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [missedCharges, setMissedCharges] = useState([]);

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', dateRange],
    queryFn: async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRange);
      return await base44.entities.Visit.filter({
        visit_date: { $gte: cutoffDate.toISOString().split('T')[0] }
      });
    }
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.filter({})
  });

  const analyzeForMissedCharges = async () => {
    setAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze these visits and invoices to identify potential unbilled services and missed revenue opportunities.

Visits (last ${dateRange} days): ${JSON.stringify(recentVisits.slice(0, 50))}
Existing Invoices: ${JSON.stringify(invoices.slice(0, 50))}

For each visit, identify:
1. Services that were documented but not billed
2. Procedures mentioned in notes without corresponding CPT codes
3. High-complexity visits billed at lower E&M levels
4. Missing modifier opportunities
5. Ancillary services not captured

Provide actionable recommendations with estimated revenue impact.`,
        response_json_schema: {
          type: "object",
          properties: {
            missed_charges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  visit_id: { type: "string" },
                  patient_name: { type: "string" },
                  visit_date: { type: "string" },
                  issue_type: { type: "string" },
                  description: { type: "string" },
                  recommended_code: { type: "string" },
                  estimated_revenue: { type: "number" },
                  severity: { type: "string", enum: ["high", "medium", "low"] }
                }
              }
            },
            total_potential_revenue: { type: "number" },
            summary: { type: "string" }
          }
        }
      });

      setMissedCharges(response.missed_charges || []);
      toast.success(`Found ${response.missed_charges?.length || 0} potential missed charges`);
    } catch (error) {
      toast.error("Failed to analyze missed charges");
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  const totalMissedRevenue = missedCharges.reduce((sum, charge) => sum + (charge.estimated_revenue || 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Missed Charge Detection
          </CardTitle>
          <Button onClick={analyzeForMissedCharges} disabled={analyzing}>
            {analyzing ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Analyze Last {dateRange} Days
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {missedCharges.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm">Click "Analyze" to scan for missed charges</p>
          </div>
        ) : (
          <>
            <Alert className="bg-orange-50 dark:bg-orange-950 border-orange-200">
              <DollarSign className="w-4 h-4 text-orange-600" />
              <AlertDescription>
                <p className="font-semibold text-orange-900 dark:text-orange-100">
                  Potential Missed Revenue: ${totalMissedRevenue.toFixed(2)}
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                  {missedCharges.length} unbilled services detected
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {missedCharges.map((charge, idx) => (
                <div
                  key={idx}
                  className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{charge.patient_name}</p>
                      <p className="text-xs text-gray-600">
                        {new Date(charge.visit_date).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge className={
                        charge.severity === 'high' 
                          ? 'bg-red-100 text-red-800' 
                          : charge.severity === 'medium'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }>
                        {charge.severity}
                      </Badge>
                      <p className="text-sm font-semibold text-green-600 mt-1">
                        +${charge.estimated_revenue?.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  
                  <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">
                    <span className="font-semibold">{charge.issue_type}:</span> {charge.description}
                  </p>
                  
                  {charge.recommended_code && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {charge.recommended_code}
                      </Badge>
                      <Button size="sm" variant="outline" className="h-6 text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Create Invoice
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}