import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth, differenceInMinutes } from 'date-fns';
import { FileText, CheckCircle2, XCircle, Clock, TrendingUp } from 'lucide-react';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3557b0', '#8b5cf6'];

export default function FaxAnalytics() {
    const { data: faxes = [], isLoading } = useQuery({
        queryKey: ['all-faxes'],
        queryFn: () => base44.entities.FaxLog.list('-created_date', 1000)
    });

    const metrics = useMemo(() => {
        if (!faxes.length) return null;

        const now = new Date();
        const last6Months = Array.from({ length: 6 }).map((_, i) => {
            const d = subMonths(now, i);
            return {
                label: format(d, 'MMM yyyy'),
                start: startOfMonth(d),
                end: endOfMonth(d),
                pages: 0,
                count: 0
            };
        }).reverse();

        let totalPages = 0;
        let successful = 0;
        let failed = 0;
        let queued = 0;
        let deliveryTimes = [];

        faxes.forEach(fax => {
            // Overall Stats
            if (fax.status === 'delivered' || fax.status === 'sent') {
                successful++;
                totalPages += (fax.pages || 1);
            } else if (fax.status === 'failed') {
                failed++;
            } else {
                queued++;
            }

            // Monthly Data
            const faxDate = new Date(fax.created_date);
            const monthBin = last6Months.find(m => faxDate >= m.start && faxDate <= m.end);
            if (monthBin) {
                monthBin.count++;
                if (fax.status === 'delivered' || fax.status === 'sent') {
                    monthBin.pages += (fax.pages || 1);
                }
            }

            // Time to Delivery
            if (fax.status === 'delivered' && fax.updated_date && fax.created_date) {
                const diff = differenceInMinutes(new Date(fax.updated_date), new Date(fax.created_date));
                if (diff >= 0 && diff < 1440) { // filter out weird outliers (more than a day)
                    deliveryTimes.push(diff);
                }
            }
        });

        const avgDeliveryTime = deliveryTimes.length 
            ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length) 
            : 0;

        const statusData = [
            { name: 'Successful', value: successful },
            { name: 'Failed', value: failed },
            { name: 'Queued/Sending', value: queued }
        ].filter(d => d.value > 0);

        return {
            totalPages,
            successful,
            failed,
            total: faxes.length,
            avgDeliveryTime,
            monthlyData: last6Months,
            statusData
        };
    }, [faxes]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-pulse flex flex-col items-center gap-4">
                    <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-slate-500 font-medium">Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (!metrics) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
                <div className="bg-slate-100 p-6 rounded-full mb-4">
                    <FileText className="h-12 w-12 text-slate-400" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">No Fax Data Available</h2>
                <p className="text-slate-500 max-w-md">There are no fax records in the system to analyze yet. Send some faxes to see metrics here.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Top Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="modern-card">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Total Pages Sent</p>
                            <h3 className="text-3xl font-bold text-slate-900">{metrics.totalPages}</h3>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                            <FileText className="w-6 h-6" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="modern-card">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Success Rate</p>
                            <h3 className="text-3xl font-bold text-green-600">
                                {metrics.total ? Math.round((metrics.successful / metrics.total) * 100) : 0}%
                            </h3>
                        </div>
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                            <CheckCircle2 className="w-6 h-6" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="modern-card">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Failure Rate</p>
                            <h3 className="text-3xl font-bold text-red-600">
                                {metrics.total ? Math.round((metrics.failed / metrics.total) * 100) : 0}%
                            </h3>
                        </div>
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                            <XCircle className="w-6 h-6" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="modern-card">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Avg. Delivery Time</p>
                            <h3 className="text-3xl font-bold text-slate-900">{metrics.avgDeliveryTime} <span className="text-lg font-normal text-slate-500">min</span></h3>
                        </div>
                        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                            <Clock className="w-6 h-6" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Volume Trend */}
                <Card className="lg:col-span-2 modern-card shadow-sm">
                    <CardHeader className="border-b border-slate-100 pb-4">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-500" />
                            Transmission Volume (Last 6 Months)
                        </CardTitle>
                        <CardDescription>Number of pages successfully sent over time</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metrics.monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <RechartsTooltip 
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Bar dataKey="pages" name="Pages Sent" fill="#3557b0" radius={[4, 4, 0, 0]} maxBarSize={50} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Status Breakdown */}
                <Card className="modern-card shadow-sm">
                    <CardHeader className="border-b border-slate-100 pb-4">
                        <CardTitle className="text-lg">Transmission Status</CardTitle>
                        <CardDescription>Overall success vs failure distribution</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 flex flex-col items-center justify-center">
                        <div className="h-[250px] w-full relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={metrics.statusData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {metrics.statusData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip 
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-6">
                                <span className="text-3xl font-bold text-slate-800">{metrics.total}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wider">Total</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}