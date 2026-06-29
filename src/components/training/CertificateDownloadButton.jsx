import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function CertificateDownloadButton({ certificate, assignmentId, size = "default", variant = "outline" }) {
    const [generating, setGenerating] = useState(false);

    const handleDownload = async () => {
        try {
            setGenerating(true);

            // If certificate already has PDF URL, download directly
            if (certificate?.certificate_pdf_url) {
                window.open(certificate.certificate_pdf_url, '_blank');
                toast.success('Certificate opened in new tab');
                return;
            }

            // If we have a certificate ID but no PDF, generate it
            if (certificate?.certificate_id) {
                const result = await base44.functions.invoke('generateTrainingCertificatePDF', {
                    certificate_id: certificate.certificate_id
                });

                if (result.data?.pdf_url) {
                    window.open(result.data.pdf_url, '_blank');
                    toast.success('Certificate generated successfully');
                } else {
                    throw new Error('Failed to generate PDF');
                }
                return;
            }

            // If we only have assignment ID, need to issue certificate first
            if (assignmentId) {
                toast.error('Certificate not yet issued. Please contact your administrator.');
                return;
            }

            toast.error('No certificate information available');

        } catch (error) {
            console.error('Certificate download error:', error);
            toast.error('Failed to download certificate');
        } finally {
            setGenerating(false);
        }
    };

    if (!certificate && !assignmentId) {
        return null;
    }

    return (
        <Button
            onClick={handleDownload}
            disabled={generating}
            size={size}
            variant={variant}
            className="gap-2"
        >
            {generating ? (
                <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                </>
            ) : certificate?.certificate_pdf_url ? (
                <>
                    <Download className="h-4 w-4" />
                    Download Certificate
                </>
            ) : (
                <>
                    <FileText className="h-4 w-4" />
                    Get Certificate
                </>
            )}
        </Button>
    );
}