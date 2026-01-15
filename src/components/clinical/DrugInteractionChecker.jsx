import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function DrugInteractionChecker({ medications = [] }) {
  const [interactions, setInteractions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dismissedInteractions, setDismissedInteractions] = useState([]);

  useEffect(() => {
    if (medications.length >= 2) {
      checkInteractions();
    }
  }, [medications]);

  const checkInteractions = async () => {
    if (medications.length < 2) return;

    setIsLoading(true);
    try {
      const response = await base44.functions.invoke('aiClinicalDecisionSupport', {
        action: 'checkDrugInteractions',
        medications: medications.map(m => ({
          name: m.name,
          dosage: m.dosage || 'unknown',
          frequency: m.frequency || 'unknown'
        }))
      });

      setInteractions(response.data.interactions || []);
      if (response.data.interactions?.length > 0) {
        toast.warning(`${response.data.interactions.length} drug interaction(s) detected`);
      }
    } catch (error) {
      console.error('Drug interaction check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const severityConfig = {
    critical: { color: 'bg-red-100 text-red-800', icon: '🔴' },
    major: { color: 'bg-orange-100 text-orange-800', icon: '🟠' },
    moderate: { color: 'bg-yellow-100 text-yellow-800', icon: '🟡' },
    minor: { color: 'bg-blue-100 text-blue-800', icon: '🔵' }
  };

  const filteredInteractions = interactions.filter(i => !dismissedInteractions.includes(`${i.drug1}-${i.drug2}`));

  if (filteredInteractions.length === 0) {
    return null;
  }

  return (
    <Card className="border-l-4 border-l-red-500 bg-red-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Drug Interactions ({filteredInteractions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {filteredInteractions.map((interaction, idx) => {
          const severity = interaction.severity?.toLowerCase() || 'moderate';
          const config = severityConfig[severity] || severityConfig.moderate;

          return (
            <div
              key={idx}
              className={`border-2 rounded-lg p-4 space-y-2 ${config.color}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{config.icon}</span>
                    <Badge className={config.color} variant="outline">
                      {severity.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="font-semibold text-sm">
                    {interaction.drug1} ↔ {interaction.drug2}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <p className="font-semibold">Mechanism:</p>
                  <p className="text-gray-700">{interaction.mechanism}</p>
                </div>

                <div>
                  <p className="font-semibold">Clinical Recommendation:</p>
                  <p className="text-gray-700">{interaction.recommendation}</p>
                </div>

                <div>
                  <p className="font-semibold">Monitoring:</p>
                  <p className="text-gray-700">{interaction.monitoring}</p>
                </div>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => setDismissedInteractions([...dismissedInteractions, `${interaction.drug1}-${interaction.drug2}`])}
              >
                Acknowledge & Dismiss
              </Button>
            </div>
          );
        })}

        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          onClick={checkInteractions}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Rechecking...
            </>
          ) : (
            'Recheck Interactions'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}