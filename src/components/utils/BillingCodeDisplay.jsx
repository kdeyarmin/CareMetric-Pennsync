import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getBillingCodes,
  getProviderBillingRequirements,
  getTelehealthModifier,
  HOME_HEALTH_BILLING_NOTES,
  TELEHEALTH_BILLING_NOTES
} from '@/utils/billingCodeMapping';

/**
 * BillingCodeDisplay Component
 * Displays relevant billing codes based on care setting, visit type, and provider role
 */
export default function BillingCodeDisplay({
  careSetting,
  visitType,
  providerType,
  compact = false
}) {
  if (!careSetting || !visitType || !providerType) {
    return null;
  }

  const billingInfo = getBillingCodes(careSetting, visitType);
  const providerBilling = getProviderBillingRequirements(providerType);
  const isTelehealth = careSetting === 'telehealth';
  const isHomeHealth = careSetting === 'home_health';

  if (!billingInfo || !providerBilling) {
    return null;
  }

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-600 dark:text-slate-400">Billing Code:</span>
          <Badge variant="outline" className="font-mono">{billingInfo.code}</Badge>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{billingInfo.description}</p>
      </div>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Billing Information
          <Badge variant="secondary" className="ml-auto">{billingInfo.type}</Badge>
        </CardTitle>
        <CardDescription>{billingInfo.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Primary Billing Code */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Primary Code
          </label>
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
            <code className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 flex-1">
              {billingInfo.code}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleCopyCode(billingInfo.code)}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Duration/Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Duration/Unit</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {billingInfo.duration}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Code Type</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {billingInfo.type}
            </p>
          </div>
        </div>

        {/* Notes */}
        {billingInfo.notes && (
          <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-lg border-l-4 border-blue-400">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Billing Notes
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-300">{billingInfo.notes}</p>
          </div>
        )}

        {/* Provider Billing Requirements */}
        {providerBilling && (
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {providerType} Billing Authority
            </p>
            <div className="flex items-start gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded">
              <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-700 dark:text-slate-300">
                {providerBilling.billingNote}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {providerBilling.canBillInd && (
                <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                  Can Bill Independently
                </Badge>
              )}
              {providerBilling.supervisesOtherBills && (
                <Badge variant="secondary">Supervises Billing</Badge>
              )}
              {providerBilling.requiresAssessment && (
                <Badge variant="outline">Assessment Required</Badge>
              )}
            </div>
          </div>
        )}

        {/* Telehealth Modifier */}
        {isTelehealth && (
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Telehealth Modifier
            </p>
            {(() => {
              const modifier = getTelehealthModifier(visitType);
              return (
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                  <code className="text-lg font-mono font-bold text-purple-600 dark:text-purple-400">
                    {modifier.code}
                  </code>
                  <div className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                    <p>{modifier.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopyCode(modifier.code)}
                    className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              );
            })()}
            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
              {Object.entries(TELEHEALTH_BILLING_NOTES).map(([key, note]) => (
                <p key={key}>• {note}</p>
              ))}
            </div>
          </div>
        )}

        {/* Home Health Specific Notes */}
        {isHomeHealth && (
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Home Health Requirements
            </p>
            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
              {Object.entries(HOME_HEALTH_BILLING_NOTES).map(([key, note]) => (
                <li key={key}>• {note}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}