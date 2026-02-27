import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, AlertTriangle, Clock, Calendar, Award,
  ChevronDown, ChevronUp, Download, Loader2, RefreshCw, Users, Shield
} from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { toast } from "sonner";

// Standard yearly home health / hospice inservices required by CMS / state regulations
const REQUIRED_INSERVICES = [
  {
    id: "infection_control",
    title: "Infection Control & Prevention",
    category: "Safety",
    description: "Standard precautions, hand hygiene, PPE use, bloodborne pathogen exposure prevention, and isolation procedures.",
    duration_minutes: 60,
    regulatory_basis: "CMS CoP §484.75 / OSHA 29 CFR 1910.1030",
    topics: ["Hand hygiene protocols", "PPE selection and use", "Bloodborne pathogen exposure", "Isolation procedures", "Sharps safety", "COVID-19 & respiratory precautions"],
    required_for: ["RN", "LPN", "CNA", "HHA", "PT", "OT", "ST", "MSW"]
  },
  {
    id: "hipaa_privacy",
    title: "HIPAA Privacy & Security",
    category: "Compliance",
    description: "Patient privacy rights, PHI safeguarding, breach reporting, and electronic health record security.",
    duration_minutes: 60,
    regulatory_basis: "HIPAA Privacy Rule / Security Rule 45 CFR Parts 160 & 164",
    topics: ["PHI definition and examples", "Minimum necessary standard", "Patient rights", "Electronic PHI security", "Breach notification", "Social media & privacy"],
    required_for: ["All Staff"]
  },
  {
    id: "patient_rights",
    title: "Patient Rights & Responsibilities",
    category: "Compliance",
    description: "Home health patient rights under Medicare, advance directives, grievance procedures, and non-discrimination.",
    duration_minutes: 45,
    regulatory_basis: "CMS CoP §484.50",
    topics: ["Patient rights under Medicare", "Advance directives", "Grievance process", "Non-discrimination", "Right to participate in care planning", "Abuse/neglect reporting"],
    required_for: ["All Staff"]
  },
  {
    id: "abuse_neglect",
    title: "Abuse, Neglect & Exploitation Prevention",
    category: "Safety",
    description: "Recognition, prevention, and mandatory reporting of patient abuse, neglect, and financial exploitation.",
    duration_minutes: 60,
    regulatory_basis: "CMS CoP §484.75 / State mandatory reporting laws",
    topics: ["Types of abuse and neglect", "Risk factors and warning signs", "Mandatory reporting requirements", "Documentation requirements", "Agency reporting procedures", "Employee code of conduct"],
    required_for: ["All Staff"]
  },
  {
    id: "emergency_preparedness",
    title: "Emergency Preparedness",
    category: "Safety",
    description: "Agency emergency plan, individual patient emergency plans, communication protocols during disasters.",
    duration_minutes: 60,
    regulatory_basis: "CMS Emergency Preparedness Rule §484.102",
    topics: ["Agency emergency operations plan", "Patient risk categorization", "Communication tree", "Evacuation procedures", "Shelter-in-place protocols", "Documentation during emergencies"],
    required_for: ["All Staff"]
  },
  {
    id: "fall_prevention",
    title: "Fall Risk Assessment & Prevention",
    category: "Clinical",
    description: "Fall risk screening tools, environmental assessment, intervention strategies, and post-fall management.",
    duration_minutes: 60,
    regulatory_basis: "CMS CoP §484.60 / TJC Standards",
    topics: ["Morse Fall Scale / STEADI tool", "Intrinsic vs extrinsic risk factors", "Medication-related fall risk", "Home environment safety assessment", "Patient/caregiver education", "Post-fall documentation"],
    required_for: ["RN", "LPN", "CNA", "HHA", "PT", "OT"]
  },
  {
    id: "medication_management",
    title: "Medication Management & Safety",
    category: "Clinical",
    description: "Medication reconciliation, high-alert medications, side effects monitoring, and safe disposal.",
    duration_minutes: 60,
    regulatory_basis: "CMS CoP §484.60",
    topics: ["High-alert medications", "Medication reconciliation process", "Side effects monitoring and reporting", "Safe medication storage", "Controlled substance compliance", "Safe disposal methods"],
    required_for: ["RN", "LPN", "NP", "MD"]
  },
  {
    id: "cultural_competency",
    title: "Cultural Competency & Diversity",
    category: "Compliance",
    description: "Culturally sensitive care delivery, communication with diverse populations, and implicit bias awareness.",
    duration_minutes: 45,
    regulatory_basis: "CMS CoP §484.50 / Section 1557 ACA",
    topics: ["Cultural humility principles", "Health literacy strategies", "Working with interpreters", "Religious and cultural considerations", "LGBTQ+ inclusive care", "Implicit bias self-reflection"],
    required_for: ["All Staff"]
  },
  {
    id: "oasis_documentation",
    title: "OASIS Documentation & Accuracy",
    category: "Clinical",
    description: "OASIS data item accuracy, timing requirements, and impact on PDGM reimbursement.",
    duration_minutes: 90,
    regulatory_basis: "CMS OASIS Guidance Manual",
    topics: ["OASIS timing requirements", "Accurate data item completion", "PDGM case mix impact", "Common OASIS errors", "Correction procedures", "Survey readiness"],
    required_for: ["RN", "PT", "OT", "ST"]
  },
  {
    id: "wound_care",
    title: "Wound Care Management",
    category: "Clinical",
    description: "Wound assessment, staging, dressing selection, and documentation for Medicare compliance.",
    duration_minutes: 60,
    regulatory_basis: "CMS CoP §484.60",
    topics: ["Wound assessment and staging", "Pressure ulcer prevention (NPUAP guidelines)", "Dressing selection principles", "Wound measurement and photography", "Signs of wound infection", "Documentation requirements"],
    required_for: ["RN", "LPN", "PT", "OT"]
  },
  {
    id: "skilled_need_justification",
    title: "Skilled Need Justification & Homebound Status",
    category: "Clinical",
    description: "Documenting skilled care need and homebound criteria to support Medicare coverage.",
    duration_minutes: 60,
    regulatory_basis: "CMS Medicare Benefit Policy Manual Chapter 7",
    topics: ["Definition of homebound status", "Documenting normal inability to leave home", "Skilled nursing criteria", "Therapy justification", "Discharge criteria", "ADR readiness"],
    required_for: ["RN", "LPN", "PT", "OT", "ST"]
  },
  {
    id: "hipaa_cybersecurity",
    title: "Cybersecurity & Data Protection",
    category: "Compliance",
    description: "Phishing awareness, password security, mobile device use, and electronic PHI protection.",
    duration_minutes: 30,
    regulatory_basis: "HIPAA Security Rule 45 CFR Part 164",
    topics: ["Phishing recognition", "Strong password practices", "Secure mobile device use", "Safe email practices", "Incident reporting", "Working remotely securely"],
    required_for: ["All Staff"]
  },
];

