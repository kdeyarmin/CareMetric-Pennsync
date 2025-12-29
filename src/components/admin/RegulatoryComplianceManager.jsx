import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Database,
  TrendingUp,
  Calendar
} from "lucide-react";
import { format } from "date-fns";

export default function RegulatoryComplianceManager() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState(null);

  const { data: complianceRules = [] } = useQuery({
    queryKey: ['complianceRules'],
    queryFn: () => base44.entities.ComplianceRule.list('-updated_date'),
    initialData: [],
  });

  const { data: regulatoryUpdates = [] } = useQuery({
    queryKey: ['regulatoryUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.list('-created_date', 10),
    initialData: [],
  });

  const handleSyncRegulations = async () => {
    setIsSyncing(true);
    setSyncResults(null);
    
    try {
      const result = await base44.functions.invoke('syncLatestCMSRegulations');
      
      setSyncResults(result);
      queryClient.invalidateQueries({ queryKey: ['complianceRules'] });
      queryClient.invalidateQueries({ queryKey: ['regulatoryUpdates'] });
    } catch (error) {
      console.error('Sync error:', error);
      setSyncResults({ 
        success: false, 
        error: error.message || 'Failed to sync regulations' 
      });
    }
    
    setIsSyncing(false);
  };

  const activeRules = complianceRules.filter(r => r.is_active);
  const criticalRules = activeRules.filter(r => r.severity === 'critical');
  const recentUpdates = regulatoryUpdates.filter(u => 
    new Date(u.created_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Card */}
      <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Regulatory Compliance Manager
            </CardTitle>
            <Button
              onClick={handleSyncRegulations}
              disabled={isSyncing}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto min-h-[44px]"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Syncing Latest Rules...
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4 mr-2" />
                  Sync Latest CMS Regulations
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-700">
            Automatically fetch and update Medicare compliance rules from live CMS sources using AI-powered analysis.
          </p>
          
          {syncResults && (
            <Alert className={syncResults.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}>
              {syncResults.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              )}
              <AlertDescription className="text-sm">
                {syncResults.success ? (
                  <div className="space-y-1">
                    <p className="font-semibold text-green-900">{syncResults.message}</p>
                    {syncResults.details && (
                      <div className="text-xs text-green-800 space-y-0.5">
                        <p>• New rules added: {syncResults.details.new_rules}</p>
                        <p>• Rules updated: {syncResults.details.updated_rules}</p>
                        <p>• Total processed: {syncResults.details.total_processed}</p>
                        <p>• Major 2025 changes: {syncResults.details.major_changes}</p>
                      </div>
                    )}
                    {syncResults.details?.summary && (
                      <p className="text-xs text-green-700 mt-2 italic">{syncResults.details.summary}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-red-900">{syncResults.error}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-[10px] sm:text-xs">Active Rules</p>
                <p className="text-xl sm:text-2xl font-bold">{activeRules.length}</p>
              </div>
              <Database className="w-6 h-6 sm:w-8 sm:h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white border-none">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-[10px] sm:text-xs">Critical Rules</p>
                <p className="text-xl sm:text-2xl font-bold">{criticalRules.length}</p>
              </div>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-[10px] sm:text-xs">Recent Updates</p>
                <p className="text-xl sm:text-2xl font-bold">{recentUpdates.length}</p>
              </div>
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-none">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-[10px] sm:text-xs">Last Sync</p>
                <p className="text-xs sm:text-sm font-medium">
                  {complianceRules[0]?.updated_date 
                    ? format(new Date(complianceRules[0].updated_date), 'MMM d')
                    : 'Never'}
                </p>
              </div>
              <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-purple-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Regulatory Updates */}
      {recentUpdates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
              Recent Regulatory Updates (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentUpdates.map((update) => (
              <div key={update.id} className="border-l-4 border-orange-400 bg-orange-50 p-3 sm:p-4 rounded">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                  <h4 className="font-semibold text-gray-900 text-sm sm:text-base break-words">{update.title}</h4>
                  <Badge className={`w-fit flex-shrink-0 ${
                    update.impact_level === 'critical' ? 'bg-red-600' :
                    update.impact_level === 'high' ? 'bg-orange-500' :
                    'bg-yellow-500'
                  }`}>
                    {update.impact_level}
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-gray-700 mb-2 break-words">{update.summary}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Effective: {update.effective_date}
                  </span>
                  <Badge variant="outline" className="text-xs">{update.source}</Badge>
                  <Badge variant="outline" className="text-xs">{update.category}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Active Rules Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Database className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            Active Compliance Rules ({activeRules.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {activeRules.slice(0, 20).map((rule) => (
              <div key={rule.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-medium text-sm text-gray-900 break-words">{rule.rule_name}</p>
                    <Badge variant="outline" className="text-xs flex-shrink-0">{rule.rule_code}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-1">{rule.description}</p>
                </div>
                <Badge className={`flex-shrink-0 w-fit ${
                  rule.severity === 'critical' ? 'bg-red-600' :
                  rule.severity === 'high' ? 'bg-orange-500' :
                  rule.severity === 'medium' ? 'bg-yellow-500' :
                  'bg-blue-500'
                }`}>
                  {rule.severity}
                </Badge>
              </div>
            ))}
            {activeRules.length > 20 && (
              <p className="text-xs text-gray-500 text-center py-2">
                and {activeRules.length - 20} more rules...
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}