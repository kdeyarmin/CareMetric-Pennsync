import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Settings,
  Plus,
  Edit,
  Trash2,
  Shield,
  AlertTriangle,
  Search,
  Loader2
} from "lucide-react";

const RULE_CATEGORIES = [
  { value: 'oasis', label: 'OASIS', color: 'bg-blue-100 text-blue-800' },
  { value: 'medicare_cop', label: 'Medicare CoP', color: 'bg-navy-100 text-navy-800' },
  { value: 'state_regulation', label: 'State Regulation', color: 'bg-green-100 text-green-800' },
  { value: 'agency_policy', label: 'Agency Policy', color: 'bg-orange-100 text-orange-800' },
  { value: 'hipaa', label: 'HIPAA', color: 'bg-red-100 text-red-800' },
  { value: 'quality_measure', label: 'Quality Measure', color: 'bg-navy-100 text-navy-800' },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical', color: 'bg-red-600' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'bg-blue-500' },
];

const DEFAULT_RULES = [
  {
    rule_name: "Homebound Status Documentation",
    rule_category: "medicare_cop",
    rule_code: "CoP 484.55(a)",
    description: "Patient must be documented as homebound - unable to leave home without considerable and taxing effort",
    required_elements: ["homebound status", "reason for homebound", "taxing effort description"],
    keywords: ["homebound", "unable to leave", "taxing effort", "confined to home", "difficulty leaving"],
    severity: "critical",
    applies_to_visit_types: ["admission", "recertification", "routine_visit"],
    applies_to_care_type: "home_health",
    penalty_description: "Claims may be denied; potential fraud investigation",
    remediation_steps: ["Add homebound justification", "Document specific mobility limitations", "Include why leaving home is taxing"]
  },
  {
    rule_name: "Skilled Need Justification",
    rule_category: "medicare_cop",
    rule_code: "CoP 484.55(b)",
    description: "Documentation must justify why skilled nursing services are required vs. non-skilled care",
    required_elements: ["skilled intervention", "RN assessment", "clinical judgment required"],
    keywords: ["skilled", "RN required", "clinical judgment", "assessment", "teaching", "wound care"],
    severity: "critical",
    applies_to_visit_types: ["admission", "recertification", "routine_visit"],
    applies_to_care_type: "home_health",
    penalty_description: "Services may be deemed not medically necessary",
    remediation_steps: ["Document specific skilled interventions", "Explain why aide could not perform task", "Include clinical decision-making"]
  },
  {
    rule_name: "OASIS M1021 - Primary Diagnosis",
    rule_category: "oasis",
    rule_code: "M1021",
    description: "Primary diagnosis must be documented with ICD-10 code and directly relate to home health services",
    required_elements: ["primary diagnosis", "ICD-10 code", "diagnosis relevance"],
    keywords: ["diagnosis", "ICD-10", "primary", "main condition"],
    severity: "high",
    applies_to_visit_types: ["admission", "recertification"],
    applies_to_care_type: "home_health",
    penalty_description: "Incorrect OASIS submission; payment adjustments",
    remediation_steps: ["Verify ICD-10 code accuracy", "Ensure diagnosis matches plan of care"]
  },
  {
    rule_name: "OASIS M1033 - Risk for Hospitalization",
    rule_category: "oasis",
    rule_code: "M1033",
    description: "Risk factors for hospitalization must be assessed and documented",
    required_elements: ["hospitalization risk", "risk factors", "preventive measures"],
    keywords: ["hospitalization risk", "readmission", "risk factors", "fall risk", "medication issues"],
    severity: "medium",
    applies_to_visit_types: ["admission", "recertification"],
    applies_to_care_type: "home_health",
    penalty_description: "Quality measure impact; incomplete patient assessment",
    remediation_steps: ["Complete risk assessment", "Document identified risks", "Include prevention strategies"]
  },
  {
    rule_name: "Patient Response to Teaching",
    rule_category: "medicare_cop",
    rule_code: "CoP 484.60(a)",
    description: "Documentation must include patient/caregiver response to education provided",
    required_elements: ["teaching provided", "patient response", "understanding level"],
    keywords: ["teach-back", "verbalized", "demonstrated", "understands", "education provided"],
    severity: "high",
    applies_to_visit_types: ["admission", "routine_visit", "discharge"],
    applies_to_care_type: "both",
    penalty_description: "Incomplete documentation; quality concerns",
    remediation_steps: ["Document specific education topics", "Include teach-back response", "Note understanding level"]
  },
  {
    rule_name: "Vital Signs Documentation",
    rule_category: "agency_policy",
    rule_code: "AP-VS-001",
    description: "All applicable vital signs must be documented at each skilled nursing visit",
    required_elements: ["blood pressure", "heart rate", "temperature", "respirations", "pain level"],
    keywords: ["BP", "blood pressure", "pulse", "temperature", "resp", "pain", "vitals"],
    severity: "medium",
    applies_to_visit_types: ["admission", "routine_visit", "recertification"],
    applies_to_care_type: "both",
    penalty_description: "Quality measure failure; incomplete assessment",
    remediation_steps: ["Record all vital signs", "Include pain assessment", "Note any abnormal values"]
  },
  {
    rule_name: "HIPAA - PHI Protection",
    rule_category: "hipaa",
    rule_code: "45 CFR 164.502",
    description: "Protected Health Information must be handled according to HIPAA regulations",
    required_elements: ["appropriate disclosure", "minimum necessary", "consent when required"],
    keywords: ["consent", "privacy", "disclosure", "authorization"],
    severity: "critical",
    applies_to_visit_types: ["admission", "discharge"],
    applies_to_care_type: "both",
    penalty_description: "Civil and criminal penalties; fines up to $50,000 per violation",
    remediation_steps: ["Obtain proper consent", "Limit PHI disclosure", "Document authorization"]
  },
  {
    rule_name: "Hospice - Terminal Prognosis",
    rule_category: "medicare_cop",
    rule_code: "CoP 418.22",
    description: "Documentation must support terminal prognosis of 6 months or less if disease runs normal course",
    required_elements: ["prognosis documentation", "disease progression", "decline indicators"],
    keywords: ["terminal", "prognosis", "decline", "end of life", "disease progression", "6 months"],
    severity: "critical",
    applies_to_visit_types: ["admission", "recertification"],
    applies_to_care_type: "hospice",
    penalty_description: "Medicare fraud potential; claims denial",
    remediation_steps: ["Document clinical decline", "Include prognosis indicators", "Reference physician certification"]
  }
];

