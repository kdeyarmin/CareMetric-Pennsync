import { useRef, useState, useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { enhanceTranscription } from "@/components/utils/medicalDictionary";
import { claimDictation, releaseDictation } from "./dictationController";
import {
  createAuthorityBoundSpeechRecognition,
  preferLocalSpeechRecognition,
  LOCAL_SPEECH_REFUSED_MESSAGE,
  SPEECH_LOCALITY,
} from '@/lib/tenantMediaDevices';

/**
 * A small, self-contained push-to-dictate mic button. Uses the browser's
 * SpeechRecognition (same engine as the main note dictation) and passes each
 * finalized, medical-dictionary-enhanced chunk to `onText`. Designed to sit
 * next to a textarea so a nurse can speak an answer instead of typing it.
 *
 * Props:
 *   onText(text)  — called with each enhanced transcript chunk (append it)
 *   disabled      — disables the button
 *   title         — accessible label / tooltip
 */
export default function DictationButton({ onText, disabled = false, title = "Dictate this answer" }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const stopRef = useRef(null);
  const bindingRef = useRef(null);

  // Stop any in-flight recognition if the button unmounts mid-dictation, and
  // release the shared slot so the controller isn't left claimed by a dead mic.
  useEffect(() => () => {
    bindingRef.current?.dispose();
    bindingRef.current = null;
    recRef.current = null;
    releaseDictation(stopRef.current);
    stopRef.current = null;
  }, []);

  const toggle = async () => {
    if (listening) { recRef.current?.stop(); setListening(false); releaseDictation(stopRef.current); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.error("Speech recognition isn't supported in this browser."); return; }
    let binding;
    try {
      binding = createAuthorityBoundSpeechRecognition(SR);
    } catch {
      toast.error("Dictation expired because workspace authority changed.");
      return;
    }
    const rec = binding.recognition;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    // Register BEFORE awaiting. The unmount cleanup disposes whatever is in this
    // ref, so a binding created and not yet stored is invisible to it: awaiting
    // first would let the continuation below start a recognizer this button no
    // longer owns, leaving the microphone live with no UI left to stop it.
    bindingRef.current?.dispose();
    bindingRef.current = binding;
    // Keep the audio on the device where this browser can.
    const locality = await preferLocalSpeechRecognition(rec, SR, rec.lang);
    // Both checks are needed. `isCurrent` answers for the tenant realm only;
    // ref identity answers for this component and this toggle, which is what
    // unmounting or a second tap changes.
    if (bindingRef.current !== binding || !binding.isCurrent()) { binding.dispose(); return; }
    const stop = () => {
      if (!binding.isCurrent()) return;
      try { rec.stop(); } catch { /* already stopped */ }
    };
    stopRef.current = stop;
    rec.onresult = (e) => {
      if (!binding.isCurrent()) return;
      const t = Array.from(e.results).slice(e.resultIndex).map((r) => r[0].transcript).join(" ");
      const enhanced = enhanceTranscription(t);
      if (enhanced?.trim()) onText?.(enhanced.trim());
    };
    rec.onerror = (e) => {
      if (!binding.isCurrent()) return;
      setListening(false);
      releaseDictation(stop);
      // Only OUR local requirement is reported. `service-not-allowed` also means
      // the user agent declined the requested service for its own reasons.
      if (locality === SPEECH_LOCALITY.LOCAL && e?.error === "service-not-allowed") {
        toast.error(LOCAL_SPEECH_REFUSED_MESSAGE);
      }
    };
    rec.onend = () => {
      if (!binding.isCurrent()) return;
      setListening(false);
      releaseDictation(stop);
    };
    recRef.current = rec;
    // Stop any other recognizer first (browsers allow only one at a time).
    claimDictation(stop);
    try {
      rec.start();
    } catch {
      binding.dispose();
      bindingRef.current = null;
      recRef.current = null;
      releaseDictation(stop);
      toast.error("Unable to start dictation.");
      return;
    }
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={listening ? "Stop dictation" : title}
      aria-label={listening ? "Stop dictation" : title}
      aria-pressed={listening}
      className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-50 ${listening ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300"}`}
    >
      {listening ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}
