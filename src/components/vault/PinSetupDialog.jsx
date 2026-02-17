import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Shield, Eye, EyeOff, Loader2 } from "lucide-react";

export default function PinSetupDialog({ open, onOpenChange, onSave }) {
  const [step, setStep] = useState(1); // 1 = enter, 2 = confirm
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleNext = () => {
    if (pin.length < 4 || pin.length > 6) {
      setError("PIN must be 4-6 digits");
      return;
    }
    if (!/^\d+$/.test(pin)) {
      setError("PIN must contain only numbers");
      return;
    }
    setError("");
    setStep(2);
  };

  const handleSave = async () => {
    if (pin !== confirmPin) {
      setError("PINs do not match. Please try again.");
      setConfirmPin("");
      return;
    }
    setSaving(true);
    await onSave(pin);
    setSaving(false);
    setPin("");
    setConfirmPin("");
    setStep(1);
  };

  const handleClose = () => {
    setPin("");
    setConfirmPin("");
    setStep(1);
    setError("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            {step === 1 ? "Create Your Vault PIN" : "Confirm Your PIN"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Choose a 4-6 digit PIN to protect patient data in the vault."
              : "Re-enter your PIN to confirm."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {step === 1 ? (
            <div>
              <Label htmlFor="pin">Enter PIN (4-6 digits)</Label>
              <div className="relative mt-1">
                <Input
                  id="pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setPin(val);
                    setError("");
                  }}
                  placeholder="••••••"
                  className="h-12 text-center text-2xl tracking-[0.5em] font-mono pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="confirmPin">Confirm PIN</Label>
              <div className="relative mt-1">
                <Input
                  id="confirmPin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setConfirmPin(val);
                    setError("");
                  }}
                  placeholder="••••••"
                  className="h-12 text-center text-2xl tracking-[0.5em] font-mono pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            {step === 2 && (
              <Button variant="outline" onClick={() => { setStep(1); setConfirmPin(""); setError(""); }}>
                Back
              </Button>
            )}
            <Button
              onClick={step === 1 ? handleNext : handleSave}
              disabled={step === 1 ? pin.length < 4 : confirmPin.length < 4 || saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {step === 1 ? "Next" : saving ? "Saving..." : "Save PIN"}
            </Button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Your PIN is securely hashed and stored. We cannot recover it — if you forget it, you'll need to reset it from Settings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}