export default function ComplianceRuleManager({ onRulesUpdated }) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [isSeeding, setIsSeeding] = useState(false);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['complianceRules'],
    queryFn: () => base44.entities.ComplianceRule.list(),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.ComplianceRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceRules'] });
      setIsDialogOpen(false);
      setEditingRule(null);
      onRulesUpdated?.();
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ComplianceRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceRules'] });
      setIsDialogOpen(false);
      setEditingRule(null);
      onRulesUpdated?.();
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.ComplianceRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceRules'] });
      onRulesUpdated?.();
    },
  });

  const seedDefaultRules = async () => {
    setIsSeeding(true);
    for (const rule of DEFAULT_RULES) {
      const exists = rules.find(r => r.rule_code === rule.rule_code);
      if (!exists) {
        await base44.entities.ComplianceRule.create({ ...rule, is_active: true });
      }
    }
    queryClient.invalidateQueries({ queryKey: ['complianceRules'] });
    setIsSeeding(false);
  };

  const filteredRules = rules.filter(rule => {
    const matchesSearch = !searchTerm || 
      rule.rule_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rule.rule_code?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || rule.rule_category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryBadge = (category) => {
    const cat = RULE_CATEGORIES.find(c => c.value === category);
    return cat ? <Badge className={cat.color}>{cat.label}</Badge> : <Badge>{category}</Badge>;
  };

  const getSeverityBadge = (severity) => {
    const sev = SEVERITY_OPTIONS.find(s => s.value === severity);
    return sev ? <Badge className={`${sev.color} text-white`}>{sev.label}</Badge> : <Badge>{severity}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Compliance Rules Configuration
          </div>
          <div className="flex gap-2">
            {rules.length === 0 && (
              <Button variant="outline" onClick={seedDefaultRules} disabled={isSeeding}>
                {isSeeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
                Load Default Rules
              </Button>
            )}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditingRule(null)}>
                  <Plus className="w-4 h-4 mr-2" /> Add Rule
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingRule ? 'Edit Rule' : 'Create New Compliance Rule'}</DialogTitle>
                </DialogHeader>
                <RuleForm
                  rule={editingRule}
                  onSubmit={(data) => {
                    if (editingRule) {
                      updateRuleMutation.mutate({ id: editingRule.id, data });
                    } else {
                      createRuleMutation.mutate(data);
                    }
                  }}
                  isLoading={createRuleMutation.isPending || updateRuleMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search rules..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {RULE_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rules List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Shield className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>No compliance rules configured yet.</p>
            <p className="text-sm">Click "Load Default Rules" to get started with standard rules.</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-2">
            {filteredRules.map((rule) => (
              <AccordionItem key={rule.id} value={rule.id} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 flex-1">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={(checked) => updateRuleMutation.mutate({ 
                        id: rule.id, 
                        data: { is_active: checked } 
                      })}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rule.rule_name}</span>
                        {rule.rule_code && (
                          <span className="text-xs text-slate-500 font-mono">{rule.rule_code}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {getCategoryBadge(rule.rule_category)}
                      {getSeverityBadge(rule.severity)}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="py-3 space-y-3">
                    <p className="text-sm text-slate-600">{rule.description}</p>
                    
                    {rule.required_elements?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">Required Elements:</p>
                        <div className="flex flex-wrap gap-1">
                          {rule.required_elements.map((el, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">{el}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {rule.penalty_description && (
                      <div className="bg-red-50 p-2 rounded text-xs text-red-800">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        {rule.penalty_description}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingRule(rule);
                          setIsDialogOpen(true);
                        }}
                      >
                        <Edit className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600"
                        onClick={() => deleteRuleMutation.mutate(rule.id)}
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function RuleForm({ rule, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    rule_name: rule?.rule_name || '',
    rule_category: rule?.rule_category || 'medicare_cop',
    rule_code: rule?.rule_code || '',
    description: rule?.description || '',
    required_elements: rule?.required_elements?.join(', ') || '',
    keywords: rule?.keywords?.join(', ') || '',
    severity: rule?.severity || 'medium',
    applies_to_visit_types: rule?.applies_to_visit_types || [],
    applies_to_care_type: rule?.applies_to_care_type || 'both',
    penalty_description: rule?.penalty_description || '',
    remediation_steps: rule?.remediation_steps?.join('\n') || '',
    is_active: rule?.is_active ?? true,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      required_elements: formData.required_elements.split(',').map(s => s.trim()).filter(Boolean),
      keywords: formData.keywords.split(',').map(s => s.trim()).filter(Boolean),
      remediation_steps: formData.remediation_steps.split('\n').map(s => s.trim()).filter(Boolean),
    });
  };

  const visitTypes = ['admission', 'recertification', 'routine_visit', 'discharge', 'prn'];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Rule Name *</Label>
          <Input
            value={formData.rule_name}
            onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
            required
          />
        </div>
        <div>
          <Label>Category *</Label>
          <Select value={formData.rule_category} onValueChange={(v) => setFormData({ ...formData, rule_category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RULE_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Rule Code</Label>
          <Input
            value={formData.rule_code}
            onChange={(e) => setFormData({ ...formData, rule_code: e.target.value })}
            placeholder="e.g., OASIS M1021"
          />
        </div>
        <div className="col-span-2">
          <Label>Description *</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            required
          />
        </div>
        <div>
          <Label>Severity *</Label>
          <Select value={formData.severity} onValueChange={(v) => setFormData({ ...formData, severity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map(sev => (
                <SelectItem key={sev.value} value={sev.value}>{sev.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Care Type</Label>
          <Select value={formData.applies_to_care_type} onValueChange={(v) => setFormData({ ...formData, applies_to_care_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="home_health">Home Health Only</SelectItem>
              <SelectItem value="hospice">Hospice Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Required Elements (comma-separated)</Label>
          <Input
            value={formData.required_elements}
            onChange={(e) => setFormData({ ...formData, required_elements: e.target.value })}
            placeholder="homebound status, reason for homebound"
          />
        </div>
        <div className="col-span-2">
          <Label>Keywords (comma-separated)</Label>
          <Input
            value={formData.keywords}
            onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            placeholder="homebound, confined, taxing effort"
          />
        </div>
        <div className="col-span-2">
          <Label>Applies to Visit Types</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {visitTypes.map(vt => (
              <Badge
                key={vt}
                variant={formData.applies_to_visit_types.includes(vt) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => {
                  const types = formData.applies_to_visit_types.includes(vt)
                    ? formData.applies_to_visit_types.filter(t => t !== vt)
                    : [...formData.applies_to_visit_types, vt];
                  setFormData({ ...formData, applies_to_visit_types: types });
                }}
              >
                {vt.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        </div>
        <div className="col-span-2">
          <Label>Penalty Description</Label>
          <Input
            value={formData.penalty_description}
            onChange={(e) => setFormData({ ...formData, penalty_description: e.target.value })}
            placeholder="Claims may be denied..."
          />
        </div>
        <div className="col-span-2">
          <Label>Remediation Steps (one per line)</Label>
          <Textarea
            value={formData.remediation_steps}
            onChange={(e) => setFormData({ ...formData, remediation_steps: e.target.value })}
            rows={3}
            placeholder="Add homebound justification&#10;Document specific limitations"
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        {rule ? 'Update Rule' : 'Create Rule'}
      </Button>
    </form>
  );
}