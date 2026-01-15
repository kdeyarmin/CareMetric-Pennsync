import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lightbulb, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function ICD10CodeSuggester({ clinicalNotes, onCodeSelected }) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  const handleSuggestCodes = async () => {
    if (!clinicalNotes?.trim()) {
      toast.error('Please add clinical notes first');
      return;
    }

    setIsLoading(true);
    try {
      const response = await base44.functions.invoke('aiClinicalDecisionSupport', {
        action: 'suggestICD10',
        clinicalNotes
      });

      setSuggestions(response.data.suggestions || []);
      toast.success('ICD-10 codes suggested');
    } catch (error) {
      toast.error('Failed to suggest codes');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success('Code copied');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const confidenceColor = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-orange-100 text-orange-800'
  };

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="w-5 h-5 text-blue-600" />
          ICD-10 Code Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handleSuggestCodes}
          disabled={isLoading || !clinicalNotes?.trim()}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing notes...
            </>
          ) : (
            'Suggest ICD-10 Codes'
          )}
        </Button>

        {suggestions.length > 0 && (
          <div className="space-y-3">
            {suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className="border rounded-lg p-3 space-y-2 hover:bg-blue-50 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono font-bold text-blue-700 text-lg">
                        {suggestion.code}
                      </code>
                      <Badge className={confidenceColor[suggestion.confidence?.toLowerCase()]}>
                        {suggestion.confidence}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{suggestion.description}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleCopyCode(suggestion.code)}
                    title="Copy code"
                  >
                    {copiedCode === suggestion.code ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>

                <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                  <span className="font-semibold">Rationale:</span> {suggestion.rationale}
                </p>

                <p className="text-xs text-gray-600">
                  <span className="font-semibold">Billing Impact:</span> {suggestion.billing_impact}
                </p>

                {onCodeSelected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => onCodeSelected(suggestion.code)}
                  >
                    Select This Code
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}