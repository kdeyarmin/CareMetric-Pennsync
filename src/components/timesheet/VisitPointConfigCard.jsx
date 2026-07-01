import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveVisitPointConfig } from "@/functions/saveVisitPointConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Target, Check, Info } from "lucide-react";
import { toast } from "sonner";
import { VISIT_TYPES, pointFieldFor, toNumber } from "./timesheetUtils";

/**
 * Admin editor for the facility's per-visit-type point values. Home-health
 * nurses enter visit counts by type; these values turn those counts into total
 * points. Point values are units of work, not dollars or pay rates.
 */
export default function VisitPointConfigCard({ config = null }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({});

  // Seed the inputs from the saved config once it loads.
  useEffect(() => {
    const seed = {};
    for (const vt of VISIT_TYPES) {
      const v = config?.[pointFieldFor(vt.key)];
      seed[vt.key] = v == null ? "" : String(v);
    }
    setValues(seed);
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {};
      for (const vt of VISIT_TYPES) payload[pointFieldFor(vt.key)] = toNumber(values[vt.key]);
      const result = await saveVisitPointConfig(payload);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success("Visit point values saved.");
      queryClient.invalidateQueries({ queryKey: ["visit-point-config"] });
    },
    onError: (err) => toast.error(err?.response?.data?.error || err?.message || "Could not save point values."),
  });

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="w-5 h-5 text-slate-600" />
          Visit Point Values
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="bg-blue-50 border-blue-200 mb-4">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            Set the point value for each home-health visit type. Nurses enter their visit counts by type and the
            system multiplies them by these values to calculate total points. (Points are units of work — no dollar
            amounts.)
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {VISIT_TYPES.map((vt) => (
            <div key={vt.key}>
              <Label htmlFor={`vp-${vt.key}`}>{vt.label}</Label>
              <Input
                id={`vp-${vt.key}`}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                className="mt-1"
                placeholder="0"
                value={values[vt.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [vt.key]: e.target.value }))}
              />
              <p className="text-[11px] text-slate-400 mt-0.5">{vt.full}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <Check className="w-4 h-4 mr-1.5" />
            {save.isPending ? "Saving…" : "Save point values"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
