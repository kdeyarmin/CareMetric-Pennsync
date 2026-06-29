import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Award,
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Trash2
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";

export default function SkillsTracker({ nurseEmail }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [newSkill, setNewSkill] = useState({
    skill_name: "",
    skill_category: "clinical",
    proficiency_level: "intermediate",
    certification_date: format(new Date(), 'yyyy-MM-dd'),
    expiration_date: ""
  });

  const queryClient = useQueryClient();

  const { data: skills = [] } = useQuery({
    queryKey: ['nurseSkills', nurseEmail],
    queryFn: () => base44.entities.NurseSkill.filter({ nurse_email: nurseEmail }),
    enabled: !!nurseEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.NurseSkill.create({ ...data, nurse_email: nurseEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseSkills'] });
      setShowAddDialog(false);
      resetForm();
    },
    onError: () => {
      toast.error("Couldn't add the skill. Please try again.");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.NurseSkill.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseSkills'] });
      setEditingSkill(null);
    },
    onError: () => {
      toast.error("Couldn't update the skill. Please try again.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.NurseSkill.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nurseSkills'] }),
    onError: () => {
      toast.error("Couldn't delete the skill. Please try again.");
    }
  });

  const resetForm = () => {
    setNewSkill({
      skill_name: "",
      skill_category: "clinical",
      proficiency_level: "intermediate",
      certification_date: format(new Date(), 'yyyy-MM-dd'),
      expiration_date: ""
    });
  };

  const handleSave = () => {
    if (editingSkill) {
      updateMutation.mutate({ id: editingSkill.id, data: newSkill });
    } else {
      createMutation.mutate(newSkill);
    }
  };

  const openEdit = (skill) => {
    setEditingSkill(skill);
    setNewSkill({
      skill_name: skill.skill_name,
      skill_category: skill.skill_category,
      proficiency_level: skill.proficiency_level,
      certification_date: skill.certification_date || "",
      expiration_date: skill.expiration_date || ""
    });
    setShowAddDialog(true);
  };

  const getExpirationStatus = (expDate) => {
    if (!expDate) return null;
    const days = differenceInDays(parseISO(expDate), new Date());
    if (days < 0) return { status: 'expired', color: 'bg-red-100 text-red-800' };
    if (days < 30) return { status: 'expiring', color: 'bg-yellow-100 text-yellow-800' };
    return { status: 'valid', color: 'bg-green-100 text-green-800' };
  };

  const getProficiencyColor = (level) => {
    const colors = {
      beginner: 'bg-blue-100 text-blue-800',
      intermediate: 'bg-indigo-100 text-indigo-800',
      advanced: 'bg-navy-100 text-navy-800',
      expert: 'bg-gold-100 text-gold-800'
    };
    return colors[level] || 'bg-slate-100 text-slate-800';
  };

  const groupedSkills = skills.reduce((acc, skill) => {
    const cat = skill.skill_category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Award className="w-5 h-5 text-indigo-600" />
          Skills & Certifications
        </CardTitle>
        <Button size="sm" onClick={() => { resetForm(); setEditingSkill(null); setShowAddDialog(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Add Skill
        </Button>
      </CardHeader>
      <CardContent>
        {Object.keys(groupedSkills).length === 0 ? (
          <p className="text-slate-500 text-center py-4">No skills recorded yet</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedSkills).map(([category, categorySkills]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-slate-600 mb-2 capitalize">{category}</h4>
                <div className="space-y-2">
                  {categorySkills.map((skill) => {
                    const expStatus = getExpirationStatus(skill.expiration_date);
                    return (
                      <div key={skill.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="font-medium text-slate-900">{skill.skill_name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={getProficiencyColor(skill.proficiency_level)}>
                                {skill.proficiency_level}
                              </Badge>
                              {skill.certification_date && (
                                <span className="text-xs text-slate-500">
                                  <Calendar className="w-3 h-3 inline mr-1" />
                                  {format(parseISO(skill.certification_date), 'MMM d, yyyy')}
                                </span>
                              )}
                              {expStatus && (
                                <Badge className={expStatus.color}>
                                  {expStatus.status === 'expired' && <AlertTriangle className="w-3 h-3 mr-1" />}
                                  {expStatus.status === 'valid' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  {expStatus.status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(skill)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteMutation.mutate(skill.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSkill ? 'Edit Skill' : 'Add New Skill'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Skill/Certification Name</Label>
              <Input
                value={newSkill.skill_name}
                onChange={(e) => setNewSkill({ ...newSkill, skill_name: e.target.value })}
                placeholder="e.g., Wound Care Certification"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={newSkill.skill_category} onValueChange={(v) => setNewSkill({ ...newSkill, skill_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clinical">Clinical</SelectItem>
                    <SelectItem value="documentation">Documentation</SelectItem>
                    <SelectItem value="technology">Technology</SelectItem>
                    <SelectItem value="communication">Communication</SelectItem>
                    <SelectItem value="specialty">Specialty</SelectItem>
                    <SelectItem value="certification">Certification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Proficiency Level</Label>
                <Select value={newSkill.proficiency_level} onValueChange={(v) => setNewSkill({ ...newSkill, proficiency_level: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Certification Date</Label>
                <Input
                  type="date"
                  value={newSkill.certification_date}
                  onChange={(e) => setNewSkill({ ...newSkill, certification_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Expiration Date (optional)</Label>
                <Input
                  type="date"
                  value={newSkill.expiration_date}
                  onChange={(e) => setNewSkill({ ...newSkill, expiration_date: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!newSkill.skill_name}>
              {editingSkill ? 'Update' : 'Add'} Skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}