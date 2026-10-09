import { useState } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { openAuthorityBoundWindow } from '@/lib/authorityBoundWindows';
import { captureTenantSdkRealmLease, isTenantSdkRealmLeaseCurrent } from '@/lib/tenantSdkRealmGate';
import { trainingSummaryPrint } from '@/components/training/trainingSummaryPrint';

export default function PrintTrainingSummaryButton({ disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exportSummary = async () => {
    setError('');
    const printWindow = openAuthorityBoundWindow();
    if (!printWindow) { setError('Allow pop-ups to open the printable summary, then try again.'); return; }
    setBusy(true);
    try {
      const lease = captureTenantSdkRealmLease();
      printWindow.document.body.textContent = 'Preparing staff progress summary…';
      const report = { items: [], overall: null };
      let offset = 0;
      do {
        if (printWindow.closed || !isTenantSdkRealmLeaseCurrent(lease)) return;
        const { data } = await getTeamTrainingReadiness({ departmentProgressOnly: true, offset });
        if (printWindow.closed || !isTenantSdkRealmLeaseCurrent(lease)) return;
        if (data?.error || !Array.isArray(data?.items) || !data.overall) throw new Error('The summary could not be loaded. Please try again.');
        report.items.push(...data.items);
        if (!report.overall) report.overall = data.overall;
        offset = data.next_offset;
      } while (offset != null);
      printWindow.document.open();
      printWindow.document.write(trainingSummaryPrint(report, new Date().toLocaleString()));
      printWindow.document.close();
      printWindow.document.getElementById('print-summary').onclick = () => { if (isTenantSdkRealmLeaseCurrent(lease)) printWindow.print(); };
      printWindow.focus();
      printWindow.requestAnimationFrame(() => { if (!printWindow.closed && isTenantSdkRealmLeaseCurrent(lease)) printWindow.print(); });
    } catch (failure) {
      printWindow.close();
      setError(failure.message || 'The printable summary could not be prepared. Please try again.');
    } finally { setBusy(false); }
  };
  return <div className="flex flex-col items-start gap-1">
    <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={exportSummary}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="mr-2 h-4 w-4" aria-hidden="true" />}{busy ? 'Preparing summary…' : 'Export printable summary'}
    </Button>
    {error && <span role="alert" className="max-w-sm text-xs text-destructive">{error}</span>}
  </div>;
}