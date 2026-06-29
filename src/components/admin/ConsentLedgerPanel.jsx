import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  ShieldCheck, Search, Download, Loader2, CheckCircle2, XCircle, HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import { manageSmsConsent } from "@/functions/manageSmsConsent";
import {
  summarizeConsent, consentStatusLabel, formatConsentCsv,
} from "@/components/admin/consentLedger";
import { exportTimestamp } from "@/components/admin/csvExport";

const STATUS_BADGE = {
  opted_in: "bg-green-100 text-green-800",
  opted_out: "bg-red-100 text-red-800",
  unknown: "bg-slate-100 text-slate-700",
};

function StatusBadge({ status }) {
  return <Badge className={STATUS_BADGE[status] || STATUS_BADGE.unknown}>{consentStatusLabel(status)}</Badge>;
}

/** Trigger a browser download of a CSV string via a Blob. */
function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * ConsentLedgerPanel — admin-only view of the SMS consent ledger backing A2P
 * 10DLC / TCPA compliance. Shows opt totals, a searchable recent table, manual
 * opt-out / opt-in controls, and a CSV export.
 */
export default function ConsentLedgerPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sms-consent"],
    queryFn: async () => {
      const res = await manageSmsConsent({ action: "list", limit: 200 });
      return res?.data || res;
    },
  });

  const totalsFromServer = data?.totals;
  const recent = useMemo(() => (Array.isArray(data?.recent) ? data.recent : []), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((r) => String(r.phone_e164 || "").toLowerCase().includes(q));
  }, [recent, search]);

  // Prefer the server-computed totals over the whole ledger; fall back to the
  // rows we have if the backend didn't send them.
  const totals = totalsFromServer || summarizeConsent(recent);

  const setConsent = useMutation({
    mutationFn: (vars) => manageSmsConsent({ action: "set", ...vars }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["sms-consent"] });
      toast.success(`${vars.phone_e164} set to ${consentStatusLabel(vars.consent_status)}`);
    },
    onError: (err) => toast.error(err?.message || "Failed to update consent"),
  });

  const handleExport = () => {
    const csv = formatConsentCsv(filtered);
    downloadCsv(`sms-consent_${exportTimestamp()}.csv`, csv);
    toast.success(`Exported ${filtered.length} record${filtered.length === 1 ? "" : "s"}`);
  };

  const pendingPhone = setConsent.isPending ? setConsent.variables?.phone_e164 : null;

  return (
    <Card id="sms-consent-ledger" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            SMS Consent Ledger
          </span>
          <div className="flex items-center gap-2">
            <Badge className={STATUS_BADGE.opted_in}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {totals.opted_in} opted in
            </Badge>
            <Badge className={STATUS_BADGE.opted_out}>
              <XCircle className="w-3.5 h-3.5 mr-1" /> {totals.opted_out} opted out
            </Badge>
            <Badge className={STATUS_BADGE.unknown}>
              <HelpCircle className="w-3.5 h-3.5 mr-1" /> {totals.unknown} unknown
            </Badge>
          </div>
        </CardTitle>
        <CardDescription>
          Every recorded SMS opt-in / opt-out, the audit trail behind your TCPA &amp; A2P 10DLC
          compliance. STOP/START keywords are captured automatically; you can also set consent
          manually here (e.g. honoring a verbal or written request).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search by phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="button" variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : isError ? (
          <p className="text-sm text-red-600 py-6 text-center">Failed to load consent records.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            {search ? "No matching consent records." : "No consent records yet."}
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => {
                  const optedOut = r.consent_status === "opted_out";
                  const target = optedOut ? "opted_in" : "opted_out";
                  const busy = pendingPhone === r.phone_e164;
                  return (
                    <TableRow key={`${r.phone_e164}-${r.captured_at}-${i}`}>
                      <TableCell className="font-mono text-xs">{r.phone_e164}</TableCell>
                      <TableCell><StatusBadge status={r.consent_status} /></TableCell>
                      <TableCell className="text-xs text-slate-600">{r.consent_source || "—"}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {r.captured_at ? new Date(r.captured_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !r.phone_e164}
                          onClick={() => setConsent.mutate({ phone_e164: r.phone_e164, consent_status: target })}
                        >
                          {busy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : optedOut ? "Opt back in" : "Opt out"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          Showing up to {recent.length} most recent record{recent.length === 1 ? "" : "s"}. Export reflects the current search filter.
        </p>
      </CardContent>
    </Card>
  );
}
