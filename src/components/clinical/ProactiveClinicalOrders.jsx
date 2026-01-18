import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Stethoscope, Plus, FileText, CheckCircle2, ClipboardList } from "lucide-react";
import { toast } from "sonner";

export default function ProactiveClinicalOrders({ 
  diagnosis, 
  noteContent,
  vitalSigns,
  patientContext,
  onOrderGenerated 
}) {
  const [loading, setLoading] = useState(false);
  const [suggestedOrders, setSuggestedOrders] = useState(null);
  const [creatingOrders, setCreatingOrders] = useState({});

  useEffect(() => {
    if (diagnosis && noteContent) {
      generateOrderSuggestions();
    }
  }, [diagnosis, noteContent]);

  const generateOrderSuggestions = async () => {
    setLoading(true);
    try {
      const prompt = `Based on the following clinical assessment, suggest appropriate clinical orders (lab tests, imaging, referrals, DME):

Diagnosis: ${diagnosis}
Clinical Note: ${noteContent}
${vitalSigns ? `Vital Signs: ${JSON.stringify(vitalSigns)}` : ''}
${patientContext ? `Patient History: ${JSON.stringify(patientContext)}` : ''}

Provide evidence-based order recommendations including:
- Laboratory tests needed
- Imaging studies if indicated
- Specialist referrals
- DME (Durable Medical Equipment) needs
- Other clinical orders

For each order, include:
- Order type and description
- Clinical rationale
- Priority level (routine/urgent)
- Expected benefit
- ICD-10 diagnosis codes that support the order`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            lab_orders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  test_name: { type: "string" },
                  rationale: { type: "string" },
                  priority: { type: "string", enum: ["routine", "urgent", "stat"] },
                  frequency: { type: "string" },
                  icd10_codes: { type: "array", items: { type: "string" } }
                }
              }
            },
            imaging_orders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  study_type: { type: "string" },
                  body_part: { type: "string" },
                  rationale: { type: "string" },
                  urgency: { type: "string" },
                  icd10_codes: { type: "array", items: { type: "string" } }
                }
              }
            },
            referrals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  specialty: { type: "string" },
                  reason: { type: "string" },
                  urgency: { type: "string" },
                  key_findings: { type: "string" }
                }
              }
            },
            dme_orders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  equipment: { type: "string" },
                  indication: { type: "string" },
                  medical_necessity: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestedOrders(response);
    } catch (error) {
      console.error('Error generating order suggestions:', error);
      toast.error('Failed to generate order suggestions');
    } finally {
      setLoading(false);
    }
  };

  const copyOrderText = (order, type) => {
    const text = `${type}: ${JSON.stringify(order, null, 2)}`;
    navigator.clipboard.writeText(text);
    toast.success('Order details copied to clipboard');
  };

  if (!diagnosis) return null;

  const allOrders = [
    ...(suggestedOrders?.lab_orders || []).map(o => ({ ...o, type: 'Lab' })),
    ...(suggestedOrders?.imaging_orders || []).map(o => ({ ...o, type: 'Imaging' })),
    ...(suggestedOrders?.referrals || []).map(o => ({ ...o, type: 'Referral' })),
    ...(suggestedOrders?.dme_orders || []).map(o => ({ ...o, type: 'DME' }))
  ];

  return (
    <Card className="border-teal-200 bg-teal-50 dark:bg-teal-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-teal-600" />
            Suggested Clinical Orders
            {allOrders.length > 0 && (
              <Badge variant="outline">{allOrders.length} orders</Badge>
            )}
          </span>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={generateOrderSuggestions}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
            <span className="ml-2 text-sm text-slate-600">Analyzing clinical needs...</span>
          </div>
        ) : suggestedOrders && allOrders.length > 0 ? (
          <>
            {/* Lab Orders */}
            {suggestedOrders.lab_orders?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-teal-900 dark:text-teal-300">
                  🧪 Laboratory Tests
                </h4>
                <div className="space-y-2">
                  {suggestedOrders.lab_orders.map((order, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-teal-200"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h5 className="font-medium text-sm">{order.test_name}</h5>
                            <Badge className={
                              order.priority === 'stat' ? 'bg-red-500' :
                              order.priority === 'urgent' ? 'bg-orange-500' :
                              'bg-blue-500'
                            }>
                              {order.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            <strong>Rationale:</strong> {order.rationale}
                          </p>
                          {order.frequency && (
                            <p className="text-xs text-slate-500">Frequency: {order.frequency}</p>
                          )}
                          {order.icd10_codes?.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {order.icd10_codes.map((code, cIdx) => (
                                <Badge key={cIdx} variant="outline" className="text-xs">
                                  {code}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyOrderText(order, 'Lab Order')}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Imaging Orders */}
            {suggestedOrders.imaging_orders?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-teal-900 dark:text-teal-300">
                  📷 Imaging Studies
                </h4>
                <div className="space-y-2">
                  {suggestedOrders.imaging_orders.map((order, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-teal-200"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h5 className="font-medium text-sm mb-1">
                            {order.study_type} - {order.body_part}
                          </h5>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            <strong>Indication:</strong> {order.rationale}
                          </p>
                          <Badge variant="outline">{order.urgency}</Badge>
                          {order.icd10_codes?.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {order.icd10_codes.map((code, cIdx) => (
                                <Badge key={cIdx} variant="outline" className="text-xs">
                                  {code}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyOrderText(order, 'Imaging Order')}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Referrals */}
            {suggestedOrders.referrals?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-teal-900 dark:text-teal-300">
                  👨‍⚕️ Specialist Referrals
                </h4>
                <div className="space-y-2">
                  {suggestedOrders.referrals.map((order, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-teal-200"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h5 className="font-medium text-sm mb-1">{order.specialty}</h5>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            <strong>Reason:</strong> {order.reason}
                          </p>
                          <p className="text-xs text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900 p-2 rounded">
                            {order.key_findings}
                          </p>
                          <Badge className="mt-1" variant="outline">{order.urgency}</Badge>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyOrderText(order, 'Referral')}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DME Orders */}
            {suggestedOrders.dme_orders?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-teal-900 dark:text-teal-300">
                  🦽 DME Orders
                </h4>
                <div className="space-y-2">
                  {suggestedOrders.dme_orders.map((order, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-teal-200"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h5 className="font-medium text-sm mb-1">{order.equipment}</h5>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            <strong>Indication:</strong> {order.indication}
                          </p>
                          <p className="text-xs text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900 p-2 rounded">
                            Medical Necessity: {order.medical_necessity}
                          </p>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyOrderText(order, 'DME Order')}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6">
            <ClipboardList className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">
              Complete your note to receive order suggestions
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}