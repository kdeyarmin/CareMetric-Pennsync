import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#264491'];

export default function DocumentAnalytics() {
  // Fetch packages and signatures
  const { data: packages = [], isLoading: isLoadingPkgs } = useQuery({
    queryKey: ['all-document-packages-analytics'],
    queryFn: () => base44.entities.DocumentPackage.list('-created_date', 500),
    initialData: [],
  });

  const { data: signatures = [], isLoading: isLoadingSigs } = useQuery({
    queryKey: ['all-document-signatures-analytics'],
    queryFn: () => base44.entities.DocumentSignature.list('-created_date', 500),
    initialData: [],
  });

  // Calculate metrics
  const analyticsData = useMemo(() => {
    // 1. Success Rates (Package status)
    const statusCount = packages.reduce((acc, pkg) => {
      const status = pkg.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    const successRates = Object.keys(statusCount).map(key => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: statusCount[key]
    }));

    // 2. Most frequently signed documents (by document title in signatures)
    const docCounts = signatures.reduce((acc, sig) => {
      const title = sig.document_title || sig.document_name;
      if (sig.status === 'completed' && title) {
        acc[title] = (acc[title] || 0) + 1;
      }
      return acc;
    }, {});

    const topDocuments = Object.keys(docCounts)
      .map(key => ({ name: key, count: docCounts[key] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 3. Turnaround times (avg hours to sign packages)
    const turnaroundTimes = packages
      .filter(pkg => pkg.status === 'completed' && pkg.completed_at && pkg.sent_to_patient_at)
      .map(pkg => {
        const sent = new Date(pkg.sent_to_patient_at);
        const completed = new Date(pkg.completed_at);
        const diffHours = (completed - sent) / (1000 * 60 * 60);
        return {
          date: sent.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          hours: Math.round(diffHours * 10) / 10,
          timestamp: sent.getTime()
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-15); // last 15 completed

    return {
      successRates,
      topDocuments,
      turnaroundTimes
    };
  }, [packages, signatures]);

  if (isLoadingPkgs || isLoadingSigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Success Rates Chart */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg text-slate-800">Signature Success Rates</CardTitle>
            <CardDescription>Status distribution of document packages</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px]">
              {analyticsData.successRates.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analyticsData.successRates}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#264491"
                      dataKey="value"
                    >
                      {analyticsData.successRates.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} Packages`, 'Count']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">No data available</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Most Frequent Documents */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg text-slate-800">Most Frequently Signed</CardTitle>
            <CardDescription>Top 5 document types by completion</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px]">
              {analyticsData.topDocuments.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analyticsData.topDocuments} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${value} Signatures`, 'Completed']} />
                    <Bar dataKey="count" fill="#264491" radius={[0, 4, 4, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">No data available</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Turnaround Time */}
        <Card className="md:col-span-2 shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg text-slate-800">Turnaround Times</CardTitle>
            <CardDescription>Hours taken to complete recent signature packages</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px]">
              {analyticsData.turnaroundTimes.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analyticsData.turnaroundTimes} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }} />
                    <Tooltip formatter={(value) => [`${value} hrs`, 'Time to Sign']} />
                    <Legend />
                    <Line type="monotone" dataKey="hours" name="Hours to Sign" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2 }} activeDot={{ r: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">No data available (Needs completed packages)</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}