import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import PinLockScreen from "@/components/vault/PinLockScreen";
import PinSetupDialog from "@/components/vault/PinSetupDialog";
import VaultPatientList from "@/components/vault/VaultPatientList";
import { Button } from "@/components/ui/button";
import { Lock, LogOut, Settings, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Simple hash function for PIN (not cryptographically strong, but sufficient for client-side check)
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "_phi_vault_salt_2024");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function PHIVault() {
  const [unlocked, setUnlocked] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const hasPin = !!user?.vault_pin_hash;

  // Auto-lock after 5 minutes of inactivity
  useEffect(() => {
    if (!unlocked) return;
    let timeout;
    const resetTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setUnlocked(false);
        toast.info("PHI Vault locked due to inactivity");
      }, 5 * 60 * 1000); // 5 minutes
    };
    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keypress", resetTimer);
    window.addEventListener("touchstart", resetTimer);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keypress", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
    };
  }, [unlocked]);

  const handleUnlock = useCallback(async (enteredPin) => {
    const hash = await hashPin(enteredPin);
    if (hash === user?.vault_pin_hash) {
      setUnlocked(true);
      setAttempts(0);
      toast.success("PHI Vault unlocked");
      return true;
    } else {
      setAttempts(prev => prev + 1);
      return false;
    }
  }, [user?.vault_pin_hash]);

  const handleSavePin = async (pin) => {
    const hash = await hashPin(pin);
    await base44.auth.updateMe({ vault_pin_hash: hash });
    queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    setShowSetup(false);
    setUnlocked(true);
    toast.success("Vault PIN created successfully!");
  };

  const handleLock = () => {
    setUnlocked(false);
    toast.info("PHI Vault locked");
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Not unlocked — show lock screen
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200">
        <PinLockScreen
          hasPin={hasPin}
          onUnlock={handleUnlock}
          onSetupPin={() => setShowSetup(true)}
          attempts={attempts}
        />
        <PinSetupDialog
          open={showSetup}
          onOpenChange={setShowSetup}
          onSave={handleSavePin}
        />
      </div>
    );
  }

  // Unlocked — show vault content
  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-5xl mx-auto bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300 min-h-screen pb-20 sm:pb-6">
      {/* Vault Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            PHI Vault
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Secure access to protected health information
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={createPageUrl("Settings")}>
            <Button variant="outline" size="sm" className="gap-1">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Change PIN</span>
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleLock}>
            <Lock className="w-4 h-4" />
            Lock Vault
          </Button>
        </div>
      </div>

      {/* Security notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
        <Shield className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-700">
          <span className="font-semibold">HIPAA Protected</span> — This vault contains PHI. Auto-locks after 5 minutes of inactivity. 
          Access is logged for compliance.
        </p>
      </div>

      <VaultPatientList />
    </div>
  );
}