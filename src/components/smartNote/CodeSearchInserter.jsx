import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Code, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function CodeSearchInserter({ onInsertCode, noteType = "rough" }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [codeType, setCodeType] = useState("icd10"); // icd10 or cpt

  const searchCodes = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setSearching(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical coding expert. Search for ${codeType.toUpperCase()} codes related to: "${searchQuery}"

Return a JSON array of up to 10 relevant codes with this exact structure:
[
  {
    "code": "string (the actual code)",
    "description": "string (full description)",
    "category": "string (category/chapter)"
  }
]

Be accurate and only include real, valid ${codeType.toUpperCase()} codes.`,
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
                  category: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSearchResults(response.codes || []);
      if (!response.codes || response.codes.length === 0) {
        toast.info("No codes found for this search");
      }
    } catch (error) {
      console.error('Error searching codes:', error);
      toast.error("Failed to search codes");
    } finally {
      setSearching(false);
    }
  };

  const insertCode = (code) => {
    const formattedCode = `${code.code} - ${code.description}`;
    onInsertCode(formattedCode);
    toast.success("Code inserted");
  };

  return (
    <Card className="border-indigo-300 bg-indigo-50 dark:bg-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="w-5 h-5 text-indigo-600" />
          Medical Code Search & Insert
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Code Type Toggle */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={codeType === "icd10" ? "default" : "outline"}
            onClick={() => {
              setCodeType("icd10");
              setSearchResults([]);
            }}
            className={codeType === "icd10" ? "bg-indigo-600" : ""}
          >
            ICD-10
          </Button>
          <Button
            size="sm"
            variant={codeType === "cpt" ? "default" : "outline"}
            onClick={() => {
              setCodeType("cpt");
              setSearchResults([]);
            }}
            className={codeType === "cpt" ? "bg-indigo-600" : ""}
          >
            CPT
          </Button>
        </div>

        {/* Search Input */}
        <div className="flex gap-2">
          <Input
            placeholder={`Search ${codeType.toUpperCase()} codes... (e.g., "diabetes", "chest pain")`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && searchCodes()}
            className="flex-1"
          />
          <Button
            onClick={searchCodes}
            disabled={searching}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {searchResults.map((result, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-indigo-600 text-white font-mono text-xs">
                        {result.code}
                      </Badge>
                      {result.category && (
                        <Badge variant="outline" className="text-xs">
                          {result.category}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100">
                      {result.description}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => insertCode(result)}
                    className="bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Insert
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchResults.length === 0 && !searching && (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
            <Code className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Search for ICD-10 or CPT codes above</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}