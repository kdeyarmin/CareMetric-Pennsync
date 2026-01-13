import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle } from 'lucide-react';
import {
  CARE_SETTINGS,
  CARE_SETTING_LABELS,
  VISIT_TYPES_BY_SETTING,
  PROVIDER_VISIT_TYPES,
  getVisitTypesForProvider,
  getCareSettingLabel,
} from '@/components/utils/providerVisitTypeMapping';
import BillingCodeDisplay from '@/components/utils/BillingCodeDisplay';

/**
 * VisitTypeSelector Component
 * Cascading selector for care setting → provider type → visit type
 * Dynamically filters options based on selections
 */
export default function VisitTypeSelector({
  onSelectionChange,
  defaultCareSetting = null,
  defaultProviderType = null,
  defaultVisitType = null,
  showBillingCodes = true,
  disabled = false,
}) {
  const [careSetting, setCareSetting] = useState(defaultCareSetting);
  const [providerType, setProviderType] = useState(defaultProviderType);
  const [visitType, setVisitType] = useState(defaultVisitType);

  // Get all available care settings
  const availableCareSettings = Object.keys(CARE_SETTINGS).map(key => CARE_SETTINGS[key]);

  // Get provider types that can access the selected care setting
  const availableProviders = useMemo(() => {
    if (!careSetting) return [];
    return Object.entries(PROVIDER_VISIT_TYPES)
      .filter(([_, config]) => config.canAccessSettings?.includes(careSetting))
      .map(([type, _]) => type);
  }, [careSetting]);

  // Get visit types for selected care setting and provider type
  const availableVisitTypes = useMemo(() => {
    if (!careSetting || !providerType) return [];
    return getVisitTypesForProvider(providerType, careSetting);
  }, [careSetting, providerType]);

  // Reset dependent selections when parent changes
  const handleCareSettingChange = (newSetting) => {
    setCareSetting(newSetting);
    setProviderType(null);
    setVisitType(null);
    onSelectionChange?.({
      careSetting: newSetting,
      providerType: null,
      visitType: null,
    });
  };

  const handleProviderTypeChange = (newProvider) => {
    setProviderType(newProvider);
    setVisitType(null);
    onSelectionChange?.({
      careSetting,
      providerType: newProvider,
      visitType: null,
    });
  };

  const handleVisitTypeChange = (newVisitType) => {
    setVisitType(newVisitType);
    onSelectionChange?.({
      careSetting,
      providerType,
      visitType: newVisitType,
    });
  };

  const selectedCareSettingLabel = careSetting ? getCareSettingLabel(careSetting) : null;
  const selectedProviderConfig = providerType ? PROVIDER_VISIT_TYPES[providerType] : null;

  return (
    <div className="space-y-6">
      {/* Care Setting Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Select Care Setting</CardTitle>
          <CardDescription>
            Choose the care location or type of service delivery
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={careSetting || ''} onValueChange={handleCareSettingChange} disabled={disabled}>
            <SelectTrigger>
              <SelectValue placeholder="Choose care setting..." />
            </SelectTrigger>
            <SelectContent>
              {availableCareSettings.map(setting => (
                <SelectItem key={setting} value={setting}>
                  {CARE_SETTING_LABELS[setting]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Provider Type Selection */}
      {careSetting && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Select Provider Type</CardTitle>
            <CardDescription>
              Choose the healthcare provider for this visit ({availableProviders.length} options available)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {availableProviders.length > 0 ? (
              <Select
                value={providerType || ''}
                onValueChange={handleProviderTypeChange}
                disabled={disabled || !careSetting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose provider type..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.map(provider => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_VISIT_TYPES[provider].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No providers available for {selectedCareSettingLabel}
                </p>
              </div>
            )}

            {/* Provider Capabilities */}
            {selectedProviderConfig && (
              <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">
                  Provider Capabilities
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedProviderConfig.requiresAssessment && (
                    <Badge variant="outline">Assessment Required</Badge>
                  )}
                  {selectedProviderConfig.canEstablishCarePlan && (
                    <Badge variant="secondary">Establish Care Plans</Badge>
                  )}
                  {selectedProviderConfig.canOversee && (
                    <Badge variant="secondary">Oversee Care</Badge>
                  )}
                  {selectedProviderConfig.canPrescribe && (
                    <Badge className="bg-green-600 hover:bg-green-700">Can Prescribe</Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Visit Type Selection */}
      {careSetting && providerType && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Select Visit Type</CardTitle>
            <CardDescription>
              Choose the specific type of visit ({availableVisitTypes.length} options available)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {availableVisitTypes.length > 0 ? (
              <>
                <Select value={visitType || ''} onValueChange={handleVisitTypeChange} disabled={disabled}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose visit type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVisitTypes.map(vt => (
                      <SelectItem key={vt.id} value={vt.id}>
                        {vt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Visit Type Description */}
                {visitType && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {availableVisitTypes.find(vt => vt.id === visitType)?.description}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No visit types available for this combination
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Billing Information */}
      {showBillingCodes && careSetting && providerType && visitType && (
        <BillingCodeDisplay
          careSetting={careSetting}
          visitType={visitType}
          providerType={providerType}
        />
      )}

      {/* Selection Summary */}
      {careSetting && providerType && visitType && (
        <Card className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="text-base">Visit Configuration Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">Care Setting</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {selectedCareSettingLabel}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">Provider Type</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {selectedProviderConfig?.label}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">Visit Type</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {availableVisitTypes.find(vt => vt.id === visitType)?.label}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}