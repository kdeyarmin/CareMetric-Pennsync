import { Link } from 'react-router';
import { BookOpen, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { METRIC_DICTIONARY, validateMetricDefinition } from '@/lib/metricDictionary';

/**
 * Thin UI consumer for the pure metric dictionary (P2-01).
 * Surfaces owner, formula, sources, cadence, and export path — no live values.
 */
export default function MetricDictionaryStrip({ metrics = METRIC_DICTIONARY } = {}) {
  const rows = (Array.isArray(metrics) ? metrics : []).filter((m) => validateMetricDefinition(m).valid);
  if (!rows.length) return null;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-navy-600" />
          <CardTitle className="text-base text-slate-900">Metric dictionary</CardTitle>
          <Badge variant="outline" className="ml-auto">{rows.length} KPIs</Badge>
        </div>
        <p className="text-sm text-slate-600">
          Canonical owners, formulas, and export paths. Live values still come from each report tab.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {rows.map((metric) => (
          <Link
            key={metric.id}
            to={metric.exportPath}
            className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 transition hover:border-navy-200 hover:bg-navy-50"
          >
            <div className="mb-1 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{metric.label}</p>
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              <Badge className="bg-slate-200 text-slate-700 text-xs">{metric.owner}</Badge>
              <Badge variant="outline" className="text-xs">{metric.refreshCadence}</Badge>
              <Badge variant="outline" className="text-xs">{metric.displayFormat}</Badge>
            </div>
            <p className="text-xs text-slate-600 line-clamp-2 font-mono">{metric.formula}</p>
            <p className="mt-1 text-xs text-slate-500">
              Sources: {(metric.sourceEntities || []).join(', ')}
            </p>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
