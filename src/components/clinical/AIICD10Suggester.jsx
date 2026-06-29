import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, CheckCircle2, FileText } from "lucide-react";

export default function AIICD10Suggester({ onCodesSelected }) {
  const [searchQuery, setSearchQuery] = useState("");
  const ai = useAICall();
  const [suggestedCodes, setSuggestedCodes] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState([]);

  const searchCodes = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert in ICD-10 medical coding. Based on the following clinical description, suggest the most appropriate ICD-10 codes:

CLINICAL DESCRIPTION:
${searchQuery}

Provide specific ICD-10 codes with full descriptions. Include:
- Primary diagnosis codes
- Secondary/comorbidity codes if applicable
- Codes for complications or manifestations

For each code provide:
- The exact ICD-10 code (e.g., I50.9, E11.65, etc.)
- Full clinical description
- Category (primary, secondary, or complication)
- Clinical justification for why this code is appropriate

Return 5-10 most relevant codes, prioritized by relevance and specificity.`,
        response_json_schema: {
          type: "object",
          properties: {
            codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  category: { type: "string" },
                  justification: { type: "string" },
                  specificity_level: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestedCodes(result.codes || []);
    } catch (error) {
      console.error("Error searching ICD-10 codes:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchCodes();
    }
  };

  const toggleCodeSelection = (code) => {
    if (selectedCodes.find(c => c.code === code.code)) {
      setSelectedCodes(selectedCodes.filter(c => c.code !== code.code));
    } else {
      setSelectedCodes([...selectedCodes, code]);
    }
  };

  const applySelectedCodes = () => {
    onCodesSelected?.(selectedCodes);
  };

  const getCategoryColor = (category) => {
    const lower = category?.toLowerCase() || '';
    if (lower.includes('primary')) return 'bg-blue-100 text-blue-800';
    if (lower.includes('secondary') || lower.includes('comorbidity')) return 'bg-navy-100 text-navy-800';
    if (lower.includes('complication')) return 'bg-orange-100 text-orange-800';
    return 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-indigo-200">
        <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-indigo-600" />
            AI ICD-10 Code Suggester
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter clinical description (e.g., 'patient with heart failure and diabetes')"
              className="flex-1"
            />
            <Button
              onClick={searchCodes}
              disabled={ai.loading || !searchQuery.trim()}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>

          {selectedCodes.length > 0 && (
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-green-900">
                  Selected Codes ({selectedCodes.length})
                </p>
                <Button
                  size="sm"
                  onClick={applySelectedCodes}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Apply Codes
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedCodes.map((code, idx) => (
                  <Badge key={idx} className="bg-green-600 text-white">
                    {code.code}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {suggestedCodes.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <p className="text-sm font-semibold text-slate-700">
                AI Suggested ICD-10 Codes:
              </p>
              {suggestedCodes.map((codeItem, idx) => {
                const isSelected = selectedCodes.find(c => c.code === codeItem.code);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                    onClick={() => toggleCodeSelection(codeItem)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-indigo-600 text-white font-mono">
                          {codeItem.code}
                        </Badge>
                        <Badge className={getCategoryColor(codeItem.category)}>
                          {codeItem.category}
                        </Badge>
                        {codeItem.specificity_level && (
                          <Badge variant="outline" className="text-xs">
                            {codeItem.specificity_level}
                          </Badge>
                        )}
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-900 mb-1">
                      {codeItem.description}
                    </p>
                    <p className="text-xs text-slate-600">
                      {codeItem.justification}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {!ai.loading && suggestedCodes.length === 0 && searchQuery && (
            <p className="text-sm text-slate-500 text-center py-4">
              No results. Try a different clinical description.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}