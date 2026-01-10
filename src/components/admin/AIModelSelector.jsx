import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Zap, Info } from "lucide-react";

/**
 * Displays AI model selection recommendations based on provider type and task
 */
export default function AIModelSelector({ providerType, taskType, complexity = 'medium' }) {
  const { data: modelConfig, isLoading } = useQuery({
    queryKey: ['aiModelSelection', providerType, taskType, complexity],
    queryFn: async () => {
      const { selectOptimalAIModel } = await import('@/functions/selectOptimalAIModel');
      const response = await selectOptimalAIModel({
        taskType,
        providerType,
        complexity
      });
      return response.data;
    },
    enabled: !!providerType && !!taskType
  });

  if (!providerType || !taskType || isLoading) {
    return null;
  }

  if (!modelConfig?.config) {
    return null;
  }

  const { config, explanation } = modelConfig;

  return (
    <Alert className="bg-blue-50 border-blue-200">
      <Brain className="w-4 h-4 text-blue-600" />
      <AlertDescription>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900 mb-1">
              AI Configuration Optimized
            </p>
            <p className="text-xs text-blue-800">
              {explanation}
            </p>
          </div>
          <div className="flex gap-1">
            <Badge className="bg-blue-600 text-xs">
              {config.model}
            </Badge>
            <Badge variant="outline" className="text-xs">
              T: {config.temperature}
            </Badge>
          </div>
        </div>
        
        {config.features && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {config.features.useProviderSettings && (
              <Badge variant="outline" className="text-xs">Provider-Specific</Badge>
            )}
            {config.features.includeRegulatoryContext && (
              <Badge variant="outline" className="text-xs">Regulatory Context</Badge>
            )}
            {config.features.structuredOutput && (
              <Badge variant="outline" className="text-xs">Structured Output</Badge>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}