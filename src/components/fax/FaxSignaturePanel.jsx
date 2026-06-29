import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PenLine, Save, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import SignaturePad from "./SignaturePad";
import { toast } from "sonner";

/**
 * FaxSignaturePanel
 *
 * Props:
 *  - onSignatureReady(dataUrl | null)  called whenever the applied signature changes
 */
export default function FaxSignaturePanel({ onSignatureReady }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const [appliedSignature, setAppliedSignature] = useState(null); // data-url

  // Load saved signature from user profile
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const savedSignature = currentUser?.saved_signature || null;

  const applySignature = (dataUrl) => {
    setAppliedSignature(dataUrl);
    onSignatureReady(dataUrl);
    setShowPad(false);
    setOpen(false);
    toast.success("Signature applied — it will be stamped on the fax");
  };

  const useSaved = () => {
    if (!savedSignature) return;
    applySignature(savedSignature);
  };

  const saveToProfile = async (dataUrl) => {
    try {
      await base44.auth.updateMe({ saved_signature: dataUrl });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      toast.success("Signature saved to your profile");
    } catch {
      toast.error("Failed to save signature");
    }
  };

  const remove = () => {
    setAppliedSignature(null);
    onSignatureReady(null);
    toast.info("Signature removed");
  };

  return (
    <div className="space-y-2">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-100"
      >
        <span className="flex items-center gap-2">
          <PenLine className="w-4 h-4 text-indigo-600" />
          {appliedSignature ? (
            <span className="flex items-center gap-1">
              Signature applied <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            </span>
          ) : (
            "Add Signature (optional)"
          )}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <Card className="border-slate-200 bg-white">
          <CardContent className="pt-4 space-y-4">

            {/* Applied preview */}
            {appliedSignature && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge className="bg-green-100 text-green-800 border-green-200">Signature ready</Badge>
                  <Button variant="ghost" size="sm" onClick={remove} className="text-red-500 hover:text-red-700 h-7 px-2 text-xs">
                    Remove
                  </Button>
                </div>
                <img src={appliedSignature} alt="Applied signature" className="border rounded h-16 bg-white object-contain px-2" />
              </div>
            )}

            {/* Saved profile signature */}
            {savedSignature && !appliedSignature && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 font-medium">Saved signature</p>
                <img src={savedSignature} alt="Saved signature" className="border rounded h-16 bg-white object-contain px-2 w-full" />
                <Button variant="outline" size="sm" className="w-full" onClick={useSaved}>
                  <CheckCircle2 className="w-4 h-4 mr-1 text-green-500" /> Use Saved Signature
                </Button>
              </div>
            )}

            {/* Draw new */}
            {!showPad ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowPad(true)}
              >
                <PenLine className="w-4 h-4 mr-1" />
                {savedSignature ? "Draw a Different Signature" : "Draw Signature"}
              </Button>
            ) : (
              <div className="space-y-3">
                <SignaturePad
                  onSave={(dataUrl) => applySignature(dataUrl)}
                  onCancel={() => setShowPad(false)}
                />
                {/* Save to profile option */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-slate-500"
                  onClick={async () => {
                    // We need the drawn sig — prompt user to use it first then save
                    toast.info("Draw your signature, click 'Use Signature', then save to profile below.");
                  }}
                >
                  <Save className="w-3 h-3 mr-1" /> Save to Profile
                </Button>
              </div>
            )}

            {/* Save applied sig to profile */}
            {appliedSignature && appliedSignature !== savedSignature && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-indigo-600"
                onClick={() => saveToProfile(appliedSignature)}
              >
                <Save className="w-3 h-3 mr-1" /> Save this signature to my profile
              </Button>
            )}

          </CardContent>
        </Card>
      )}
    </div>
  );
}