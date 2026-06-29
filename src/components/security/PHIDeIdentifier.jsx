import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, Copy, Shield, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * PHI De-Identification Component
 * Removes or masks Protected Health Information before AI processing or sharing
 */
export default function PHIDeIdentifier({ text, onDeIdentified }) {
  const [originalText, setOriginalText] = useState(text || "");
  const [deIdentifiedText, setDeIdentifiedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);

  const deIdentify = () => {
    setIsProcessing(true);
    
    let processed = originalText;
    const replacements = [];

    // 1. Names (basic pattern - first/last name capitalized)
    const namePattern = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;
    processed = processed.replace(namePattern, (match) => {
      replacements.push({ type: 'Name', original: match });
      return '[PATIENT NAME]';
    });

    // 2. Email addresses
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    processed = processed.replace(emailPattern, (match) => {
      replacements.push({ type: 'Email', original: match });
      return '[EMAIL]';
    });

    // 3. Phone numbers (multiple formats)
    const phonePattern = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    processed = processed.replace(phonePattern, (match) => {
      replacements.push({ type: 'Phone', original: match });
      return '[PHONE]';
    });

    // 4. SSN
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
    processed = processed.replace(ssnPattern, (match) => {
      replacements.push({ type: 'SSN', original: match });
      return '[SSN]';
    });

    // 5. Medical Record Numbers (common patterns)
    const mrnPattern = /\b(MRN|MR#|Medical Record)[:\s#]*(\d{6,10})\b/gi;
    processed = processed.replace(mrnPattern, (match) => {
      replacements.push({ type: 'MRN', original: match });
      return '[MRN]';
    });

    // 6. Dates (MM/DD/YYYY, MM-DD-YYYY, etc.)
    const datePattern = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
    processed = processed.replace(datePattern, (match) => {
      replacements.push({ type: 'Date', original: match });
      return '[DATE]';
    });

    // 7. Addresses (basic street patterns)
    const addressPattern = /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\b/gi;
    processed = processed.replace(addressPattern, (match) => {
      replacements.push({ type: 'Address', original: match });
      return '[ADDRESS]';
    });

    // 8. ZIP codes
    const zipPattern = /\b\d{5}(-\d{4})?\b/g;
    processed = processed.replace(zipPattern, (match) => {
      replacements.push({ type: 'ZIP', original: match });
      return '[ZIP]';
    });

    // 9. Ages over 89 (HIPAA Safe Harbor requires masking)
    const agePattern = /\b(age|aged)\s*:?\s*(\d{2,3})\b/gi;
    processed = processed.replace(agePattern, (match, prefix, age) => {
      if (parseInt(age) > 89) {
        replacements.push({ type: 'Age >89', original: match });
        return `${prefix} [AGE >89]`;
      }
      return match;
    });

    // 10. URLs / web addresses (Safe Harbor identifier #14)
    const urlPattern = /\bhttps?:\/\/[^\s<>"')]+/gi;
    processed = processed.replace(urlPattern, (match) => {
      replacements.push({ type: 'URL', original: match });
      return '[URL]';
    });

    // 11. IP addresses (Safe Harbor identifier #15). Runs after the phone pass so
    // dotted phone formats are already masked and won't be mis-tagged as IPs.
    const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    processed = processed.replace(ipPattern, (match) => {
      replacements.push({ type: 'IP Address', original: match });
      return '[IP]';
    });

    // 12. Account / device / serial / license / certificate numbers (Safe Harbor
    // identifiers #9–#13). Anchored on an explicit label to avoid masking ordinary
    // numbers; the value may contain letters, digits, and hyphens.
    const accountPattern = /\b(account|acct|policy|member|device|serial|license|certificate|cert)\s*(?:no|number|#|id)?\.?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})\b/gi;
    processed = processed.replace(accountPattern, (match, label) => {
      replacements.push({ type: 'Account/Device ID', original: match });
      return `${label} [ID]`;
    });

    setDeIdentifiedText(processed);
    setIsProcessing(false);
    
    if (onDeIdentified) {
      onDeIdentified({
        original: originalText,
        deIdentified: processed,
        replacements
      });
    }

    toast.success(`${replacements.length} item(s) masked — review output before sharing`);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error("Couldn't copy to the clipboard — copy the text manually.");
    }
  };

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5 text-navy-600" />
          PHI De-Identification Tool
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-amber-50 border-amber-300">
          <AlertDescription className="text-amber-900 text-sm">
            <p className="font-semibold mb-1">⚠️ Best-effort redaction — manual review required</p>
            <p>
              This tool uses simple pattern matching to mask common identifiers (obvious names,
              dates, addresses, phone numbers, emails, SSN, MRN, ages {'>'} 89). It does NOT detect
              all 18 HIPAA Safe Harbor identifier classes — for example URLs, IP addresses, vehicle/
              device/account identifiers, biometric data, photos, and uniquely identifying free-text
              details are not handled, and unusual name/date formats may be missed.
            </p>
            <p className="mt-1 font-medium">
              Always manually review the output before sharing. Do not treat this as certified
              Safe Harbor de-identification.
            </p>
          </AlertDescription>
        </Alert>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="phi-original-text" className="text-sm font-medium">Original Text (Contains PHI)</label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              {showOriginal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
          <Textarea
            id="phi-original-text"
            value={originalText}
            onChange={(e) => setOriginalText(e.target.value)}
            placeholder="Paste clinical note or text containing PHI..."
            className="min-h-[200px] font-mono text-sm"
            style={{ filter: showOriginal ? 'none' : 'blur(8px)' }}
          />
        </div>

        <Button
          onClick={deIdentify}
          disabled={isProcessing || !originalText}
          className="w-full bg-navy-600 hover:bg-navy-700 min-h-[44px]"
        >
          {isProcessing ? (
            <>Processing...</>
          ) : (
            <>
              <Shield className="w-4 h-4 mr-2" />
              De-Identify Text
            </>
          )}
        </Button>

        {deIdentifiedText && (
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <label htmlFor="phi-redacted-text" className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Redacted Text (review before sharing)
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(deIdentifiedText)}
                className="min-h-[44px]"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
            </div>
            <Textarea
              id="phi-redacted-text"
              value={deIdentifiedText}
              readOnly
              className="min-h-[200px] font-mono text-sm bg-green-50 border-green-300"
            />
            
            <Alert className="bg-amber-50 border-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900 text-sm">
                Detected identifiers were masked, but this does not guarantee all PHI was removed.
                Carefully review the text above for any remaining names, locations, or uniquely
                identifying details before using it with external services or for sharing.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}