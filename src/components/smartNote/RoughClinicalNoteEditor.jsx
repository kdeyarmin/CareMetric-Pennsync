import { Sparkles, ClipboardList, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QuickPhraseTextarea from '@/components/smartNote/QuickPhraseTextarea';
import CollapsibleSection from '@/components/smartNote/CollapsibleSection';
import VisitAudioRecorder from '@/components/smartNote/VisitAudioRecorder';

export default function RoughClinicalNoteEditor({ textareaRef, note, setNote, patientId, chartPatient, visitType, userEmail, onOpenDrafter, listening, onStartDictation, onStopDictation }) {
  return <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
      <span className="text-xs font-semibold text-navy-700">Your Rough Notes / Bullet Points</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-navy-600 hover:text-navy-800" onClick={() => textareaRef.current?.openQuickPhrases?.()}><Sparkles className="w-3.5 h-3.5" /> Quick Phrase</Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-navy-600 hover:text-navy-800" onClick={onOpenDrafter}><ClipboardList className="w-3.5 h-3.5" /> Use Structured Form</Button>
      </div>
    </div>
    <QuickPhraseTextarea ref={textareaRef} value={note} onChange={setNote} patientId={patientId}
      patientName={chartPatient ? `${chartPatient.first_name} ${chartPatient.last_name}` : undefined}
      visitType={visitType} userEmail={userEmail}
      placeholder={'Enter bullet points or rough draft — AI will NOT invent information.\n\nType / or .shortcut to insert a saved quick phrase.\n\n• BP 148/90, HR 82, O2 95% RA, pain 3/10\n• homebound: unable to leave without considerable effort\n• skilled need: wound assessment and dressing change\n• wound R heel 2×3 cm granulating, no odor\n• taught med schedule, pt verbalized understanding\n• fall risk — clutter noted, discussed w/ family'}
      className="w-full min-h-[240px] sm:min-h-[320px] text-sm border-0 px-4 py-3 focus:ring-0 bg-white font-mono resize-none outline-none leading-relaxed" spellCheck={false} />
    <div className="border-t border-slate-100">
      <CollapsibleSection title="Voice input" icon={Mic} summary="Dictate or record instead of typing" defaultOpen={false} className="border-0 shadow-none rounded-none bg-transparent">
        <div className="space-y-2">
          <Button variant={listening ? 'destructive' : 'default'}
            className={`h-9 gap-2 text-xs font-semibold shadow-sm ${listening ? 'animate-pulse' : 'bg-navy-600 hover:bg-navy-700 text-white'}`}
            onClick={listening ? onStopDictation : onStartDictation}>
            {listening ? <><Square className="w-4 h-4 fill-current" /> Stop Dictation</> : <><Mic className="w-4 h-4" /> Live Dictation</>}
          </Button>
          <VisitAudioRecorder onTranscribed={text => setNote(previous => previous ? previous + '\n\n' + text : text)} />
        </div>
      </CollapsibleSection>
    </div>
  </div>;
}