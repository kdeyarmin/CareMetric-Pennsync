import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { extractFaxContact } from '@/functions/extractFaxContact';
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Upload a document (image or PDF) → AI extracts recipient details → calls onExtracted(data)
 */
export default function AIContactExtractor({ onExtracted }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";

    setIsAnalyzing(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      const result = await extractFaxContact({ fileUrl: file_url });

      const hasAny = result.name || result.organization || result.fax_number;
      if (!hasAny) {
        toast.warning("AI couldn't find recipient details in this document. Fill in manually.");
      } else {
        toast.success("AI extracted contact details — review and confirm below.");
        onExtracted(result);
      }
    } catch (err) {
      toast.error("AI analysis failed: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFile}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50"
        disabled={isAnalyzing}
        onClick={() => inputRef.current?.click()}
      >
        {isAnalyzing ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing document...</>
        ) : (
          <><Sparkles className="w-4 h-4 mr-2" /> Scan Document with AI</>
        )}
      </Button>
      {!isAnalyzing && (
        <p className="text-xs text-slate-400 text-center mt-1">
          Upload a referral, prescription, or any document to auto-fill fields
        </p>
      )}
    </div>
  );
}