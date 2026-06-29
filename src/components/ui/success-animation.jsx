import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

export default function SuccessAnimation({ show, message, duration = 2000, onComplete }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        if (onComplete) onComplete();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onComplete]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="modern-card-elevated p-8 max-w-sm mx-4 animate-in zoom-in-95 duration-300">
        <div className="text-center space-y-4">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />
            <div className="relative w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-white animate-in zoom-in duration-500" />
            </div>
          </div>
          <p className="text-lg font-semibold text-slate-900">{message}</p>
        </div>
      </div>
    </div>
  );
}

export function SuccessBanner({ show, message, onClose }) {
  if (!show) return null;

  return (
    <div className="animate-in slide-in-from-top duration-300 mb-4">
      <div className="modern-card bg-green-50 border-green-200 p-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-sm font-medium text-green-900 flex-1">{message}</p>
          {onClose && (
            <button
              onClick={onClose}
              className="text-green-600 hover:text-green-700 transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}