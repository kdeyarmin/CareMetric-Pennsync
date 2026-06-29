import { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { importProvidersCsv } from '@/functions/importProvidersCsv';
import { toast } from 'sonner';
import { validateFileUpload } from '@/components/utils/security';

export default function ProviderCsvImport({ onImported }) {
  const inputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const check = validateFileUpload(file, {
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain', ''],
      allowedExtensions: ['.csv'],
    });
    if (!check.valid) { toast.error(check.error); return; }

    setIsImporting(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await importProvidersCsv({ file_url });
      const result = response.data;
      toast.success(`Imported ${result.created_providers + result.updated_providers} providers`);
      onImported?.(result);
    } catch (error) {
      toast.error(error.message || 'Failed to import provider CSV');
    } finally {
      setIsImporting(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv" onChange={handleChange} className="hidden" />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isImporting} className="min-h-[44px]">
        {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
        {isImporting ? 'Importing...' : 'Import Provider CSV'}
      </Button>
    </>
  );
}