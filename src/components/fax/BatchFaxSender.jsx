import { AlertTriangle, Layers } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Batch fax is intentionally paused. Its prior browser workflow collected and
 * transformed selected clinical artifacts even though the server-side delivery
 * path is release-gated. Restore this surface only with one authority-bound
 * processing operation and a proven fax broker; an unavailable sender must not
 * collect artifacts it cannot transmit.
 */
export default function BatchFaxSender() {
  return (
    <Card className="shadow-lg">
      <CardContent className="p-6">
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Layers className="h-4 w-4" aria-hidden="true" />
              Batch fax unavailable
            </h2>
            <p className="mt-1 text-sm">
              Batch upload, PDF merging, and transmission remain paused until an
              authority-bound processing pipeline and reviewed fax broker are available.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
