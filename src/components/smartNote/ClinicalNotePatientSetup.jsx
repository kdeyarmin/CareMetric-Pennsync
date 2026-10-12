import { User, AlertTriangle, ClipboardList } from 'lucide-react';
import SearchablePatientSelect from '@/components/ui/SearchablePatientSelect';

export default function ClinicalNotePatientSetup({ patients, patientId, onPatientChange, visitId, saving, patientChartReady, patientAuthorizationFailed, historyError, chartPatient, visitTypes, visitType, onVisitTypeChange }) {
  return <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <User className="w-3.5 h-3.5 text-navy-600" />
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Patient</span>
        <span className="text-xs text-amber-700 font-semibold normal-case ml-1">required to save</span>
      </div>
      <SearchablePatientSelect patients={patients} value={patientId} disabled={!!visitId || saving}
        onValueChange={value => { if (!visitId && !saving) onPatientChange(value); }}
        className="bg-slate-50 border-slate-200 h-12 sm:h-11 text-sm rounded-xl" />
      {!patientId && <p className="text-xs text-slate-500 mt-1.5">You can start writing now — a patient is required before this note can be saved to a chart.</p>}
      {patientId && !patientChartReady && <p className="text-xs text-amber-700 mt-1.5" role="status">
        {patientAuthorizationFailed || historyError ? 'Patient chart access could not be verified.' : 'Verifying patient chart access…'}
      </p>}
      {chartPatient && <div className="flex items-center gap-2 text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded-lg px-3 py-2 mt-2">
        <User className="w-3.5 h-3.5 shrink-0" /><span>
          <strong>{chartPatient.first_name} {chartPatient.last_name}</strong>
          {chartPatient.primary_diagnosis ? ` · ${chartPatient.primary_diagnosis}` : ''}
          {chartPatient.current_medications?.length > 0 ? ` · ${chartPatient.current_medications.length} meds` : ''}
          {chartPatient.functional_status?.fall_risk === 'high' && <span className="ml-2 inline-flex items-center gap-1 text-rose-600 font-bold"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> High Fall Risk</span>}
        </span>
      </div>}
    </div>
    <div className="border-t border-slate-100" />
    <div>
      <div className="flex items-center gap-1.5 mb-2"><ClipboardList className="w-3.5 h-3.5 text-navy-600" /><span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Visit Type</span></div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{visitTypes.map(visit => {
        const selected = visitType === visit.value;
        return <button key={visit.value} type="button" onClick={() => onVisitTypeChange(visit.value)} aria-pressed={selected}
          style={selected ? { backgroundColor: '#264491', borderColor: '#264491', color: '#ffffff' } : undefined}
          className={`py-3 sm:py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all text-center leading-tight min-h-[48px] sm:min-h-0 active:scale-95 ${selected ? 'shadow-md' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-navy-300 hover:bg-navy-50'}`}>{visit.label}</button>;
      })}</div>
    </div>
  </div>;
}