const CATEGORY_COLORS = {
  Safety: "bg-red-100 text-red-800 border-red-200",
  Compliance: "bg-blue-100 text-blue-800 border-blue-200",
  Clinical: "bg-green-100 text-green-800 border-green-200",
};

function InserviceCard({ inservice, completion, userRole, onMarkComplete, onViewDetails, isAdmin, allCompletions }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = !!completion;
  const isApplicable = inservice.required_for.includes("All Staff") || inservice.required_for.includes(userRole);

  // For admin: show how many staff completed
  const staffCompletedCount = isAdmin ? (allCompletions?.filter(c => c.inservice_id === inservice.id).length || 0) : null;

  const completedDate = completion?.completed_date
    ? format(new Date(completion.completed_date), "MMM d, yyyy")
    : null;

  const isExpiringSoon = completion?.completed_date
    ? isAfter(new Date(), addDays(new Date(completion.completed_date), 335)) // within 30 days of annual renewal
    : false;

  return (
    <Card className={`transition-all ${isCompleted ? "border-green-200 bg-green-50/30" : isApplicable ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 flex-shrink-0">
              {isCompleted ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-slate-800">{inservice.title}</h3>
                <Badge className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[inservice.category]}`}>{inservice.category}</Badge>
                {!isApplicable && <Badge variant="outline" className="text-[10px]">Not required for your role</Badge>}
                {isExpiringSoon && <Badge className="bg-orange-100 text-orange-800 text-[10px]">Renewal Soon</Badge>}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{inservice.description}</p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{inservice.duration_minutes} min</span>
                {completedDate && <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="w-3 h-3" />Completed {completedDate}</span>}
                {isAdmin && staffCompletedCount !== null && (
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{staffCompletedCount} staff completed</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {isApplicable && !isCompleted && (
              <Button size="sm" onClick={() => onMarkComplete(inservice)} className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                Mark Complete
              </Button>
            )}
            {isCompleted && isExpiringSoon && (
              <Button size="sm" variant="outline" onClick={() => onMarkComplete(inservice)} className="h-7 text-xs border-orange-300 text-orange-700">
                <RefreshCw className="w-3 h-3 mr-1" /> Renew
              </Button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-slate-600 flex items-center gap-1 text-[10px]"
            >
              {expanded ? <><ChevronUp className="w-3 h-3" />Less</> : <><ChevronDown className="w-3 h-3" />Details</>}
            </button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-4">
          <div className="border-t border-slate-200 pt-3 space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Topics Covered</p>
              <div className="flex flex-wrap gap-1">
                {inservice.topics.map((topic, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] bg-slate-50">{topic}</Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <div>
                <span className="font-semibold text-slate-700">Regulatory Basis: </span>
                <span className="text-slate-500">{inservice.regulatory_basis}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Required For: </span>
                <span className="text-slate-500">{inservice.required_for.join(", ")}</span>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function MarkCompleteDialog({ inservice, onConfirm, onCancel, saving }) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [instructor, setInstructor] = useState("");
  const [method, setMethod] = useState("in_person");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Record Inservice Completion</CardTitle>
          <p className="text-xs text-slate-600 mt-1">{inservice?.title}</p>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Completion Date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Delivery Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)} className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="in_person">In-Person</option>
              <option value="online">Online / eLearning</option>
              <option value="webinar">Live Webinar</option>
              <option value="self_study">Self-Study / Reading</option>
              <option value="competency_check">Competency Check-Off</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Instructor / Presenter</label>
            <input
              type="text"
              value={instructor}
              onChange={e => setInstructor(e.target.value)}
              placeholder="Name or 'Self-directed'"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onCancel} className="flex-1 h-9 text-xs">Cancel</Button>
            <Button onClick={() => onConfirm({ date, instructor, method })} disabled={saving || !date} className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
              Record Completion
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function YearlyInservices({ userEmail, userRole, isAdmin }) {
  const [markingInservice, setMarkingInservice] = useState(null);
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [saving, setSaving] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(userEmail);
  const queryClient = useQueryClient();

  const year = new Date().getFullYear();

  // Fetch completions for the selected user this year
  const { data: completions = [], isLoading } = useQuery({
    queryKey: ["inservice-completions", selectedStaff, year],
    queryFn: () => base44.entities.TrainingCompletion.filter({
      nurse_email: selectedStaff,
      inservice_year: year
    }),
    enabled: !!selectedStaff,
  });

  // For admin: all completions
  const { data: allCompletions = [] } = useQuery({
    queryKey: ["all-inservice-completions", year],
    queryFn: () => base44.entities.TrainingCompletion.filter({ inservice_year: year }),
    enabled: isAdmin,
  });

  // For admin: staff list
  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers"],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  const completionMap = {};
  completions.forEach(c => { completionMap[c.inservice_id] = c; });

  const applicable = REQUIRED_INSERVICES.filter(i =>
    i.required_for.includes("All Staff") || i.required_for.includes(userRole)
  );
  const completedCount = applicable.filter(i => completionMap[i.id]).length;
  const completionPct = applicable.length > 0 ? Math.round((completedCount / applicable.length) * 100) : 0;

  const filtered = REQUIRED_INSERVICES.filter(i => {
    const catOk = filterCategory === "All" || i.category === filterCategory;
    const isApplicable = i.required_for.includes("All Staff") || i.required_for.includes(userRole);
    const isCompleted = !!completionMap[i.id];
    const statusOk = filterStatus === "All"
      || (filterStatus === "Completed" && isCompleted)
      || (filterStatus === "Pending" && !isCompleted && isApplicable)
      || (filterStatus === "Not Required" && !isApplicable);
    return catOk && statusOk;
  });

  const handleMarkComplete = async ({ date, instructor, method }) => {
    if (!markingInservice) return;
    setSaving(true);
    try {
      // Check for existing record and update, or create new
      const existing = completionMap[markingInservice.id];
      if (existing) {
        await base44.entities.TrainingCompletion.update(existing.id, {
          completed_date: date,
          status: "completed",
          instructor_name: instructor,
          delivery_method: method,
          inservice_year: year,
        });
      } else {
        await base44.entities.TrainingCompletion.create({
          nurse_email: selectedStaff,
          training_module_id: markingInservice.id,
          inservice_id: markingInservice.id,
          inservice_title: markingInservice.title,
          status: "completed",
          completed_date: date,
          instructor_name: instructor,
          delivery_method: method,
          inservice_year: year,
          inservice_category: markingInservice.category,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["inservice-completions"] });
      queryClient.invalidateQueries({ queryKey: ["all-inservice-completions"] });
      toast.success(`"${markingInservice.title}" marked as complete`);
      setMarkingInservice(null);
    } catch (e) {
      toast.error("Failed to record completion");
    } finally {
      setSaving(false);
    }
  };

  const exportSummary = () => {
    const lines = [
      `Yearly Inservice Completion Report — ${year}`,
      `Staff: ${selectedStaff}`,
      `Generated: ${format(new Date(), "MMM d, yyyy")}`,
      "",
      `Completion: ${completedCount}/${applicable.length} (${completionPct}%)`,
      "",
      ...REQUIRED_INSERVICES.map(i => {
        const c = completionMap[i.id];
        const applicable = i.required_for.includes("All Staff") || i.required_for.includes(userRole);
        if (!applicable) return `[ N/A ] ${i.title}`;
        if (c) return `[  ✓  ] ${i.title} — ${c.completed_date || ""}`;
        return `[     ] ${i.title} — PENDING`;
      })
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inservice-report-${year}-${selectedStaff}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header & Progress */}
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-base">{year} Required Annual Inservices</h2>
                <p className="text-xs text-slate-600 mt-0.5">{REQUIRED_INSERVICES.length} required topics · {applicable.length} applicable to your role</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-700">{completionPct}%</p>
                <p className="text-[10px] text-slate-500">Complete</p>
              </div>
              <Button variant="outline" size="sm" onClick={exportSummary} className="h-8 text-xs">
                <Download className="w-3 h-3 mr-1" /> Export
              </Button>
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-600">
              <span>{completedCount} of {applicable.length} completed</span>
              <span className={completionPct === 100 ? "text-green-700 font-semibold" : "text-blue-700"}>{completionPct === 100 ? "✅ All Done!" : `${applicable.length - completedCount} remaining`}</span>
            </div>
            <Progress value={completionPct} className="h-2.5" />
          </div>

          {/* Category summary */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {["Safety", "Compliance", "Clinical"].map(cat => {
              const catItems = applicable.filter(i => i.category === cat);
              const catDone = catItems.filter(i => completionMap[i.id]).length;
              const pct = catItems.length > 0 ? Math.round((catDone / catItems.length) * 100) : 0;
              return (
                <div key={cat} className="bg-white/70 rounded-lg p-2 text-center border border-white/50">
                  <div className={`text-sm font-bold ${pct === 100 ? "text-green-700" : "text-slate-800"}`}>{catDone}/{catItems.length}</div>
                  <div className="text-[10px] text-slate-500">{cat}</div>
                  <Progress value={pct} className="h-1 mt-1" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Admin: staff switcher */}
      {isAdmin && (
        <div className="flex items-center gap-3 flex-wrap">
          <Users className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-600">Viewing:</span>
          <select
            value={selectedStaff}
            onChange={e => setSelectedStaff(e.target.value)}
            className="h-8 px-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={userEmail}>My Records</option>
            {allUsers.filter(u => u.email !== userEmail).map(u => (
              <option key={u.id} value={u.email}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1">
          {["All", "Safety", "Compliance", "Clinical"].map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${filterCategory === cat ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {["All", "Completed", "Pending"].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${filterStatus === s ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Inservice list */}
      <div className="space-y-2">
        {filtered.map(inservice => (
          <InserviceCard
            key={inservice.id}
            inservice={inservice}
            completion={completionMap[inservice.id]}
            userRole={userRole}
            isAdmin={isAdmin}
            allCompletions={allCompletions}
            onMarkComplete={(i) => setMarkingInservice(i)}
          />
        ))}
      </div>

      {/* Mark complete dialog */}
      {markingInservice && (
        <MarkCompleteDialog
          inservice={markingInservice}
          saving={saving}
          onConfirm={handleMarkComplete}
          onCancel={() => setMarkingInservice(null)}
        />
      )}
    </div>
  );
}