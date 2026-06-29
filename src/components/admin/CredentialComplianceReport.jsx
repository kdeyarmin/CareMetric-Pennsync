import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toCsvRows } from "@/components/admin/csvExport";

const WINDOW_OPTIONS = [
  { value: "all", label: "All (including future)" },
  { value: "expired", label: "Expired only" },
  { value: "30", label: "Expiring within 30 days" },
  { value: "60", label: "Expiring within 60 days" },
  { value: "90", label: "Expiring within 90 days" },
];

export default function CredentialComplianceReport() {
  const [itemType, setItemType] = useState("all");
  const [windowFilter, setWindowFilter] = useState("90");
  const { data: users = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.list('-created_date', 500),
    initialData: [],
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['all-credentials'],
    queryFn: () => base44.entities.PersonnelCredential.list('-expiration_date', 1000),
    initialData: [],
  });

  const complianceData = useMemo(() => {
    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysOut = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const staffStatus = users.map(user => {
      const userCreds = credentials.filter(c => c.user_id === user.email);
      
      const expired = userCreds.filter(c => new Date(c.expiration_date) < now);
      const expiring30 = userCreds.filter(c => {
        const exp = new Date(c.expiration_date);
        return exp >= now && exp <= thirtyDaysOut;
      });
      const expiring60 = userCreds.filter(c => {
        const exp = new Date(c.expiration_date);
        return exp > thirtyDaysOut && exp <= sixtyDaysOut;
      });
      const expiring90 = userCreds.filter(c => {
        const exp = new Date(c.expiration_date);
        return exp > sixtyDaysOut && exp <= ninetyDaysOut;
      });

      return {
        email: user.email,
        name: user.full_name,
        total_credentials: userCreds.length,
        expired_count: expired.length,
        expiring_30: expiring30.length,
        expiring_60: expiring60.length,
        expiring_90: expiring90.length,
        expired_items: expired,
        expiring_soon: expiring30,
        status: expired.length > 0 ? 'expired' : expiring30.length > 0 ? 'critical' : expiring60.length > 0 ? 'warning' : 'good'
      };
    });

    return {
      staff: staffStatus,
      no_credentials: staffStatus.filter(s => s.total_credentials === 0),
      expired: staffStatus.filter(s => s.expired_count > 0),
      expiring_30: staffStatus.filter(s => s.expiring_30 > 0),
      expiring_60: staffStatus.filter(s => s.expiring_60 > 0),
      expiring_90: staffStatus.filter(s => s.expiring_90 > 0),
    };
  }, [users, credentials]);

  // Per-item detail report, filtered by item type and expiration window so admins
  // can run "specific or all items" expiration reports.
  const reportItems = useMemo(() => {
    const now = new Date();
    return credentials
      .filter(c => c.expiration_date)
      .filter(c => itemType === "all" || c.item_type === itemType)
      .map(c => {
        const exp = new Date(c.expiration_date);
        const daysUntil = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
        return { ...c, daysUntil };
      })
      .filter(c => {
        if (windowFilter === "all") return true;
        if (windowFilter === "expired") return c.daysUntil < 0;
        return c.daysUntil >= 0 && c.daysUntil <= Number(windowFilter);
      })
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [credentials, itemType, windowFilter]);

  const downloadCSV = () => {
    const headers = ['Employee', 'Email', 'Total Credentials', 'Expired', 'Expiring 30 Days', 'Expiring 60 Days', 'Expiring 90 Days', 'Status'];
    const rows = complianceData.staff.map(s => [
      s.name,
      s.email,
      s.total_credentials,
      s.expired_count,
      s.expiring_30,
      s.expiring_60,
      s.expiring_90,
      s.status
    ]);

    const csv = toCsvRows([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credential-compliance-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const downloadItemsCSV = () => {
    const headers = ['Employee', 'Email', 'Item', 'Type', 'Issuing Org', 'Expiration Date', 'Days Until Expiry', 'Status'];
    const rows = reportItems.map(c => [
      c.user_name || '',
      c.user_id || '',
      c.title || '',
      c.item_type || '',
      c.issuing_organization || '',
      c.expiration_date ? new Date(c.expiration_date).toLocaleDateString() : '',
      c.daysUntil,
      c.daysUntil < 0 ? 'Expired' : 'Active',
    ]);

    const csv = toCsvRows([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expiration-report-${itemType}-${windowFilter}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Credential Compliance Status</h3>
          <p className="text-sm text-slate-500">Track expiring licenses, certifications, and insurance</p>
        </div>
        <Button onClick={downloadCSV} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className={complianceData.no_credentials.length > 0 ? "border-red-300" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">No Credentials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{complianceData.no_credentials.length}</div>
            <p className="text-xs text-slate-500">Need upload</p>
          </CardContent>
        </Card>

        <Card className={complianceData.expired.length > 0 ? "border-red-300" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expired</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{complianceData.expired.length}</div>
            <p className="text-xs text-slate-500">Immediate action</p>
          </CardContent>
        </Card>

        <Card className={complianceData.expiring_30.length > 0 ? "border-amber-300" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expiring (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{complianceData.expiring_30.length}</div>
            <p className="text-xs text-slate-500">Critical</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expiring (60-90 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {complianceData.expiring_60.length + complianceData.expiring_90.length}
            </div>
            <p className="text-xs text-slate-500">Plan ahead</p>
          </CardContent>
        </Card>
      </div>

      {complianceData.expired.length > 0 && (
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>{complianceData.expired.length} employees have expired credentials.</strong> Immediate action required.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <CardTitle>Expiration Report</CardTitle>
              <p className="text-sm text-slate-500 mt-1">Run an expiration report for specific or all item types.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="item-type" className="text-xs text-slate-500 block mb-1">Item type</label>
                <Select value={itemType} onValueChange={setItemType}>
                  <SelectTrigger id="item-type" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All items</SelectItem>
                    <SelectItem value="license">Licenses</SelectItem>
                    <SelectItem value="certification">Certifications</SelectItem>
                    <SelectItem value="insurance">Insurance / Registration</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="window-filter" className="text-xs text-slate-500 block mb-1">Window</label>
                <Select value={windowFilter} onValueChange={setWindowFilter}>
                  <SelectTrigger id="window-filter" className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WINDOW_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={downloadItemsCSV} variant="outline" size="sm" disabled={reportItems.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reportItems.length === 0 ? (
            <p className="text-center py-6 text-sm text-slate-500">No items match this filter.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {reportItems.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{c.title} <span className="text-slate-400 font-normal">· {c.item_type}</span></p>
                    <p className="text-xs text-slate-500 truncate">{c.user_name || c.user_id} · expires {new Date(c.expiration_date).toLocaleDateString()}</p>
                  </div>
                  {c.daysUntil < 0 ? (
                    <Badge variant="destructive">Expired {Math.abs(c.daysUntil)}d</Badge>
                  ) : (
                    <Badge className={c.daysUntil <= 30 ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}>
                      {c.daysUntil}d
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff Credential Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {complianceData.staff
              .filter(s => s.status !== 'good' || s.total_credentials === 0)
              .map(staff => (
                <div key={staff.email} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{staff.name}</p>
                    <p className="text-xs text-slate-500">{staff.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {staff.total_credentials === 0 && (
                      <Badge variant="destructive">No Credentials</Badge>
                    )}
                    {staff.expired_count > 0 && (
                      <Badge variant="destructive">{staff.expired_count} Expired</Badge>
                    )}
                    {staff.expiring_30 > 0 && (
                      <Badge className="bg-amber-100 text-amber-800">{staff.expiring_30} Expiring Soon</Badge>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}