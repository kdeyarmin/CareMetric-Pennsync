import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, TrendingDown, Eye, Download } from "lucide-react";
import ProviderDetailModal from "./ProviderDetailModal";

export default function ProviderPerformanceTable({ providers }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(null);

  // Fetch performance data for all providers
  const { data: performanceData = {}, isLoading } = useQuery({
    queryKey: ['providerPerformance', providers.map(p => p.email)],
    queryFn: async () => {
      const data = {};
      
      await Promise.all(providers.map(async (provider) => {
        try {
          // Get compliance audits
          const audits = await base44.entities.ComplianceAudit.filter(
            { nurse_email: provider.email },
            '-audit_date',
            50
          );

          // Get note conversions
          const notes = await base44.entities.NoteConversion.filter(
            { nurse_email: provider.email },
            '-created_date',
            50
          );

          // Get training completions
          const training = await base44.entities.TrainingCompletion.filter(
            { nurse_email: provider.email, status: 'completed' },
            '-completion_date',
            50
          );

          // Calculate metrics
          const avgCompliance = audits.length > 0
            ? audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
            : 0;

          const avgQuality = notes.length > 0
            ? notes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / notes.length
            : 0;

          const productivity = notes.length; // Notes generated
          
          data[provider.email] = {
            avgCompliance: Math.round(avgCompliance),
            avgQuality: Math.round(avgQuality),
            productivity,
            trainingCompleted: training.length,
            auditsCount: audits.length,
            lastActivity: audits[0]?.audit_date || notes[0]?.created_date || provider.created_date
          };
        } catch (error) {
          console.error(`Error fetching data for ${provider.email}:`, error);
          data[provider.email] = {
            avgCompliance: 0,
            avgQuality: 0,
            productivity: 0,
            trainingCompleted: 0,
            auditsCount: 0,
            lastActivity: provider.created_date
          };
        }
      }));

      return data;
    },
    enabled: providers.length > 0
  });

  const filteredProviders = useMemo(() => {
    return providers.filter(p => 
      p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [providers, searchTerm]);

  const sortedProviders = useMemo(() => {
    return [...filteredProviders].sort((a, b) => {
      const aScore = performanceData[a.email]?.avgCompliance || 0;
      const bScore = performanceData[b.email]?.avgCompliance || 0;
      return bScore - aScore;
    });
  }, [filteredProviders, performanceData]);

  const exportData = () => {
    const csv = [
      ['Name', 'Email', 'Compliance Score', 'Quality Score', 'Productivity', 'Training Completed', 'Last Activity'],
      ...sortedProviders.map(p => {
        const perf = performanceData[p.email] || {};
        return [
          p.full_name,
          p.email,
          perf.avgCompliance,
          perf.avgQuality,
          perf.productivity,
          perf.trainingCompleted,
          perf.lastActivity
        ];
      })
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'provider-performance.csv';
    a.click();
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'bg-green-100 text-green-800 border-green-200';
    if (score >= 75) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle>Provider Performance</CardTitle>
              <CardDescription>
                View and compare performance metrics across all providers
              </CardDescription>
            </div>
            <Button onClick={exportData} variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search providers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
          </div>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <p className="text-sm text-slate-500 mt-2">Loading provider data...</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Provider
                    </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Compliance
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Quality
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Productivity
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Training
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {sortedProviders.map((provider) => {
                  const perf = performanceData[provider.email] || {};
                  return (
                    <tr key={provider.email} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {provider.full_name}
                          </div>
                          <div className="text-sm text-slate-500">{provider.email}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={getScoreColor(perf.avgCompliance)}>
                          {perf.avgCompliance}%
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={getScoreColor(perf.avgQuality)}>
                          {perf.avgQuality}%
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-medium">{perf.productivity}</span>
                        <span className="text-xs text-slate-500 ml-1">notes</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-medium">{perf.trainingCompleted}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedProvider(provider)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

              {sortedProviders.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  No providers found
                </div>
              )}
            </table>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedProvider && (
        <ProviderDetailModal
          provider={selectedProvider}
          performanceData={performanceData[selectedProvider.email]}
          onClose={() => setSelectedProvider(null)}
        />
      )}
    </>
  );
}