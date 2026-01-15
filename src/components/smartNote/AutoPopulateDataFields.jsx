import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, CheckCircle2, Copy, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export default function AutoPopulateDataFields({ 
  narrative, 
  dataType = 'vital_signs', 
  patientId,
  visitType,
  onDataExtracted 
}) {
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [error, setError] = useState(null);

  const handleExtract = async () => {
    if (!narrative || narrative.trim().length < 20) {
      setError('Please provide more narrative text to extract data from');
      return;
    }

    setExtracting(true);
    setError(null);

    try {
      const { extractStructuredDataFromNarrative } = await import('@/functions/extractStructuredDataFromNarrative');
      const response = await extractStructuredDataFromNarrative({
        narrative,
        data_type: dataType,
        patient_id: patientId,
        visit_type: visitType
      });

      setExtractedData(response.data.extracted_data);
      
      if (onDataExtracted) {
        onDataExtracted(response.data.extracted_data);
      }
    } catch (err) {
      setError(err.message || 'Failed to extract data');
    } finally {
      setExtracting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const getFieldLabel = (key) => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <Card className="border-l-4 border-l-purple-600">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Auto-Populate Fields
          </CardTitle>
          <Button
            size="sm"
            onClick={handleExtract}
            disabled={extracting || !narrative}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {extracting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Extract Data
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {!extractedData && !extracting && (
          <div className="text-center py-6">
            <Sparkles className="w-12 h-12 text-purple-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Click "Extract Data" to automatically populate {dataType.replace(/_/g, ' ')} from your narrative
            </p>
          </div>
        )}

        {extractedData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Extracted {Object.keys(extractedData).length} fields
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(extractedData).map(([key, value]) => (
                <div 
                  key={key}
                  className="bg-purple-50 dark:bg-purple-950 rounded-lg p-3 border border-purple-200 dark:border-purple-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-purple-900 dark:text-purple-100 mb-1">
                        {getFieldLabel(key)}
                      </p>
                      <p className="text-sm text-gray-900 dark:text-white font-medium">
                        {Array.isArray(value) ? value.join(', ') : value}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(String(value))}
                      className="flex-shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExtractedData(null);
                setError(null);
              }}
              className="w-full mt-3"
            >
              Clear Results
            </Button>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}