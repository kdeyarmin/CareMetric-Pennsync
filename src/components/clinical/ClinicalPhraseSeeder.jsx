import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_CLINICAL_PHRASES, phrasesToSeed } from "./defaultClinicalPhrases";
import { fetchAllClinicalTemplates } from "./fetchAllClinicalTemplates";

// Admin-only control to load the bundled starter quick phrases as agency-wide
// templates, so nurses have common Medicare documentation blocks to trigger from
// the note editor immediately. Idempotent: only phrases not already present (by
// trigger text) are created, so it is safe to click again after a later release
// adds more defaults.
export default function ClinicalPhraseSeeder({ currentUserEmail }) {
  const queryClient = useQueryClient();

  const { data: existing = [] } = useQuery({
    queryKey: ["clinical-templates"],
    queryFn: fetchAllClinicalTemplates,
    initialData: [],
  });

  const missing = useMemo(() => phrasesToSeed(existing), [existing]);
  const loadedCount = DEFAULT_CLINICAL_PHRASES.length - missing.length;

  const seed = useMutation({
    mutationFn: async () => {
      let created = 0;
      for (const phrase of missing) {
        await base44.entities.ClinicalLibraryTemplate.create({
          ...phrase,
          created_by: currentUserEmail,
        });
        created += 1;
      }
      return created;
    },
    onSuccess: (created) => {
      toast.success(created ? `Added ${created} starter phrase${created > 1 ? "s" : ""}.` : "Starter phrases already added.");
      queryClient.invalidateQueries({ queryKey: ["clinical-templates"] });
    },
    onError: () => toast.error("Couldn't add the starter phrases. Please try again."),
  });

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
          <Sparkles className="w-4 h-4" /> Starter quick phrases
        </div>
        <p className="text-xs text-indigo-800 mt-1">
          Load {DEFAULT_CLINICAL_PHRASES.length} agency-wide Medicare phrases (diabetic education, fall-risk,
          homebound, medication reconciliation, wound care, pain) that every nurse can trigger with{" "}
          <code className="font-mono">/</code> in the note editor. You can edit or remove them afterward.
        </p>
        <div className="mt-2">
          <Badge className="bg-white text-indigo-700 border border-indigo-200">
            {loadedCount} of {DEFAULT_CLINICAL_PHRASES.length} added
          </Badge>
          {missing.length === 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-green-700 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" /> Up to date
            </span>
          )}
        </div>
      </div>
      <Button
        onClick={() => seed.mutate()}
        disabled={seed.isPending || missing.length === 0}
        className="bg-indigo-600 hover:bg-indigo-700 gap-2 font-semibold shrink-0"
      >
        {seed.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
        ) : (
          <><Sparkles className="w-4 h-4" /> Add {missing.length || ""} starter phrase{missing.length === 1 ? "" : "s"}</>
        )}
      </Button>
    </div>
  );
}
