import React, { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Heart,
  Thermometer,
  Wind,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info
} from "lucide-react";

// Vital sign validation and ranges - moved outside component
const vitalRanges = {
    bp: {
      parse: (val) => {
        const match = val?.match(/(\d+)\s*\/\s*(\d+)/);
        return match ? { systolic: parseInt(match[1]), diastolic: parseInt(match[2]) } : null;
      },
      validate: (parsed) => {
        if (!parsed) return null;
        if (parsed.systolic >= 180 || parsed.diastolic >= 120) return 'critical';
        if (parsed.systolic >= 140 || parsed.diastolic >= 90) return 'high';
        if (parsed.systolic < 90 || parsed.diastolic < 60) return 'low';
        return 'normal';
      },
      normalRange: '90-140 / 60-90',
      unit: 'mmHg'
    },
    hr: {
      parse: (val) => val ? parseInt(val) : null,
      validate: (parsed) => {
        if (!parsed) return null;
        if (parsed > 120 || parsed < 50) return 'critical';
        if (parsed > 100) return 'high';
        if (parsed < 60) return 'low';
        return 'normal';
      },
      normalRange: '60-100',
      unit: 'bpm'
    },
    temp: {
      parse: (val) => val ? parseFloat(val) : null,
      validate: (parsed) => {
        if (!parsed) return null;
        if (parsed >= 102 || parsed < 95) return 'critical';
        if (parsed >= 100.4) return 'high';
        if (parsed < 97) return 'low';
        return 'normal';
      },
      normalRange: '97.0-99.5',
      unit: '°F'
    },
    o2: {
      parse: (val) => val ? parseInt(val) : null,
      validate: (parsed) => {
        if (!parsed) return null;
        if (parsed < 88) return 'critical';
        if (parsed < 92) return 'low';
        return 'normal';
      },
      normalRange: '≥95%',
      unit: '%'
    },
    pain: {
      parse: (val) => val ? parseInt(val) : null,
      validate: (parsed) => {
        if (!parsed && parsed !== 0) return null;
        if (parsed >= 8) return 'critical';
        if (parsed >= 5) return 'high';
        if (parsed >= 1) return 'moderate';
        return 'normal';
      },
      normalRange: '0',
      unit: '/10'
    }
  };

const getStatusColor = (status) => {
    switch (status) {
      case 'critical': return 'border-red-500 bg-red-50 ring-2 ring-red-200';
      case 'high': return 'border-orange-400 bg-orange-50';
      case 'low': return 'border-yellow-400 bg-yellow-50';
      case 'moderate': return 'border-yellow-400 bg-yellow-50';
      case 'normal': return 'border-green-400 bg-green-50';
      default: return 'border-slate-200';
    }
};

const getStatusIcon = (status) => {
    if (!status) return null;
    if (status === 'normal') return <CheckCircle2 className="w-3 h-3 text-green-600" />;
    if (status === 'critical') return <AlertTriangle className="w-3 h-3 text-red-600 animate-pulse" />;
    return <AlertTriangle className="w-3 h-3 text-orange-500" />;
};

const VitalInput = React.memo(({ field, label, icon: Icon, placeholder, value, onChangeValue }) => {
  const range = vitalRanges[field];
  const parsed = range.parse(value);
  const status = range.validate(parsed);

  return (
    <div className="relative">
      <Label className="text-xs flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" />
        {label}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex">
              <Info className="w-3 h-3 text-slate-400 cursor-help" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2">
            <p className="text-xs">
              <strong>Normal:</strong> {range.normalRange} {range.unit}
            </p>
          </PopoverContent>
        </Popover>
      </Label>
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          className={`pr-8 text-sm transition-all ${status ? getStatusColor(status) : ''}`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
          {getStatusIcon(status)}
        </div>
      </div>
      {status && status !== 'normal' && value && (
        <Badge 
          variant="outline" 
          className={`mt-1 text-[10px] ${
            status === 'critical' ? 'bg-red-100 text-red-800 border-red-300' :
            status === 'high' ? 'bg-orange-100 text-orange-800 border-orange-300' :
            'bg-yellow-100 text-yellow-800 border-yellow-300'
          }`}
        >
          {status === 'critical' ? 'Critical' : status === 'high' ? 'Elevated' : 'Low'}
        </Badge>
      )}
    </div>
  );
});

export default function SmartVitalsInput({ vitalSigns, onChange }) {
  const handleFieldChange = useCallback((field) => (value) => {
    onChange({ ...vitalSigns, [field]: value });
  }, [vitalSigns, onChange]);

  const handleO2SourceChange = useCallback((value) => {
    onChange({ ...vitalSigns, o2Source: value });
  }, [vitalSigns, onChange]);

  const handleO2FlowChange = useCallback((e) => {
    onChange({ ...vitalSigns, o2Flow: e.target.value });
  }, [vitalSigns, onChange]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <VitalInput field="bp" label="Blood Pressure" icon={Heart} placeholder="120/80" value={vitalSigns.bp || ''} onChangeValue={handleFieldChange('bp')} />
        <VitalInput field="hr" label="Heart Rate" icon={Activity} placeholder="72" value={vitalSigns.hr || ''} onChangeValue={handleFieldChange('hr')} />
        <VitalInput field="temp" label="Temperature" icon={Thermometer} placeholder="98.6" value={vitalSigns.temp || ''} onChangeValue={handleFieldChange('temp')} />
        <VitalInput field="pain" label="Pain Level" icon={Activity} placeholder="0-10" value={vitalSigns.pain || ''} onChangeValue={handleFieldChange('pain')} />
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <VitalInput field="o2" label="O2 Saturation" icon={Wind} placeholder="98" value={vitalSigns.o2 || ''} onChangeValue={handleFieldChange('o2')} />
        <div>
          <Label className="text-xs mb-1 block">O2 Source</Label>
          <Select 
            value={vitalSigns.o2Source || 'room_air'} 
            onValueChange={handleO2SourceChange}
          >
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="room_air">Room Air</SelectItem>
              <SelectItem value="on_oxygen">On Oxygen</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {vitalSigns.o2Source === 'on_oxygen' && (
          <div>
            <Label className="text-xs mb-1 block">O2 Flow Rate</Label>
            <Input
              placeholder="L/min"
              value={vitalSigns.o2Flow || ''}
              onChange={handleO2FlowChange}
              className="text-sm"
            />
          </div>
        )}
      </div>

      {/* Quick status summary */}
      {Object.values(vitalSigns).some(v => v) && (
        <div className="flex flex-wrap gap-1 pt-2 border-t">
          {Object.entries(vitalRanges).map(([field, range]) => {
            const parsed = range.parse(vitalSigns[field]);
            const status = range.validate(parsed);
            if (!status || !vitalSigns[field]) return null;
            return (
              <Badge 
                key={field}
                variant="outline"
                className={`text-[10px] ${
                  status === 'normal' ? 'bg-green-50 text-green-700 border-green-200' :
                  status === 'critical' ? 'bg-red-100 text-red-800 border-red-300' :
                  'bg-yellow-50 text-yellow-700 border-yellow-200'
                }`}
              >
                {field.toUpperCase()}: {status === 'normal' ? '✓' : '⚠'}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}