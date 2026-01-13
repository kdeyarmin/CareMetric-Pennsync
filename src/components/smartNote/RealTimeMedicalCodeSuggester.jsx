import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Copy, Check, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function RealTimeMedicalCodeSuggester({ noteContent, diagnosis, onCodeSelect }) {
  const [suggestedCodes, setSuggestedCodes] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  useEffect(() => {
    if (noteContent && noteContent.length > 100) {
      const debounce = setTimeout(() => {
        analyzeCodes();
      }, 2000);
      return () => clearTimeout(debounce);
    }
  }, [noteContent, diagnosis]);

  const analyzeCodes = async () => {
    setIsAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clinical note and suggest the most appropriate medical codes:

Note Content: ${noteContent}
${diagnosis ? `Primary Diagnosis: ${diagnosis}` : ''}

Provide ICD-10 codes for diagnoses and CPT codes for any procedures/services documented.
Return JSON with code suggestions.`,
        response_json_schema: {
          type: "object",
          properties: {
            icd10_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  confidence: { type: "string" }
                }
              }
            },
            cpt_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  confidence: { type: "string" }
                }
              }
            },
            rationale: { type: "string" }
          }
        }
      });

      setSuggestedCodes(response);
    } catch (error) {
      console.error("Error analyzing codes:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Copied ${code}`);
    setTimeout(() => setCopiedCode(null), 2000);
    if (onCodeSelect) onCodeSelect(code);
  };

  if (!noteContent || noteContent.length < 100) return null;

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <CardTitle className="text-base">Medical Code Suggestions</CardTitle>
          </div>
          {isAnalyzing && (
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-emerald-600 border-t-transparent" />
              Analyzing...
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {suggestedCodes?.icd10_codes && suggestedCodes.icd10_codes.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm text-emerald-900 mb-2">ICD-10 Codes</h4>
            <div className="space-y-2">
              {suggestedCodes.icd10_codes.map((code, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-white/60 rounded-lg p-3 flex items-start justify-between gap-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-bold text-emerald-700">{code.code}</code>
                      <Badge variant="outline" className="text-xs">
                        {code.confidence}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-700">{code.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopyCode(code.code)}
                    className="shrink-0"
                  >
                    {copiedCode === code.code ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {suggestedCodes?.cpt_codes && suggestedCodes.cpt_codes.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm text-emerald-900 mb-2">CPT Codes</h4>
            <div className="space-y-2">
              {suggestedCodes.cpt_codes.map((code, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-white/60 rounded-lg p-3 flex items-start justify-between gap-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-bold text-teal-700">{code.code}</code>
                      <Badge variant="outline" className="text-xs">
                        {code.confidence}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-700">{code.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopyCode(code.code)}
                    className="shrink-0"
                  >
                    {copiedCode === code.code ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {suggestedCodes?.rationale && (
          <div className="bg-emerald-100/50 rounded-lg p-3 border border-emerald-200">
            <p className="text-xs text-emerald-900">
              <Sparkles className="w-3 h-3 inline mr-1" />
              <strong>AI Rationale:</strong> {suggestedCodes.rationale}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}