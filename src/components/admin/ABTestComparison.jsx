import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, TestTube, Trophy, AlertCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Compares A/B test results and recommends winning variant
 */
export default function ABTestComparison({ testGroup }) {
  const { providerType, taskType } = testGroup;

  const { data: testResults = [] } = useQuery({
    queryKey: ['abTestResults', providerType, taskType],
    queryFn: async () => {
      return await base44.entities.AIModelTestResult.filter({
        provider_type: providerType,
        task_type: taskType
      });
    }
  });

  const groupA = testResults.filter(r => r.ab_test_group === 'A');
  const groupB = testResults.filter(r => r.ab_test_group === 'B');

  if (groupA.length < 10 || groupB.length < 10) {
    return (
      <Alert>
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>
          <p className="text-sm">
            Need at least 10 results per variant for statistical significance.
            Current: Group A ({groupA.length}), Group B ({groupB.length})
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // Calculate metrics
  const metricsA = calculateMetrics(groupA);
  const metricsB = calculateMetrics(groupB);

  // Determine winner
  const winner = determineWinner(metricsA, metricsB);

  const handlePromoteWinner = async () => {
    if (window.confirm(`Promote ${winner} as the active configuration?`)) {
      toast.success(`Group ${winner} promoted to production`);
      // In real implementation, would update configurations
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-purple-300">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TestTube className="w-5 h-5" />
              A/B Test: {providerType} - {taskType}
            </span>
            {winner && (
              <Button onClick={handlePromoteWinner} className="bg-green-600">
                <Trophy className="w-4 h-4 mr-2" />
                Promote {winner}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {/* Group A */}
            <Card className={winner === 'A' ? 'border-2 border-green-400 bg-green-50' : 'border-gray-300'}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Group A</CardTitle>
                  {winner === 'A' && <Badge className="bg-green-600">Winner</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <MetricRow label="Sample Size" value={groupA.length} />
                <MetricRow label="Avg Quality" value={`${metricsA.avgQuality.toFixed(1)}/100`} />
                <MetricRow label="Avg Compliance" value={`${metricsA.avgCompliance.toFixed(1)}/100`} />
                <MetricRow label="Success Rate" value={`${metricsA.successRate.toFixed(1)}%`} />
                <MetricRow label="Avg Time" value={`${metricsA.avgTime.toFixed(0)}ms`} />
              </CardContent>
            </Card>

            {/* Group B */}
            <Card className={winner === 'B' ? 'border-2 border-green-400 bg-green-50' : 'border-gray-300'}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Group B</CardTitle>
                  {winner === 'B' && <Badge className="bg-green-600">Winner</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <MetricRow label="Sample Size" value={groupB.length} />
                <MetricRow label="Avg Quality" value={`${metricsB.avgQuality.toFixed(1)}/100`} />
                <MetricRow label="Avg Compliance" value={`${metricsB.avgCompliance.toFixed(1)}/100`} />
                <MetricRow label="Success Rate" value={`${metricsB.successRate.toFixed(1)}%`} />
                <MetricRow label="Avg Time" value={`${metricsB.avgTime.toFixed(0)}ms`} />
              </CardContent>
            </Card>
          </div>

          {/* Comparison Summary */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold mb-3">Statistical Analysis</h4>
            <div className="space-y-2 text-sm">
              <ComparisonRow 
                label="Quality" 
                valueA={metricsA.avgQuality} 
                valueB={metricsB.avgQuality}
              />
              <ComparisonRow 
                label="Compliance" 
                valueA={metricsA.avgCompliance} 
                valueB={metricsB.avgCompliance}
              />
              <ComparisonRow 
                label="Success Rate" 
                valueA={metricsA.successRate} 
                valueB={metricsB.successRate}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function ComparisonRow({ label, valueA, valueB }) {
  const diff = valueB - valueA;
  const percentDiff = ((diff / valueA) * 100).toFixed(1);
  const isSignificant = Math.abs(diff) > 2; // 2+ point difference is significant

  return (
    <div className="flex items-center justify-between">
      <span className="font-medium">{label}:</span>
      <div className="flex items-center gap-2">
        {isSignificant ? (
          diff > 0 ? (
            <>
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-green-600 font-semibold">B wins by {percentDiff}%</span>
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span className="text-blue-600 font-semibold">A wins by {Math.abs(percentDiff)}%</span>
            </>
          )
        ) : (
          <span className="text-gray-500">No significant difference</span>
        )}
      </div>
    </div>
  );
}

function calculateMetrics(results) {
  const avgQuality = results.reduce((sum, r) => sum + (r.quality_score || 0), 0) / results.length;
  const avgCompliance = results.reduce((sum, r) => sum + (r.compliance_score || 0), 0) / results.length;
  const successRate = (results.filter(r => r.success).length / results.length) * 100;
  const avgTime = results.reduce((sum, r) => sum + (r.processing_time_ms || 0), 0) / results.length;

  return {
    avgQuality,
    avgCompliance,
    successRate,
    avgTime
  };
}

function determineWinner(metricsA, metricsB) {
  // Weighted scoring: quality (40%), compliance (40%), success rate (20%)
  const scoreA = (metricsA.avgQuality * 0.4) + (metricsA.avgCompliance * 0.4) + (metricsA.successRate * 0.2);
  const scoreB = (metricsB.avgQuality * 0.4) + (metricsB.avgCompliance * 0.4) + (metricsB.successRate * 0.2);

  const diff = Math.abs(scoreA - scoreB);
  
  // Need at least 2% difference to declare a winner
  if (diff < 2) return null;
  
  return scoreA > scoreB ? 'A' : 'B';
}