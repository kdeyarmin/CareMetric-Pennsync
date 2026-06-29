import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanLine, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

const FIELD_LABELS = {
  patient_name: "Patient Name",
  date_of_birth: "Date of Birth",
  mrn: "MRN",
  physician_name: "Physician",
  date_of_service: "Date of Service",
  diagnosis: "Diagnosis",
  phone: "Phone",
  address: "Address"
};

/**
 * Props:
 *  - fileUrl: string — URL of the uploaded document/image to scan
 *  - onExtracted: (fields: object) => void — called with extracted metadata
 */
export default function FaxOCRExtractor({ fileUrl, onExtracted }) {
  const [isScanning, setIsScanning] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [expanded, setExpanded] = useState(true);

  if (!fileUrl) return null;

  const handleScan = async () => {
    setIsScanning(true);
    setExtracted(null);
    try {
      const res = await base44.functions.invoke('extractFaxMetadataOCR', { file_url: fileUrl });
      const data = res.data;
      if (data?.extracted && Object.keys(data.extracted).length > 0) {
        setExtracted(data.extracted);
        onExtracted?.(data.extracted);
        toast.success("Patient info extracted from document");
      } else {
        toast.info("No patient information detected in document");
      }
    } catch (err) {
      toast.error("OCR scan failed: " + err.message);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-blue-800">Auto-Extract Patient Info</span>
          {extracted && (
            <Badge className="bg-green-100 text-green-700 text-xs">
              {Object.keys(extracted).length} fields found
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {extracted && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-blue-600 hover:text-blue-800"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={isScanning}
            className="border-blue-300 text-blue-700 hover:bg-blue-100 h-7 text-xs"
          >
            {isScanning ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Scanning...</>
            ) : (
              <><ScanLine className="w-3 h-3 mr-1" />{extracted ? 'Re-scan' : 'Scan Document'}</>
            )}
          </Button>
        </div>
      </div>

      {extracted && expanded && (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {Object.entries(extracted).map(([key, value]) => (
            <div key={key} className="bg-white rounded border border-blue-100 px-2 py-1.5">
              <p className="text-xs text-slate-500">{FIELD_LABELS[key] || key}</p>
              <p className="text-xs font-medium text-slate-800 truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {!extracted && !isScanning && (
        <p className="text-xs text-blue-600">
          Scan to auto-detect patient name, DOB, MRN and more from the document.
        </p>
      )}
    </div>
  );
}