import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function RetakeSettingsPanel({ settings, onChange }) {
  return (
    <Card>
      <CardHeader><CardTitle>Retake Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Keep a cleared field empty ('') rather than silently coercing to 0 —
              a 0 "passing score" reads as "no passing requirement". */}
          <Input type="number" value={settings.passingScoreRequired} onChange={(e) => onChange({ ...settings, passingScoreRequired: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Passing score" />
          <Input type="number" value={settings.maxAttempts} onChange={(e) => onChange({ ...settings, maxAttempts: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Max attempts" />
          <Input type="number" value={settings.waitingPeriodHours} onChange={(e) => onChange({ ...settings, waitingPeriodHours: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Waiting period hours" />
          <Select value={settings.priority} onValueChange={(value) => onChange({ ...settings, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select>
        </div>
        <div className="space-y-2 text-sm">
          <label htmlFor="retake-regenerate-test" className="flex items-center gap-2"><Checkbox id="retake-regenerate-test" checked={settings.regenerateTestOnRetake} onCheckedChange={(checked) => onChange({ ...settings, regenerateTestOnRetake: !!checked })} /><span>Randomize retake questions</span></label>
          <label htmlFor="retake-show-correct-answers" className="flex items-center gap-2"><Checkbox id="retake-show-correct-answers" checked={settings.showCorrectAnswers} onCheckedChange={(checked) => onChange({ ...settings, showCorrectAnswers: !!checked })} /><span>Show correct answers</span></label>
          <label htmlFor="retake-attestation-required" className="flex items-center gap-2"><Checkbox id="retake-attestation-required" checked={settings.attestationRequired} onCheckedChange={(checked) => onChange({ ...settings, attestationRequired: !!checked })} /><span>Require attestation</span></label>
          <label htmlFor="retake-required" className="flex items-center gap-2"><Checkbox id="retake-required" checked={settings.required} onCheckedChange={(checked) => onChange({ ...settings, required: !!checked })} /><span>Required assignment</span></label>
        </div>
      </CardContent>
    </Card>
  );
}