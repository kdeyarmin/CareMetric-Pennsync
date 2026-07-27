import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MEDICARE_RULES, rulesToSeed } from "./defaultMedicareRules";
import { ALL_ROWS } from '@/lib/queryLimits';

// Admin-only control to load the bundled default MedicareComplianceRule set
// (incl. Pennsylvania-specific rules) into the agency's rule library. The Smart
// Note's ruleLibrary then folds these over its static required-element defaults.
// Idempotent: only the rules not already present (by name) are created, so it is
// safe to click again after adding more defaults in a later release.
export default function MedicareRuleSeeder() {
  const queryClient = useQueryClient();

  const { data: existing = [] } = useQuery({
    queryKey: ["medicareComplianceRules"],
    queryFn: () => base44.entities.MedicareComplianceRule.list(undefined, ALL_ROWS),
    initialData: [],
  });

  const missing = useMemo(() => rulesToSeed(existing), [existing]);
  const loadedCount = DEFAULT_MEDICARE_RULES.length - missing.length;

  const seed = useMutation({
    mutationFn: async () => {
      // Sequential creates keep the call volume modest and surface a partial
      // failure clearly rather than firing dozens of parallel writes.
      let created = 0;
      for (const rule of missing) {
        await base44.entities.MedicareComplianceRule.create(rule);
        created += 1;
      }
      // Backfill service_line onto rules seeded before that field existed —
      // rulesToSeed skips existing names, so without this an already-seeded
      // agency's home-health rules keep hard-blocking hospice notes (a missing
      // service_line reads as "applies to both").
      const nameKey = (n) => String(n || "").trim().toLowerCase();
      const byName = new Map((existing || []).map((r) => [nameKey(r.rule_name), r]));
      let patched = 0;
      for (const def of DEFAULT_MEDICARE_RULES) {
        const cur = byName.get(nameKey(def.rule_name));
        if (cur && def.service_line && cur.service_line !== def.service_line) {
          await base44.entities.MedicareComplianceRule.update(cur.id, { service_line: def.service_line });
          patched += 1;
        }
      }
      return { created, patched };
    },
    onSuccess: ({ created, patched }) => {
      const msg = created
        ? `Loaded ${created} default Medicare rule${created > 1 ? "s" : ""}.`
        : patched
          ? `Default rules already loaded; updated ${patched} rule${patched > 1 ? "s" : ""}.`
          : "Default rules already loaded.";
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ["medicareComplianceRules"] });
    },
    onError: () => toast.error("Couldn't load the default rules. Please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="w-4 h-4 text-indigo-600" /> Medicare Rule Library
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600 leading-relaxed">
          Load the bundled default Medicare documentation rules (42 CFR, with a few Pennsylvania-specific
          requirements). The Smart Note uses these to ask the right questions and coach compliant answers.
          You can edit or deactivate any rule afterward.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <Badge className="bg-slate-100 text-slate-700">{loadedCount} of {DEFAULT_MEDICARE_RULES.length} defaults loaded</Badge>
          {missing.length === 0 && (
            <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="w-4 h-4" /> Up to date</span>
          )}
        </div>
        <Button
          onClick={() => seed.mutate()}
          disabled={seed.isPending || missing.length === 0}
          className="bg-indigo-600 hover:bg-indigo-700 h-10 gap-2 font-semibold"
        >
          {seed.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</> : <><BookOpen className="w-4 h-4" /> Load {missing.length || ""} default rule{missing.length === 1 ? "" : "s"}</>}
        </Button>
      </CardContent>
    </Card>
  );
}
