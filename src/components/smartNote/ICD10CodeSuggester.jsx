import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, Copy, Plus, Zap } from "lucide-react";
import { toast } from "sonner";

export default function ICD10CodeSuggester({ noteContent, diagnosis, visitType, onCodesSelected }) {
  const [suggestedCodes, setSuggestedCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState([]);

  useEffect(() => {
    if (noteContent && diagnosis && noteContent.length > 50) {
      suggestCodes();
    }
  }, [noteContent, diagnosis]);

  const suggestCodes = async () => {
    if (!noteContent || noteContent.length < 50) return;
    
    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestICD10CodesFromNote', {
        note_content: noteContent,
        primary_diagnosis: diagnosis,
        visit_type: visitType
      });

      const codes = response.data?.suggested_codes || response.suggested_codes || [];
      setSuggestedCodes(codes);
      
      if (codes.length === 0) {
        toast.info('No additional ICD-10 codes found');
      }
    } catch (error) {
      console.error('Error suggesting codes:', error);
      toast.error('Failed to suggest ICD-10 codes');
    } finally {
      setLoading(false);
    }
  };

  const toggleCodeSelection = (code) => {
    setSelectedCodes(prev => 
      prev.find(c => c.code === code.code) 
        ? prev.filter(c => c.code !== code.code)
        : [...prev, code]
    );
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Code copied!');
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            ICD-10 Code Suggestions
          </CardTitle>
          <Button
            onClick={suggestCodes}
            disabled={loading || !noteContent || noteContent.length < 50}
            size="sm"
            variant="outline"
            className="h-8"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-4 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span className="text-sm text-gray-600">Analyzing note for codes...</span>
          </div>
        ) : suggestedCodes.length > 0 ? (
          <>
            <div className="space-y-2">
              {suggestedCodes.map((code) => (
                <div
                  key={code.code}
                  className={`p-3 border rounded-lg cursor-pointer transition-all ${
                    selectedCodes.find(c => c.code === code.code)
                      ? 'bg-blue-100 border-blue-400'
                      : 'bg-white border-gray-200 hover:border-blue-300'
                  }`}
                  onClick={() => toggleCodeSelection(code)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-600 text-white font-mono text-xs whitespace-nowrap">
                          {code.code}
                        </Badge>
                        <span className="text-xs font-medium text-gray-700">{code.description}</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{code.category}</p>
                      {code.relevance && (
                        <div className="mt-1 text-xs">
                          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            Relevance: {code.relevance}%
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(`${code.code} - ${code.description}`);
                      }}
                      className="h-7 w-7 p-0 flex-shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {selectedCodes.length > 0 && (
              <div className="pt-3 border-t space-y-3">
                <div className="bg-blue-100 p-2 rounded text-sm text-blue-900">
                  <strong>{selectedCodes.length}</strong> code(s) selected
                </div>
                <Button
                  onClick={() => {
                    onCodesSelected?.(selectedCodes);
                    setSelectedCodes([]);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="sm"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Selected Codes
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-600 text-center py-4">
            No additional ICD-10 codes suggested
          </div>
        )}
      </CardContent>
    </Card>
  );
}