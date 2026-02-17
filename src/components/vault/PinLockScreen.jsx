import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Shield, Lock, Delete, Eye, EyeOff } from "lucide-react";

export default function PinLockScreen({ onUnlock, onSetupPin, hasPin, attempts, maxAttempts = 5 }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const inputRef = useRef(null);

  const isLockedOut = attempts >= maxAttempts;
  const [lockoutTimer, setLockoutTimer] = useState(0);

  useEffect(() => {
    if (isLockedOut) {
      setLockoutTimer(60);
      const interval = setInterval(() => {
        setLockoutTimer(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isLockedOut]);

  const handleDigit = (digit) => {
    if (isLockedOut && lockoutTimer > 0) return;
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError("");
  };

  const handleSubmit = () => {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    const result = onUnlock(pin);
    if (result === false) {
      setError("Incorrect PIN. Please try again.");
      setPin("");
    }
  };

  useEffect(() => {
    if (pin.length === 6) {
      handleSubmit();
    }
  }, [pin]);

  if (!hasPin) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
            <Shield className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set Up PHI Vault PIN</h1>
          <p className="text-slate-600">
            To protect patient health information, you need to create a secure PIN code. 
            You'll enter this PIN every time you access the PHI Vault.
          </p>
          <Button onClick={onSetupPin} className="bg-blue-600 hover:bg-blue-700 w-full h-12 text-base">
            <Lock className="w-5 h-5 mr-2" />
            Create My PIN
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <Lock className="w-8 h-8 text-slate-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">PHI Vault Locked</h1>
          <p className="text-sm text-slate-500 mt-1">Enter your PIN to access patient data</p>
        </div>

        {/* PIN dots */}
        <div className="flex items-center justify-center gap-3">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all ${
                i < pin.length
                  ? "bg-blue-600 border-blue-600 scale-110"
                  : "bg-white border-slate-300"
              }`}
            />
          ))}
          <button onClick={() => setShowPin(!showPin)} className="ml-2 text-slate-400 hover:text-slate-600">
            {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {showPin && pin && (
          <p className="text-sm font-mono text-slate-500 tracking-widest">{pin}</p>
        )}

        {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

        {isLockedOut && lockoutTimer > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 font-medium">Too many failed attempts</p>
            <p className="text-red-600 text-sm mt-1">Try again in {lockoutTimer}s</p>
          </div>
        ) : (
          <>
            {/* Number pad */}
            <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
                <button
                  key={digit}
                  onClick={() => handleDigit(String(digit))}
                  className="h-14 w-full rounded-xl bg-white border-2 border-slate-200 text-xl font-semibold text-slate-800 hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handleDelete}
                className="h-14 w-full rounded-xl bg-white border-2 border-slate-200 flex items-center justify-center text-slate-500 hover:bg-red-50 hover:border-red-300 active:scale-95 transition-all"
              >
                <Delete className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDigit("0")}
                className="h-14 w-full rounded-xl bg-white border-2 border-slate-200 text-xl font-semibold text-slate-800 hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all"
              >
                0
              </button>
              <button
                onClick={handleSubmit}
                disabled={pin.length < 4}
                className="h-14 w-full rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Enter
              </button>
            </div>
          </>
        )}

        {attempts > 0 && !isLockedOut && (
          <p className="text-xs text-slate-400">{maxAttempts - attempts} attempts remaining</p>
        )}
      </div>
    </div>
  );
}