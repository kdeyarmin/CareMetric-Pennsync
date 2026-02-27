import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PDGMRevenueReport from '@/components/reports/PDGMRevenueReport';
import PatientOutcomeAnalytics from '@/components/analytics/PatientOutcomeAnalytics';
import ComplianceTrendsChart from '@/components/analytics/ComplianceTrendsChart';
import NursePerformanceTrends from '@/components/analytics/NursePerformanceTrends';
import PremiumFeatureGate from '@/components/subscription/PremiumFeatureGate';
import { 
  FileText, 
  Download, 
  Calendar,
  Users,
  DollarSign,
  Activity,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function ReportsCenter() {
  const [reportType, setReportType] = useState('pdgm');
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  });

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const generateNurseReportMutation = useMutation({
    mutationFn: async (nurseEmail) => {
      const response = await base44.functions.invoke('generateNursePerformanceReport', {
        nurse_email: nurseEmail,
        period_type: 'monthly',
        period_start: dateRange.start,
        period_end: dateRange.end
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Nurse performance report generated');
    },
    onError: (error) => {
      toast.error('Failed to generate report: ' + error.message);
    }
  });

  const { data: nurses } = useQuery({
    queryKey: ['nurses'],
    queryFn: async () => {
      const users = await base44.entities.User.filter({});
      return users.filter(u => u.role !== 'admin');
    }
  });

  return (
    <PremiumFeatureGate featureName="Reports Center" featureDescription="Generate comprehensive operational, clinical, and financial analytics reports." allowTrial={true}>
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reports Center</h1>
            <p className="text-sm text-slate-600 mt-1">Generate comprehensive analytics reports</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>

        {/* Date Range Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">Start Date</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">End Date</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Report Types */}
        <Tabs value={reportType} onValueChange={setReportType}>
          <div className="overflow-x-auto scrollbar-hide -mx-6 px-6">
          <TabsList className="inline-flex w-max min-w-full gap-0.5 h-auto p-1">
            <TabsTrigger value="pdgm">PDGM Revenue</TabsTrigger>
            <TabsTrigger value="nurse">Nurse Performance</TabsTrigger>
            <TabsTrigger value="nurse-trends">Nurse Trends</TabsTrigger>
            <TabsTrigger value="outcomes">Patient Outcomes</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
          </TabsList>

          {/* PDGM Revenue Report */}
          <TabsContent value="pdgm">
            <PDGMRevenueReport startDate={dateRange.start} endDate={dateRange.end} />
          </TabsContent>

          {/* Nurse Performance Report */}
          <TabsContent value="nurse">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Nurse Performance Reports
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {nurses?.map(nurse => (
                    <div key={nurse.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-medium">{nurse.full_name}</p>
                        <p className="text-xs text-slate-600">{nurse.email}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => generateNurseReportMutation.mutate(nurse.email)}
                        disabled={generateNurseReportMutation.isPending}
                      >
                        {generateNurseReportMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Generate
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Nurse Trends Report */}
          <TabsContent value="nurse-trends">
            <NursePerformanceTrends dateRange={30} />
          </TabsContent>

          {/* Patient Outcomes Report */}
          <TabsContent value="outcomes">
            <PatientOutcomeAnalytics />
          </TabsContent>

          {/* Compliance Report */}
          <TabsContent value="compliance">
            <ComplianceTrendsChart data={[]} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </PremiumFeatureGate>
  );
}