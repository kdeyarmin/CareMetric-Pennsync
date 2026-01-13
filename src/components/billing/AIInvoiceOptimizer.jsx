import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Check, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function AIInvoiceOptimizer({ visit, lineItems, onSuggestionsApply }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  const analyzeInvoice = async () => {
    setAnalyzing(true);

    try {
      const prompt = `As a medical billing expert, analyze this home health visit and optimize the invoice line items for maximum accuracy and reimbursement:

Visit Type: ${visit.visit_type}
Visit Date: ${visit.visit_date}
Visit Notes: ${visit.nurse_notes?.substring(0, 500) || 'N/A'}
Vital Signs: ${JSON.stringify(visit.vital_signs || {})}

Current Line Items:
${JSON.stringify(lineItems, null, 2)}

Provide:
1. Optimized line items with accurate CPT codes
2. Potential additional billable services that may have been missed
3. Coding optimization suggestions
4. Estimated reimbursement improvement percentage

Return detailed recommendations.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            optimized_line_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  service_code: { type: "string" },
                  quantity: { type: "number" },
                  unit_price: { type: "number" },
                  justification: { type: "string" }
                }
              }
            },
            additional_billable_services: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  service: { type: "string" },
                  code: { type: "string" },
                  estimated_value: { type: "number" },
                  reason: { type: "string" }
                }
              }
            },
            coding_suggestions: {
              type: "array",
              items: { type: "string" }
            },
            estimated_improvement: { type: "number" },
            total_optimized_value: { type: "number" }
          }
        }
      });

      setSuggestions(response);
      toast.success("Analysis complete!");

    } catch (error) {
      toast.error(`Analysis failed: ${error.message}`);
    }

    setAnalyzing(false);
  };

  const applyOptimizations = () => {
    if (suggestions?.optimized_line_items) {
      const optimizedItems = suggestions.optimized_line_items.map(item => ({
        description: item.description,
        service_code: item.service_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price
      }));
      onSuggestionsApply(optimizedItems);
      toast.success("Optimized line items applied!");
    }
  };

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Invoice Optimizer
          </CardTitle>
          {!suggestions && (
            <Button
              onClick={analyzeInvoice}
              disabled={analyzing}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Optimize Invoice
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      {suggestions && (
        <CardContent className="space-y-4">
          {/* Improvement Summary */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Estimated Improvement</div>
                <div className="text-2xl font-bold text-purple-600">
                  +{suggestions.estimated_improvement}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-600 dark:text-gray-400">Optimized Value</div>
                <div className="text-2xl font-bold text-green-600">
                  ${suggestions.total_optimized_value?.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Optimized Line Items */}
          {suggestions.optimized_line_items?.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold text-sm">Optimized Line Items</h4>
                <Button size="sm" onClick={applyOptimizations}>
                  <Check className="w-4 h-4 mr-1" />
                  Apply Changes
                </Button>
              </div>
              <div className="space-y-2">
                {suggestions.optimized_line_items.map((item, idx) => (
                  <div key={idx} className="border p-3 rounded-lg bg-white dark:bg-slate-900">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium">{item.description}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Code: {item.service_code} | Qty: {item.quantity} | ${item.unit_price}
                        </div>
                        <div className="text-xs text-purple-600 mt-1 italic">
                          {item.justification}
                        </div>
                      </div>
                      <div className="font-semibold text-green-600">
                        ${(item.quantity * item.unit_price).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additional Billable Services */}
          {suggestions.additional_billable_services?.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                Potentially Missed Services
              </h4>
              <div className="space-y-2">
                {suggestions.additional_billable_services.map((service, idx) => (
                  <div key={idx} className="border border-green-200 dark:border-green-800 p-3 rounded-lg bg-green-50 dark:bg-green-950">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-green-900 dark:text-green-100">
                          {service.service}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">
                          Code: {service.code}
                        </div>
                        <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                          {service.reason}
                        </div>
                      </div>
                      <Badge className="bg-green-600 text-white">
                        +${service.estimated_value?.toFixed(2)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coding Suggestions */}
          {suggestions.coding_suggestions?.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Coding Best Practices</h4>
              <ul className="space-y-1">
                {suggestions.coding_suggestions.map((suggestion, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                    <Check className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSuggestions(null)}
            className="w-full"
          >
            Run New Analysis
          </Button>
        </CardContent>
      )}
    </Card>
  );
}