import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Zap, Plus, Trash2, Loader2, Bell } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function SmartPriorityRules({ userEmail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", rule_type: "keyword", pattern: "", priority: "high", notify: false });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["priorityRules", userEmail],
    queryFn: () => base44.entities.FaxPriorityRule.filter({ user_email: userEmail }, "-created_date", 50),
    enabled: !!userEmail,
  });

  const handleCreate = async () => {
    if (!form.name || !form.pattern) { toast.error("Name and pattern required"); return; }
    await base44.entities.FaxPriorityRule.create({ ...form, user_email: userEmail, is_active: true, match_count: 0 });
    queryClient.invalidateQueries({ queryKey: ["priorityRules"] });
    setForm({ name: "", rule_type: "keyword", pattern: "", priority: "high", notify: false });
    setOpen(false);
    toast.success("Rule created");
  };

  const handleToggle = async (rule) => {
    await base44.entities.FaxPriorityRule.update(rule.id, { is_active: !rule.is_active });
    queryClient.invalidateQueries({ queryKey: ["priorityRules"] });
  };

  const handleDelete = async (id) => {
    await base44.entities.FaxPriorityRule.delete(id);
    queryClient.invalidateQueries({ queryKey: ["priorityRules"] });
    toast.success("Rule deleted");
  };

  const PRIORITY_COLORS = {
    urgent: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    normal: "bg-blue-100 text-blue-700",
    low: "bg-slate-100 text-slate-700",
  };

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> Priority Rules
            <Badge className="bg-slate-100 text-slate-600 text-[10px]">{rules.length}</Badge>
          </CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1">
                <Plus className="w-3 h-3" /> Add Rule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Priority Rule</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Rule Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. STAT orders" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Match Type</Label>
                  <Select value={form.rule_type} onValueChange={(v) => setForm({ ...form, rule_type: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword in content</SelectItem>
                      <SelectItem value="sender">Sender name/number</SelectItem>
                      <SelectItem value="recipient">Recipient name/number</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Pattern to Match</Label>
                  <Input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} placeholder="e.g. STAT, emergency, Dr. Smith" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Set Priority To</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1"><Bell className="w-3 h-3" /> Send notification</Label>
                  <Switch checked={form.notify} onCheckedChange={(v) => setForm({ ...form, notify: v })} />
                </div>
                <Button onClick={handleCreate} className="w-full">Create Rule</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1.5">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin mx-auto" />
        ) : rules.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">No priority rules configured</p>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className={`flex items-center gap-2 p-2 rounded-lg border ${rule.is_active ? "bg-white" : "bg-slate-50 opacity-60"}`}>
              <Switch checked={rule.is_active} onCheckedChange={() => handleToggle(rule)} className="scale-75" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{rule.name}</p>
                <p className="text-[9px] text-slate-500">{rule.rule_type}: "{rule.pattern}"</p>
              </div>
              <Badge className={`text-[8px] px-1.5 ${PRIORITY_COLORS[rule.priority]}`}>{rule.priority}</Badge>
              {rule.notify && <Bell className="w-3 h-3 text-amber-500" />}
              <span className="text-[8px] text-slate-400">{rule.match_count}×</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => handleDelete(rule.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}