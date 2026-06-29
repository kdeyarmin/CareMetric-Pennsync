import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Stethoscope, ClipboardList, AlertTriangle, Activity } from "lucide-react";

const SCALES = [
  {
    name: "Braden Scale (Pressure Injury Risk)",
    category: "wound",
    description: "Scores sensory perception, moisture, activity, mobility, nutrition, and friction/shear.",
    scores: [
      { label: "Severely High Risk", range: "≤ 9", color: "bg-red-100 text-red-800" },
      { label: "High Risk", range: "10–12", color: "bg-orange-100 text-orange-800" },
      { label: "Moderate Risk", range: "13–14", color: "bg-yellow-100 text-yellow-800" },
      { label: "Mild Risk", range: "15–18", color: "bg-blue-100 text-blue-800" },
      { label: "No Risk", range: "19–23", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Sensory Perception", "Moisture", "Activity", "Mobility", "Nutrition", "Friction & Shear"],
  },
  {
    name: "Morse Fall Scale",
    category: "safety",
    description: "Assesses fall risk based on fall history, secondary diagnosis, ambulatory aid, IV therapy, gait, and mental status.",
    scores: [
      { label: "High Risk", range: "≥ 45", color: "bg-red-100 text-red-800" },
      { label: "Moderate Risk", range: "25–44", color: "bg-yellow-100 text-yellow-800" },
      { label: "Low Risk", range: "0–24", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Fall History", "Secondary Diagnosis", "Ambulatory Aid", "IV/Hep Lock", "Gait", "Mental Status"],
  },
  {
    name: "PHQ-9 (Depression Screening)",
    category: "mental",
    description: "9-item depression module assessing frequency of depressive symptoms over 2 weeks.",
    scores: [
      { label: "Severe", range: "20–27", color: "bg-red-100 text-red-800" },
      { label: "Moderately Severe", range: "15–19", color: "bg-orange-100 text-orange-800" },
      { label: "Moderate", range: "10–14", color: "bg-yellow-100 text-yellow-800" },
      { label: "Mild", range: "5–9", color: "bg-blue-100 text-blue-800" },
      { label: "Minimal/None", range: "0–4", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Anhedonia", "Depressed Mood", "Sleep", "Fatigue", "Appetite", "Self-worth", "Concentration", "Psychomotor", "SI"],
  },
  {
    name: "OASIS Functional Scores (GG Items)",
    category: "functional",
    description: "CMS-required functional assessment items for PDGM case mix grouping.",
    scores: [
      { label: "Independent", range: "06", color: "bg-green-100 text-green-800" },
      { label: "Setup/Cleanup Assist", range: "05", color: "bg-blue-100 text-blue-800" },
      { label: "Supervision", range: "04", color: "bg-blue-100 text-blue-800" },
      { label: "Partial/Moderate Assist", range: "03", color: "bg-yellow-100 text-yellow-800" },
      { label: "Substantial Assist", range: "02", color: "bg-orange-100 text-orange-800" },
      { label: "Dependent", range: "01", color: "bg-red-100 text-red-800" },
    ],
    domains: ["Eating", "Oral Hygiene", "Toileting Hygiene", "Shower/Bathe", "Upper Body Dressing", "Lower Body Dressing", "Mobility", "Walking"],
  },
  {
    name: "Pain Assessment (NRS / FLACC)",
    category: "pain",
    description: "Numeric Rating Scale and FLACC for patients who cannot self-report.",
    scores: [
      { label: "Severe Pain", range: "7–10", color: "bg-red-100 text-red-800" },
      { label: "Moderate Pain", range: "4–6", color: "bg-yellow-100 text-yellow-800" },
      { label: "Mild Pain", range: "1–3", color: "bg-blue-100 text-blue-800" },
      { label: "No Pain", range: "0", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Self-Report NRS", "Face (FLACC)", "Legs", "Activity", "Cry", "Consolability"],
  },
  {
    name: "Modified Rankin Scale (mRS)",
    category: "neurological",
    description: "Measures the degree of disability or dependence in daily activities after stroke.",
    scores: [
      { label: "Dead", range: "6", color: "bg-slate-200 text-slate-700" },
      { label: "Severe Disability", range: "5", color: "bg-red-100 text-red-800" },
      { label: "Moderately Severe", range: "4", color: "bg-orange-100 text-orange-800" },
      { label: "Moderate", range: "3", color: "bg-yellow-100 text-yellow-800" },
      { label: "Slight Disability", range: "2", color: "bg-blue-100 text-blue-800" },
      { label: "No Significant Disability", range: "1", color: "bg-green-100 text-green-800" },
      { label: "No Symptoms", range: "0", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Mobility", "Self-Care", "Communication", "Continence", "Cognition"],
  },
  {
    name: "FAST (Functional Assessment Staging Tool)",
    category: "hospice",
    description: "Stages functional decline in Alzheimer's/dementia. Stage 7c supports hospice eligibility when paired with comorbidities.",
    scores: [
      { label: "Stage 7 — Severe dementia (7a–7f)", range: "7", color: "bg-red-100 text-red-800" },
      { label: "Stage 6 — Moderately severe", range: "6", color: "bg-orange-100 text-orange-800" },
      { label: "Stage 5 — Moderate", range: "5", color: "bg-yellow-100 text-yellow-800" },
      { label: "Stage 4 — Mild", range: "4", color: "bg-blue-100 text-blue-800" },
      { label: "Stage 1–3 — Normal to early", range: "1–3", color: "bg-green-100 text-green-800" },
    ],
    domains: ["Ambulation", "Dressing", "Bathing", "Toileting", "Continence", "Speech (≤6 words)"],
  },
  {
    name: "PPS (Palliative Performance Scale)",
    category: "hospice",
    description: "Measures ambulation, activity, self-care, intake, and consciousness in palliative/hospice patients. Lower scores indicate decline.",
    scores: [
      { label: "Ambulatory / Full activity", range: "100–80%", color: "bg-green-100 text-green-800" },
      { label: "Reduced activity / Some assist", range: "70–60%", color: "bg-blue-100 text-blue-800" },
      { label: "Mainly sit/lie / Considerable assist", range: "50–40%", color: "bg-yellow-100 text-yellow-800" },
      { label: "Mainly in bed / Total care", range: "30–20%", color: "bg-orange-100 text-orange-800" },
      { label: "Bed bound / Comatose", range: "10–0%", color: "bg-red-100 text-red-800" },
    ],
    domains: ["Ambulation", "Activity & Evidence of Disease", "Self-Care", "Intake", "Conscious Level"],
  },
];

const PROTOCOLS = [
  {
    name: "CHF Daily Weight Monitoring Protocol",
    category: "cardiac",
    steps: [
      "Weigh every morning after voiding, before eating, in same clothing.",
      "Notify nurse if weight increases >2 lbs in 24 hrs or >5 lbs in 1 week.",
      "Restrict fluid intake per physician order (typically 1.5–2 L/day).",
      "Document daily weights in log book or app.",
      "Monitor for edema in feet/ankles, dyspnea, fatigue.",
    ],
    triggers: "Weight gain, dyspnea, leg swelling, orthopnea",
  },
  {
    name: "Pressure Injury Prevention Protocol",
    category: "wound",
    steps: [
      "Assess skin at every visit using Braden Scale.",
      "Reposition immobile patients every 2 hours.",
      "Use pressure-redistributing mattress/cushion.",
      "Maintain skin clean and dry; use moisture barriers.",
      "Optimize nutrition: protein 1.2–1.5 g/kg/day, adequate hydration.",
      "Document all wounds with photo and measurements (L x W x D).",
    ],
    triggers: "Braden ≤ 18, prolonged immobility, incontinence, poor nutrition",
  },
  {
    name: "Fall Prevention Protocol",
    category: "safety",
    steps: [
      "Perform Morse Fall Scale at each visit.",
      "Ensure call light, phone, walker within reach.",
      "Remove trip hazards (rugs, cords, clutter).",
      "Assess footwear — no socks alone, proper non-slip shoes.",
      "Medication review for orthostatics, sedatives, diuretics.",
      "Encourage supervised ambulation for high-risk patients.",
    ],
    triggers: "Morse ≥ 25, recent fall, new medication changes, gait changes",
  },
  {
    name: "Diabetic Foot Care Protocol",
    category: "diabetes",
    steps: [
      "Inspect feet at every visit — between toes, soles, heels.",
      "Wash feet in lukewarm water; dry thoroughly between toes.",
      "Apply lotion to dry skin but NOT between toes.",
      "Trim nails straight across; refer to podiatry if needed.",
      "Ensure patient wears appropriate diabetic footwear.",
      "Document any cuts, blisters, redness, or swelling.",
    ],
    triggers: "ABI <0.9, neuropathy symptoms, HbA1c >9%, open wounds",
  },
  {
    name: "Anticoagulation Monitoring Protocol (Warfarin)",
    category: "medication",
    steps: [
      "Assess for signs of bleeding: bruising, blood in urine/stool, prolonged cuts.",
      "Review INR at each visit per physician orders.",
      "Educate on consistent Vitamin K intake (leafy greens).",
      "Review all new medications for interactions.",
      "Remind patient not to take NSAIDs or aspirin without physician approval.",
      "Document INR results and dose adjustments.",
    ],
    triggers: "INR >3.5 or <1.5, new bruising, dietary changes, new medications",
  },
  {
    name: "Oxygen Therapy & COPD Management Protocol",
    category: "respiratory",
    steps: [
      "Verify oxygen flow rate matches physician order.",
      "Assess SpO2 at rest and with activity at each visit.",
      "Teach pursed-lip breathing and diaphragmatic breathing.",
      "Inspect skin around nasal cannula for breakdown.",
      "Ensure O2 equipment is clean and humidifier filled if ordered.",
      "Educate on smoking cessation if applicable.",
    ],
    triggers: "SpO2 <88% on room air, respiratory rate >24, accessory muscle use",
  },
];

const VITALS_REFERENCE = [
  { parameter: "Blood Pressure", normal: "< 120/80 mmHg", concern: "≥ 140/90 mmHg", critical: "≥ 180/120 or < 90/60 mmHg" },
  { parameter: "Heart Rate", normal: "60–100 bpm", concern: "< 50 or > 100 bpm", critical: "< 40 or > 150 bpm" },
  { parameter: "Respiratory Rate", normal: "12–20 breaths/min", concern: "< 10 or > 24 breaths/min", critical: "< 8 or > 30 breaths/min" },
  { parameter: "SpO2", normal: "≥ 95%", concern: "90–94%", critical: "< 90%" },
  { parameter: "Temperature", normal: "97.8–99.1°F (36.6–37.3°C)", concern: "99.5–103°F or < 96.8°F", critical: "≥ 103.5°F or < 95°F" },
  { parameter: "Blood Glucose", normal: "70–140 mg/dL", concern: "< 70 or 141–250 mg/dL", critical: "< 50 or > 300 mg/dL" },
  { parameter: "Pain Score (NRS)", normal: "0", concern: "1–6", critical: "7–10 / uncontrolled" },
  { parameter: "Weight Change (CHF)", normal: "Stable ±1 lb", concern: "+2 lbs/24h", critical: "+5 lbs/week" },
];

const categoryColors = {
  wound: "bg-orange-100 text-orange-800",
  safety: "bg-yellow-100 text-yellow-800",
  mental: "bg-navy-100 text-navy-800",
  functional: "bg-blue-100 text-blue-800",
  pain: "bg-red-100 text-red-800",
  neurological: "bg-indigo-100 text-indigo-800",
  cardiac: "bg-red-100 text-red-800",
  diabetes: "bg-emerald-100 text-emerald-800",
  medication: "bg-navy-100 text-navy-800",
  respiratory: "bg-navy-100 text-navy-800",
  hospice: "bg-purple-100 text-purple-800",
};

export default function ClinicalReferencePanel() {
  const [search, setSearch] = useState("");

  const filteredScales = SCALES.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProtocols = PROTOCOLS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.steps.some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search clinical references..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="scales">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="scales"><ClipboardList className="w-4 h-4 mr-2" />Assessment Scales</TabsTrigger>
          <TabsTrigger value="protocols"><Stethoscope className="w-4 h-4 mr-2" />Clinical Protocols</TabsTrigger>
          <TabsTrigger value="vitals"><Activity className="w-4 h-4 mr-2" />Vitals Reference</TabsTrigger>
        </TabsList>

        {/* Assessment Scales */}
        <TabsContent value="scales" className="mt-4 grid md:grid-cols-2 gap-4">
          {filteredScales.map((scale) => (
            <Card key={scale.name} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold text-slate-900">{scale.name}</CardTitle>
                  <Badge className={`text-xs flex-shrink-0 ${categoryColors[scale.category] || "bg-slate-100 text-slate-700"}`}>
                    {scale.category}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600">{scale.description}</p>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="space-y-1">
                  {scale.scores.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">{s.label}</span>
                      <Badge className={`text-xs ${s.color}`}>{s.range}</Badge>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 pt-1 border-t">
                  {scale.domains.map((d) => (
                    <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Clinical Protocols */}
        <TabsContent value="protocols" className="mt-4 space-y-4">
          {filteredProtocols.map((protocol) => (
            <Card key={protocol.name} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold text-slate-900">{protocol.name}</CardTitle>
                  <Badge className={`text-xs flex-shrink-0 ${categoryColors[protocol.category] || "bg-slate-100 text-slate-700"}`}>
                    {protocol.category}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ol className="space-y-1.5">
                  {protocol.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span><strong>Triggers:</strong> {protocol.triggers}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Vitals Reference */}
        <TabsContent value="vitals" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600" />
                Vital Signs Quick Reference
              </CardTitle>
              <p className="text-sm text-slate-600">Normal ranges, concerning values, and critical thresholds for home health documentation.</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead className="text-emerald-700">Normal</TableHead>
                    <TableHead className="text-amber-700">Concern</TableHead>
                    <TableHead className="text-red-700">Critical</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {VITALS_REFERENCE.map((row) => (
                    <TableRow key={row.parameter}>
                      <TableCell className="font-medium text-slate-900">{row.parameter}</TableCell>
                      <TableCell className="text-emerald-700">{row.normal}</TableCell>
                      <TableCell className="text-amber-700">{row.concern}</TableCell>
                      <TableCell className="text-red-700">{row.critical}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-slate-500 mt-3">* Values are general guidelines. Always follow physician-specific orders and patient baseline values.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}