import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Heart, 
  Activity, 
  AlertCircle, 
  Calendar,
  Users,
  Edit,
  Plus
} from "lucide-react";
import { formatLocalDate } from "@/lib/dateLocal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// `Patient.family_medical_history` is an OBJECT in the entity schema (a boolean
// per condition, an `other_conditions` list, and free-text `notes`) — not the
// free-text string this section used to assume. Rendering the object straight
// into JSX threw "Objects are not valid as a React child", blanking the whole
// Health History card for any chart whose family history had actually been
// filled in; and the editor wrote a bare string back into an object-typed field,
// which the platform drops, so the nurse's edit silently vanished.
const FAMILY_HISTORY_CONDITIONS = [
  { key: 'heart_disease', label: 'Heart disease' },
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'cancer', label: 'Cancer' },
  { key: 'hypertension', label: 'Hypertension' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'alzheimers_dementia', label: 'Alzheimer’s / dementia' },
  { key: 'mental_illness', label: 'Mental illness' },
];

/** Coerce any stored shape (incl. a legacy free-text string) to the schema object. */
function normalizeFamilyHistory(value) {
  if (typeof value === 'string') return value.trim() ? { notes: value } : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

/** The condition badges + free-text a family history resolves to, if any. */
function summarizeFamilyHistory(value) {
  const history = normalizeFamilyHistory(value);
  const conditions = FAMILY_HISTORY_CONDITIONS.filter((c) => history[c.key]).map((c) => c.label);
  const others = (Array.isArray(history.other_conditions) ? history.other_conditions : [])
    .map((entry) => (typeof entry === 'string'
      ? entry
      : [entry?.condition, entry?.relation].filter(Boolean).join(' — ')))
    .filter(Boolean);
  const notes = typeof history.notes === 'string' ? history.notes : '';
  return { badges: [...conditions, ...others], notes, isEmpty: conditions.length + others.length === 0 && !notes.trim() };
}

export default function HealthHistorySection({ patient }) {
  const [editDialog, setEditDialog] = useState(null);
  const [formData, setFormData] = useState({});
  const [rowKeys, setRowKeys] = useState([]);
  const queryClient = useQueryClient();
  // Snapshot of the array fields when the dialog opened, so the save-time merge
  // can tell entries the user removed (in here, gone from server) from entries a
  // concurrent writer added (absent here, present on server) and not clobber the latter.
  const originalArraysRef = useRef({});

  // The array history fields are written as a whole array; re-merging keeps a
  // concurrent add (present on the latest server record, not in the snapshot
  // this dialog opened with, and not in the edited list) while honoring removals.
  const ARRAY_FIELDS = ['past_medical_history', 'past_hospitalizations'];
  // Identity per field, used to carry over a concurrent ADD without duplicating a
  // concurrent EDIT. A hospitalization is identified by `reason` + `date` so that
  // editing its hospital/length doesn't fork a second row, while two admissions
  // sharing a reason on different dates (e.g. two CHF stays) stay distinct and a
  // concurrent add of the second isn't collapsed into the first and lost. A
  // past-medical-history entry is the string itself. Entries lacking both reason
  // and date fall back to full (order-insensitive) value identity.
  const fieldKeyFns = {
    past_hospitalizations: (h) => {
      const reason = h?.reason ? String(h.reason).trim().toLowerCase() : '';
      const date = h?.date ? String(h.date).trim() : '';
      return (reason || date)
        ? `${reason}|${date}`
        : JSON.stringify(Object.keys(h || {}).sort().reduce((o, k) => { o[k] = h[k]; return o; }, {}));
    },
    past_medical_history: (s) => String(s ?? '').trim().toLowerCase(),
  };
  const mergeArrayField = (edited, original, server, keyFn) => {
    const originalKeys = new Set((original || []).map(keyFn));
    const editedKeys = new Set((edited || []).map(keyFn));
    // Only a server entry whose identity is in NEITHER the snapshot nor the edited
    // list is a genuine concurrent ADD; an edit to an entry the user also has
    // resolves last-writer-wins on the user's version (no duplicate).
    const concurrentlyAdded = (server || []).filter(
      (s) => !originalKeys.has(keyFn(s)) && !editedKeys.has(keyFn(s))
    );
    return [...(edited || []), ...concurrentlyAdded];
  };

  const updatePatientMutation = useMutation({
    mutationFn: async (data) => {
      let payload = data;
      if (ARRAY_FIELDS.some((f) => f in data)) {
        try {
          const latestArr = await base44.entities.Patient.filter({ id: patient.id });
          const latest = latestArr?.[0];
          if (latest) {
            payload = { ...data };
            for (const f of ARRAY_FIELDS) {
              if (!(f in data)) continue;
              payload[f] = mergeArrayField(data[f], originalArraysRef.current[f], latest[f], fieldKeyFns[f]);
            }
          }
        } catch { /* fall back to writing the dialog snapshot */ }
      }
      return base44.entities.Patient.update(patient.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patient', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patientContext', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patientDetail', patient.id] });
      toast.success('Health history updated successfully');
      setEditDialog(null);
    },
    onError: (error) => {
      toast.error('Failed to update health history');
      console.error(error);
    }
  });

  // Stable per-row keys for the editable array dialogs, kept parallel to the
  // array so removing a middle row doesn't shift React keys by index (which would
  // move focus/IME state to the wrong input). Not persisted — purely for keying.
  const rowKeyCounter = useRef(0);
  const makeRowKeys = (n) => Array.from({ length: n }, () => `r${rowKeyCounter.current++}`);

  const openEditDialog = (section) => {
    setEditDialog(section);
    originalArraysRef.current = {
      past_medical_history: patient.past_medical_history || [],
      past_hospitalizations: patient.past_hospitalizations || [],
    };
    if (section === 'allergies') {
      setFormData({ allergies: patient.allergies || '' });
    } else if (section === 'past_medical') {
      const arr = patient.past_medical_history || [];
      setFormData({ past_medical_history: arr });
      setRowKeys(makeRowKeys(arr.length));
    } else if (section === 'surgeries') {
      const arr = patient.past_hospitalizations || [];
      setFormData({ past_hospitalizations: arr });
      setRowKeys(makeRowKeys(arr.length));
    } else if (section === 'family_history') {
      setFormData({ family_medical_history: normalizeFamilyHistory(patient.family_medical_history) });
    }
  };

  const updateObjectArrayItem = (field, index, key, value) => {
    const newArray = [...(formData[field] || [])];
    newArray[index] = { ...newArray[index], [key]: value };
    setFormData({ ...formData, [field]: newArray });
  };

  const familyHistory = summarizeFamilyHistory(patient.family_medical_history);

  const handleSave = () => {
    updatePatientMutation.mutate(formData);
  };

  const addToArray = (field) => {
    setFormData({
      ...formData,
      [field]: [...(formData[field] || []), '']
    });
    setRowKeys((k) => [...k, `r${rowKeyCounter.current++}`]);
  };

  // Append a blank hospitalization entry (object) + its stable row key.
  const addHospitalizationRow = () => {
    setFormData({
      ...formData,
      past_hospitalizations: [
        ...(formData.past_hospitalizations || []),
        { reason: '', hospital: '', date: '', length_of_stay: '' },
      ],
    });
    setRowKeys((k) => [...k, `r${rowKeyCounter.current++}`]);
  };

  const updateArrayItem = (field, index, value) => {
    const newArray = [...(formData[field] || [])];
    newArray[index] = value;
    setFormData({ ...formData, [field]: newArray });
  };

  const removeFromArray = (field, index) => {
    const newArray = [...(formData[field] || [])];
    newArray.splice(index, 1);
    setFormData({ ...formData, [field]: newArray });
    setRowKeys((k) => k.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Allergies */}
      <Card className="border-red-200">
        <CardHeader className="bg-red-50">
          <CardTitle className="text-lg flex items-center justify-between text-slate-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              Allergies & Adverse Reactions
            </div>
            <Button variant="ghost" size="sm" aria-label="Edit allergies" onClick={() => openEditDialog('allergies')}>
              <Edit className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {patient.allergies ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-slate-900 whitespace-pre-wrap">{patient.allergies}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No known allergies recorded</p>
          )}
        </CardContent>
      </Card>

      {/* Past Medical History */}
      <Card>
        <CardHeader className="bg-blue-50">
          <CardTitle className="text-lg flex items-center justify-between text-slate-900">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-blue-600" />
              Past Medical History
            </div>
            <Button variant="ghost" size="sm" aria-label="Edit past medical history" onClick={() => openEditDialog('past_medical')}>
              <Edit className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {patient.past_medical_history?.length > 0 ? (
            <ul className="space-y-2">
              {patient.past_medical_history.map((condition, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">{index + 1}</Badge>
                  <span className="text-sm text-slate-900">{condition}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 italic">No past medical history recorded</p>
          )}
        </CardContent>
      </Card>

      {/* Surgeries & Hospitalizations */}
      <Card>
        <CardHeader className="bg-navy-50">
          <CardTitle className="text-lg flex items-center justify-between text-slate-900">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-navy-600" />
              Surgeries & Hospitalizations
            </div>
            <Button variant="ghost" size="sm" aria-label="Edit surgeries and hospitalizations" onClick={() => openEditDialog('surgeries')}>
              <Edit className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {patient.past_hospitalizations?.length > 0 ? (
            <div className="space-y-3">
              {patient.past_hospitalizations.map((hosp, index) => (
                <div key={index} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{hosp.reason}</p>
                      {hosp.hospital && (
                        <p className="text-sm text-slate-600 mt-1">{hosp.hospital}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        {hosp.date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatLocalDate(hosp.date, { month: 'short', day: 'numeric', year: 'numeric' }) || hosp.date}
                          </span>
                        )}
                        {hosp.length_of_stay && (
                          <span>{hosp.length_of_stay} days</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No hospitalizations recorded</p>
          )}
        </CardContent>
      </Card>

      {/* Family Medical History */}
      <Card>
        <CardHeader className="bg-green-50">
          <CardTitle className="text-lg flex items-center justify-between text-slate-900">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-green-600" />
              Family Medical History
            </div>
            <Button variant="ghost" size="sm" aria-label="Edit family medical history" onClick={() => openEditDialog('family_history')}>
              <Edit className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {familyHistory.isEmpty ? (
            <p className="text-sm text-slate-500 italic">No family medical history recorded</p>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
              {familyHistory.badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {familyHistory.badges.map((badge) => (
                    <Badge key={badge} variant="outline" className="bg-white">{badge}</Badge>
                  ))}
                </div>
              )}
              {familyHistory.notes && (
                <p className="text-sm text-slate-900 whitespace-pre-wrap">{familyHistory.notes}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialogs */}
      <Dialog open={editDialog !== null} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editDialog === 'allergies' && 'Edit Allergies'}
              {editDialog === 'past_medical' && 'Edit Past Medical History'}
              {editDialog === 'surgeries' && 'Edit Surgeries & Hospitalizations'}
              {editDialog === 'family_history' && 'Edit Family Medical History'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editDialog === 'allergies' && (
              <div>
                <Label>Allergies & Adverse Reactions</Label>
                <Textarea
                  value={formData.allergies || ''}
                  onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                  placeholder="List all known allergies and adverse reactions..."
                  rows={6}
                  className="mt-2"
                />
              </div>
            )}

            {editDialog === 'past_medical' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Past Medical Conditions</Label>
                  <Button size="sm" onClick={() => addToArray('past_medical_history')}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Condition
                  </Button>
                </div>
                <div className="space-y-2">
                  {(formData.past_medical_history || []).map((condition, index) => (
                    <div key={rowKeys[index] ?? index} className="flex gap-2">
                      <Input
                        value={condition}
                        onChange={(e) => updateArrayItem('past_medical_history', index, e.target.value)}
                        placeholder="Enter medical condition..."
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFromArray('past_medical_history', index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editDialog === 'surgeries' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Surgeries & Hospitalizations</Label>
                  <Button size="sm" onClick={addHospitalizationRow}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Entry
                  </Button>
                </div>
                <div className="space-y-3">
                  {(formData.past_hospitalizations || []).length === 0 && (
                    <p className="text-sm text-slate-500 italic">No entries. Use “Add Entry” to record one.</p>
                  )}
                  {(formData.past_hospitalizations || []).map((hosp, index) => (
                    <div key={rowKeys[index] ?? index} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">Entry {index + 1}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFromArray('past_hospitalizations', index)}
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        value={hosp.reason || ''}
                        onChange={(e) => updateObjectArrayItem('past_hospitalizations', index, 'reason', e.target.value)}
                        placeholder="Reason / procedure"
                      />
                      <Input
                        value={hosp.hospital || ''}
                        onChange={(e) => updateObjectArrayItem('past_hospitalizations', index, 'hospital', e.target.value)}
                        placeholder="Hospital / facility"
                      />
                      <div className="flex gap-2">
                        <Input
                          type="date"
                          value={hosp.date || ''}
                          onChange={(e) => updateObjectArrayItem('past_hospitalizations', index, 'date', e.target.value)}
                        />
                        <Input
                          type="number"
                          min="0"
                          value={hosp.length_of_stay ?? ''}
                          onChange={(e) => updateObjectArrayItem('past_hospitalizations', index, 'length_of_stay', e.target.value)}
                          placeholder="Length of stay (days)"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editDialog === 'family_history' && (
              <div className="space-y-4">
                <div>
                  <Label>Conditions in the family</Label>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {FAMILY_HISTORY_CONDITIONS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox
                          id={`family-history-${key}`}
                          checked={!!formData.family_medical_history?.[key]}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            family_medical_history: {
                              ...formData.family_medical_history,
                              [key]: checked === true,
                            },
                          })}
                        />
                        <label htmlFor={`family-history-${key}`} className="text-sm text-slate-700">
                          {label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="family-history-notes">Notes</Label>
                  <Textarea
                    id="family-history-notes"
                    value={formData.family_medical_history?.notes || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      family_medical_history: {
                        ...formData.family_medical_history,
                        notes: e.target.value,
                      },
                    })}
                    placeholder="Hereditary conditions, affected relatives, age of onset..."
                    rows={5}
                    className="mt-2"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updatePatientMutation.isPending}>
              {updatePatientMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}