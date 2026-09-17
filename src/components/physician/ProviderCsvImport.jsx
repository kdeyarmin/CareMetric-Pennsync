import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { importProvidersCsv } from '@/functions/importProvidersCsv';
import { toast } from 'sonner';
import { validateFileUpload } from '@/components/utils/security';
import { captureTenantSdkRealmLease, assertTenantSdkRealmLeaseCurrent } from '@/lib/tenantSdkRealmGate';

export default function ProviderCsvImport({ onImported }) {
  const inputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const handleChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || inFlight.current) return;

    const check = validateFileUpload(file, {
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain', ''],
      allowedExtensions: ['.csv'],
    });
    if (!check.valid) { toast.error(check.error); return; }

    inFlight.current = true;
    setIsImporting(true);
    let lease;
    let submitted = false;
    try {
      lease = captureTenantSdkRealmLease();
      const bytes = await file.arrayBuffer();
      assertTenantSdkRealmLeaseCurrent(lease);
      if (!mounted.current) return;
      // Send the CSV directly to the existing authorized parser. Do not upload
      // a second copy to paid integration storage or retry through a file URL.
      if (bytes.byteLength !== file.size || bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error('CSV must be no larger than 10 MB.');
      }
      const csv_text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      submitted = true;
      const response = await importProvidersCsv({ csv_text });
      assertTenantSdkRealmLeaseCurrent(lease);
      if (!mounted.current) return;
      const result = response.data;
      if (result?.success !== true || !Number.isSafeInteger(result.created_providers)
        || result.created_providers < 0 || !Number.isSafeInteger(result.updated_providers)
        || result.updated_providers < 0) {
        throw new Error('Import result was not confirmed. Refresh the directory before retrying.');
      }
      toast.success(`Imported ${result.created_providers + result.updated_providers} providers`);
      onImported?.(result);
    } catch (error) {
      try {
        if (lease) assertTenantSdkRealmLeaseCurrent(lease);
        if (mounted.current) toast.error(submitted
          ? 'Import was not fully confirmed. Refresh the provider directory before retrying.'
          : error instanceof TypeError
            ? 'The CSV could not be read. Re-export it as UTF-8 and try again.'
            : error.message || 'Failed to read provider CSV');
      } catch { /* An expired document must not show a result for its former agency. */ }
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsImporting(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv" aria-label="Provider CSV file" disabled={isImporting} onChange={handleChange} className="hidden" />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isImporting} className="min-h-[44px]">
        {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
        {isImporting ? 'Importing...' : 'Import Provider CSV'}
      </Button>
    </>
  );
}