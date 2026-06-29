import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, CheckCircle, XCircle, Clock, DollarSign, Users, Calendar } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

export default function FaxAnalyticsDashboard() {
  const { data: faxLogs = [] } = useQuery({
    queryKey: ['fax-logs-analytics'],
    queryFn: () => base44.entities.FaxLog.list('-created_date', 500),
    initialData: []
  });

  const thisMonth = faxLogs.filter(f => 
    new Date(f.created_date) >= startOfMonth(new Date())
  );

  const lastMonth = faxLogs.filter(f => {
    const date = new Date(f.created_date);
    return date >= startOfMonth(subMonths(new Date(), 1)) && 
           date <= endOfMonth(subMonths(new Date(), 1));
  });

  const delivered = faxLogs.filter(f => f.status === 'delivered').length;
  const failed = faxLogs.filter(f => f.status === 'failed').length;
  const pending = faxLogs.filter(f => ['queued', 'sending', 'sent'].includes(f.status)).length;
  const successRate = faxLogs.length > 0 ? ((delivered / faxLogs.length) * 100).toFixed(1) : 0;

  const totalCost = faxLogs.reduce((sum, f) => sum + (f.estimated_cost || 0), 0) / 100;
  const totalPages = faxLogs.reduce((sum, f) => sum + (f.pages || 1), 0);

  const topRecipients = Object.entries(
    faxLogs.reduce((acc, f) => {
      acc[f.to_name || f.to_number] = (acc[f.to_name || f.to_number] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const busiestDay = Object.entries(
    faxLogs.reduce((acc, f) => {
      const day = format(new Date(f.created_date), 'EEEE');
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">Fax Analytics</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Success Rate</p>
                <p className="text-2xl font-bold text-green-600">{successRate}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Delivered</p>
                <p className="text-2xl font-bold text-blue-600">{delivered}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Failed</p>
                <p className="text-2xl font-bold text-red-600">{failed}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="w-5 h-5" />
              Cost Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">Total Cost:</span>
                <span className="font-semibold">${totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">Total Pages:</span>
                <span className="font-semibold">{totalPages}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">This Month:</span>
                <span className="font-semibold">{thisMonth.length} faxes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-600">Last Month:</span>
                <span className="font-semibold">{lastMonth.length} faxes</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5" />
              Top Recipients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topRecipients.map(([name, count], idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700 truncate">{name}</span>
                  <Badge variant="outline">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {busiestDay && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="w-5 h-5" />
              Activity Pattern
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Busiest day: <span className="font-semibold text-slate-900">{busiestDay[0]}</span> ({busiestDay[1]} faxes)
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}