import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Copy, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function QuickPhraseInsert({
  patientDiagnosis,
  visitType,
  existingContent = "",
  onPhraseInsert = () => {}
}) {
  const [phrases, setPhrases] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!patientDiagnosis && !visitType) return;

    const timer = setTimeout(() => {
      generatePhrases();
    }, 1500);

    return () => clearTimeout(timer);
  }, [patientDiagnosis, visitType, existingContent]);

  const generatePhrases = async () => {
    setLoading(true);
    try {
      const prompt = `Generate 3-4 specific, concise clinical phrases that would be relevant for documentation in this scenario:

Patient Diagnosis: ${patientDiagnosis || 'Not specified'}
Visit Type: ${visitType || 'Not specified'}

Each phrase should be:
- 1-2 sentences maximum
- Specific to the diagnosis/visit type
- Ready to copy-paste into clinical notes
- Professional medical language

Return as JSON array of strings (just the phrases).`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "array",
          items: { type: "string" }
        }
      });

      setPhrases(response || []);
    } catch (error) {
      console.error('Failed to generate phrases:', error);
      setPhrases([]);
    } finally {
      setLoading(false);
    }
  };

  if (phrases.length === 0 && !loading) return null;

  return (
    <Card className="bg-gradient-to-r from-purple-50 to-purple-100 border-l-4 border-l-purple-500 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <p className="text-sm font-medium text-slate-900">Quick Phrases</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600 mr-2" />
            <span className="text-xs text-slate-600">Generating phrases...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {phrases.map((phrase, idx) => (
              <div
                key={idx}
                className="p-2 bg-white rounded border border-purple-200 flex items-start justify-between gap-2 hover:border-purple-400 transition-colors"
              >
                <p className="text-xs text-slate-700 flex-1">{phrase}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(phrase);
                    onPhraseInsert(phrase);
                    toast.success("Phrase copied to clipboard");
                  }}
                  className="h-6 w-6 flex-shrink-0"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}