import { AlertTriangle, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';

/**
 * The legacy browser PDF editors accepted arbitrary URLs and left pdf.js
 * loading/render tasks alive after tenant teardown. Keep the route explicit
 * but unavailable until documents are loaded and transformed exclusively by a
 * private, purpose-bound server broker.
 */
export default function PDFTools() {
  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        eyebrow="Documentation"
        title="PDF Tools"
        description="Secure PDF editing is temporarily unavailable"
        favoritePage="PDFTools"
      />
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-start gap-3 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-amber-950">PDF processing unavailable</h2>
            <p className="mt-1 text-sm text-amber-900">
              Edit, merge, and page-management tools are paused while secure private-document
              processing and transition-safe rendering are completed. No document was loaded.
            </p>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
