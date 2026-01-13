import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function AIBillingCodeSuggester({ visitType, diagnosis, clinicalNote, onCodesSelected }) {
  const [suggestedCodes, setSuggestedCodes] = useState(null);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const suggestCodes = async () => {
    if (!visitType || !diagnosis) {
      toast.error('Please provide visit type and diagnosis');
      return;
    }

    setIsLoading(true);
    try {
      const prompt = `You are a medical billing expert. Suggest appropriate CPT and HCPCS billing codes for the following:

Visit Type: ${visitType.replace(/_/g, ' ')}
Diagnosis: ${diagnosis}
${clinicalNote ? `Clinical Note Content: ${clinicalNote.substring(0, 500)}...` : ''}

Provide 2-3 most relevant billing codes with brief descriptions. Format as JSON array with objects containing:
- code: the billing code (CPT or HCPCS)
- description: brief description of what this code represents
- amount: typical amount billed for this code (estimate)
- relevance: confidence level (high, medium, or low)

Return ONLY valid JSON array, no other text.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            codes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  description: { type: 'string' },
                  amount: { type: 'number' },
                  relevance: { type: 'string' }
                }
              }
            }
          }
        }
      });

      const codes = result.codes || [];
      setSuggestedCodes(codes);
      setSelectedCodes([codes[0]?.code || '']);
      setExpanded(true);
      toast.success('Billing codes suggested');
    } catch (error) {
      toast.error('Failed to generate code suggestions');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCodeSelection = (code) => {
    setSelectedCodes(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    );
  };

  const handleConfirm = () => {
    if (selectedCodes.length === 0) {
      toast.error('Please select at least one billing code');
      return;
    }
    onCodesSelected?.(selectedCodes, suggestedCodes);
    setExpanded(false);
  };

  return (
    <Card className="border-purple-200 bg-purple-50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Billing Code Suggester
          </div>
          {suggestedCodes && (
            <Badge className="bg-green-100 text-green-800">
              {suggestedCodes.length} suggestions
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!expanded ? (
          <Button
            onClick={suggestCodes}
            disabled={isLoading || !visitType || !diagnosis}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Visit & Diagnosis...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Suggest Billing Codes
              </>
            )}
          </Button>
        ) : suggestedCodes && suggestedCodes.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {suggestedCodes.map((codeObj, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-3 cursor-pointer hover:bg-white transition"
                  onClick={() => toggleCodeSelection(codeObj.code)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedCodes.includes(codeObj.code)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleCodeSelection(codeObj.code);
                      }}
                      className="w-4 h-4 mt-1 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{codeObj.code}</span>
                        <Badge
                          className={`text-xs ${
                            codeObj.relevance === 'high'
                              ? 'bg-green-100 text-green-800'
                              : codeObj.relevance === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {codeObj.relevance}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{codeObj.description}</p>
                      <p className="text-xs text-gray-500">
                        Est. Amount: ${codeObj.amount?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setExpanded(false);
                  setSuggestedCodes(null);
                  setSelectedCodes([]);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-purple-600 hover:bg-purple-700"
                onClick={handleConfirm}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Confirm Selection
              </Button>
            </div>
          </div>
        ) : null}

        {expanded && !suggestedCodes && !isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <AlertCircle className="w-4 h-4" />
            No suggestions available
          </div>
        )}
      </CardContent>
    </Card>
  );
}