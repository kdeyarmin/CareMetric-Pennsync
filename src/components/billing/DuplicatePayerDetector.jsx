import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Trash2, CheckCircle, AlertTriangle, Users } from "lucide-react";
import { toast } from "sonner";

export default function DuplicatePayerDetector() {
  const [loading, setLoading] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [mergingGroup, setMergingGroup] = useState(null);
  const queryClient = useQueryClient();

  const detectDuplicates = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('detectDuplicatePayers', {});
      setDuplicateGroups(response.data.duplicate_groups || []);
      
      if (response.data.duplicate_groups.length === 0) {
        toast.success('No duplicates found - database is clean!');
      } else {
        toast.warning(`Found ${response.data.duplicate_groups.length} potential duplicate groups`);
      }
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      toast.error('Failed to detect duplicates');
    } finally {
      setLoading(false);
    }
  };

  const mergePayers = async (group) => {
    setMergingGroup(group.primary_payer.id);
    try {
      // Update primary payer with merged data
      await base44.entities.Payer.update(group.primary_payer.id, group.merged_data_preview);

      // Delete duplicate payers
      for (const dup of group.duplicates) {
        await base44.entities.Payer.delete(dup.id);
      }

      toast.success(`Merged ${group.duplicates.length} duplicate(s) into primary payer`);
      
      // Remove from list
      setDuplicateGroups(prev => prev.filter(g => g.primary_payer.id !== group.primary_payer.id));
      
      // Refresh payer list
      queryClient.invalidateQueries(['payers']);
    } catch (error) {
      console.error('Error merging:', error);
      toast.error('Failed to merge payers');
    } finally {
      setMergingGroup(null);
    }
  };

  const dismissGroup = (groupId) => {
    setDuplicateGroups(prev => prev.filter(g => g.primary_payer.id !== groupId));
    toast.info('Duplicate group dismissed');
  };

  const getConfidenceColor = (score) => {
    if (score >= 90) return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
    if (score >= 75) return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
  };

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Copy className="w-5 h-5 text-purple-600" />
          AI Duplicate Detection
        </CardTitle>
        <CardDescription>
          Identify and merge potential duplicate payer entries using AI analysis
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button
          onClick={detectDuplicates}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing for Duplicates...
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Detect Duplicate Payers
            </>
          )}
        </Button>

        {duplicateGroups.length > 0 && (
          <Alert>
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              Found {duplicateGroups.length} potential duplicate group(s). Review and approve merges below.
            </AlertDescription>
          </Alert>
        )}

        {duplicateGroups.map((group, idx) => (
          <Card key={idx} className="border-l-4 border-l-purple-500">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Duplicate Group {idx + 1}
                  </CardTitle>
                  <CardDescription>{group.reason}</CardDescription>
                </div>
                <Badge className={getConfidenceColor(group.confidence_score)}>
                  {group.confidence_score}% confidence
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Primary Payer */}
              <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="font-semibold text-green-900 dark:text-green-100">Primary (Keep This)</p>
                </div>
                <p className="text-sm font-medium">{group.primary_payer.payer_name}</p>
                <p className="text-xs text-green-700 dark:text-green-300">ID: {group.primary_payer.payer_id || 'N/A'}</p>
              </div>

              {/* Duplicates */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Duplicates to Merge ({group.duplicates.length}):
                </p>
                {group.duplicates.map((dup, dupIdx) => (
                  <div key={dupIdx} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border">
                    <p className="text-sm font-medium">{dup.payer_name}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">ID: {dup.payer_id || 'N/A'}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {dup.similarity_factors?.map((factor, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {factor.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Merged Data Preview */}
              <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                  Merged Data Preview:
                </p>
                <div className="text-xs space-y-1 text-blue-800 dark:text-blue-200">
                  <p><strong>Name:</strong> {group.merged_data_preview.payer_name}</p>
                  {group.merged_data_preview.states && (
                    <p><strong>States:</strong> {group.merged_data_preview.states.join(', ')}</p>
                  )}
                  {group.merged_data_preview.notes && (
                    <p><strong>Notes:</strong> {group.merged_data_preview.notes}</p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  onClick={() => mergePayers(group)}
                  disabled={mergingGroup === group.primary_payer.id}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  size="sm"
                >
                  {mergingGroup === group.primary_payer.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve & Merge
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => dismissGroup(group.primary_payer.id)}
                  variant="outline"
                  size="sm"
                >
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}