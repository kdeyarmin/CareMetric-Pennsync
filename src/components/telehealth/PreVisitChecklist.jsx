import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertCircle, Wifi, Mic, Video, Eye } from 'lucide-react';

export default function PreVisitChecklist({ onReadyChange, isNurse = false }) {
  const [checks, setChecks] = useState({
    lighting: false,
    internet: false,
    microphone: false,
    camera: false,
    quiet: false
  });

  const allChecked = Object.values(checks).every(v => v);

  const toggleCheck = (key) => {
    const updated = { ...checks, [key]: !checks[key] };
    setChecks(updated);
    onReadyChange && onReadyChange(Object.values(updated).every(v => v));
  };

  const checkItems = isNurse ? [
    { key: 'lighting', label: 'Good lighting - I can see clearly', icon: Eye },
    { key: 'internet', label: 'Strong internet connection', icon: Wifi },
    { key: 'microphone', label: 'Microphone working', icon: Mic },
    { key: 'camera', label: 'Camera working and positioned', icon: Video },
    { key: 'quiet', label: 'Quiet, private environment', icon: AlertCircle }
  ] : [
    { key: 'lighting', label: 'I have good lighting', icon: Eye },
    { key: 'internet', label: 'My internet connection is stable', icon: Wifi },
    { key: 'microphone', label: 'My microphone is working', icon: Mic },
    { key: 'camera', label: 'My camera is working', icon: Video },
    { key: 'quiet', label: 'I\'m in a quiet, private space', icon: AlertCircle }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pre-Visit Checklist</CardTitle>
        <p className="text-sm text-slate-600 mt-1">Please confirm these before joining</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {checkItems.map(item => (
          <label key={item.key} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition">
            <input
              type="checkbox"
              checked={checks[item.key]}
              onChange={() => toggleCheck(item.key)}
              className="w-5 h-5 rounded border-slate-300"
            />
            <item.icon className="w-5 h-5 text-slate-500 flex-shrink-0" />
            <span className="text-sm text-slate-700 flex-1">{item.label}</span>
            {checks[item.key] && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />}
          </label>
        ))}

        {allChecked && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            ✓ You're all set! Ready to join the visit.
          </div>
        )}
      </CardContent>
    </Card>
  );
}