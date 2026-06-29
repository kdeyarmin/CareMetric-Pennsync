import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Users,
  Award,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

export default function NursePerformanceMetrics({ 
  oasisData = [], 
  noteData = [], 
  auditData = [],
  users = []
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sortBy, setSortBy] = useState('overall');

  // Aggregate metrics by nurse
  const nurseMetrics = useMemo(() => {
    const metrics = {};

    // Initialize with users
    users.forEach(user => {
      if (user.role !== 'admin') {
        metrics[user.email] = {
          email: user.email,
          name: user.full_name || user.email.split('@')[0],
          oasisCount: 0,
          oasisScoreSum: 0,
          noteCount: 0,
          noteQualitySum: 0,
          auditCount: 0,
          auditScoreSum: 0,
          passedAudits: 0
        };
      }
    });

    // Aggregate OASIS data
    oasisData.forEach(item => {
      const email = item.created_by;
      if (!metrics[email]) {
        metrics[email] = {
          email,
          name: email?.split('@')[0] || 'Unknown',
          oasisCount: 0, oasisScoreSum: 0,
          noteCount: 0, noteQualitySum: 0,
          auditCount: 0, auditScoreSum: 0, passedAudits: 0
        };
      }
      metrics[email].oasisCount++;
      metrics[email].oasisScoreSum += item.scores?.overall || 0;
    });

    // Aggregate note data
    noteData.forEach(note => {
      const email = note.nurse_email;
      if (!metrics[email]) {
        metrics[email] = {
          email,
          name: email?.split('@')[0] || 'Unknown',
          oasisCount: 0, oasisScoreSum: 0,
          noteCount: 0, noteQualitySum: 0,
          auditCount: 0, auditScoreSum: 0, passedAudits: 0
        };
      }
      metrics[email].noteCount++;
      metrics[email].noteQualitySum += note.quality_score || 0;
    });

    // Aggregate audit data
    auditData.forEach(audit => {
      const email = audit.nurse_email;
      if (!metrics[email]) {
        metrics[email] = {
          email,
          name: email?.split('@')[0] || 'Unknown',
          oasisCount: 0, oasisScoreSum: 0,
          noteCount: 0, noteQualitySum: 0,
          auditCount: 0, auditScoreSum: 0, passedAudits: 0
        };
      }
      metrics[email].auditCount++;
      metrics[email].auditScoreSum += audit.compliance_score || 0;
      if (audit.status === 'passed') metrics[email].passedAudits++;
    });

    // Calculate averages
    return Object.values(metrics)
      .map(m => ({
        ...m,
        avgOASIS: m.oasisCount > 0 ? Math.round(m.oasisScoreSum / m.oasisCount) : null,
        avgNote: m.noteCount > 0 ? Math.round(m.noteQualitySum / m.noteCount) : null,
        avgAudit: m.auditCount > 0 ? Math.round(m.auditScoreSum / m.auditCount) : null,
        passRate: m.auditCount > 0 ? Math.round(m.passedAudits / m.auditCount * 100) : null,
        totalActivity: m.oasisCount + m.noteCount,
        // Average only the categories that actually have data — dividing by a
        // fixed 3 made a specialist with one strong category (e.g. 95 OASIS only)
        // score 32, ranking them below mediocre all-rounders and skewing the
        // default sort + "top performer".
        overall: (() => {
          const parts = [];
          if (m.oasisCount > 0) parts.push(m.oasisScoreSum / m.oasisCount);
          if (m.noteCount > 0) parts.push(m.noteQualitySum / m.noteCount);
          if (m.auditCount > 0) parts.push(m.auditScoreSum / m.auditCount);
          return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
        })()
      }))
      .filter(m => m.totalActivity > 0)
      .sort((a, b) => {
        if (sortBy === 'overall') return b.overall - a.overall;
        if (sortBy === 'oasis') return (b.avgOASIS || 0) - (a.avgOASIS || 0);
        if (sortBy === 'notes') return (b.avgNote || 0) - (a.avgNote || 0);
        if (sortBy === 'activity') return b.totalActivity - a.totalActivity;
        return 0;
      });
  }, [oasisData, noteData, auditData, users, sortBy]);

  // Chart data
  const chartData = nurseMetrics.slice(0, 10).map(m => ({
    name: m.name.length > 12 ? m.name.substring(0, 12) + '...' : m.name,
    OASIS: m.avgOASIS || 0,
    Notes: m.avgNote || 0,
    Compliance: m.avgAudit || 0
  }));

  const topPerformer = nurseMetrics[0];

  return (
    <Card>
      <CardHeader 
        className="pb-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            Nurse Performance Metrics
            <Badge variant="outline">{nurseMetrics.length} nurses</Badge>
          </div>
          <div className="flex items-center gap-2">
            {topPerformer && (
              <Badge className="bg-amber-100 text-amber-800">
                <Award className="w-3 h-3 mr-1" />
                Top: {topPerformer.name}
              </Badge>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardTitle>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {nurseMetrics.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No nurse performance data available</p>
          ) : (
            <>
              {/* Sort controls */}
              <div className="flex gap-2">
                <span className="text-sm text-slate-600">Sort by:</span>
                {['overall', 'oasis', 'notes', 'activity'].map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant={sortBy === s ? 'default' : 'outline'}
                    className="h-7 text-xs capitalize"
                    onClick={() => setSortBy(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>

              {/* Performance chart */}
              <div className="bg-slate-50 p-4 rounded-lg">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="OASIS" fill="#3557b0" />
                    <Bar dataKey="Notes" fill="#22c55e" />
                    <Bar dataKey="Compliance" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Detailed table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nurse</TableHead>
                    <TableHead className="text-center">OASIS Avg</TableHead>
                    <TableHead className="text-center">Note Quality</TableHead>
                    <TableHead className="text-center">Compliance</TableHead>
                    <TableHead className="text-center">Pass Rate</TableHead>
                    <TableHead className="text-center">Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nurseMetrics.slice(0, 15).map((nurse, idx) => (
                    <TableRow key={nurse.email} className={idx === 0 ? 'bg-gold-50' : ''}>
                      <TableCell className="font-medium">
                        {idx === 0 && <Award className="w-4 h-4 inline mr-1 text-gold-600" />}
                        {nurse.name}
                      </TableCell>
                      <TableCell className="text-center">
                        {nurse.avgOASIS !== null ? (
                          <Badge variant={nurse.avgOASIS >= 80 ? 'success' : 'warning'}>{nurse.avgOASIS}%</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {nurse.avgNote !== null ? (
                          <Badge variant={nurse.avgNote >= 80 ? 'success' : 'warning'}>{nurse.avgNote}%</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {nurse.avgAudit !== null ? (
                          <Badge variant={nurse.avgAudit >= 80 ? 'success' : 'warning'}>{nurse.avgAudit}%</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {nurse.passRate !== null ? `${nurse.passRate}%` : '-'}
                      </TableCell>
                      <TableCell className="text-center text-slate-600">
                        {nurse.totalActivity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}