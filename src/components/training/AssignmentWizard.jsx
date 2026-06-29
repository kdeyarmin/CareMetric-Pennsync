import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AssignmentWizard({ users = [], onAssign }) {
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filters, setFilters] = useState({ role: 'all', discipline: 'all', department: 'all', business_line: 'all', location: 'all' });
  const filteredUsers = useMemo(() => users.filter((user) => {
    if (!user.email || user.role === 'admin') return false;
    if (filters.role !== 'all' && (user.job_title || user.credential_type || user.role) !== filters.role) return false;
    if (filters.discipline !== 'all' && (user.discipline || user.credential_type) !== filters.discipline) return false;
    if (filters.department !== 'all' && user.department !== filters.department) return false;
    if (filters.business_line !== 'all' && user.business_line !== filters.business_line) return false;
    if (filters.location !== 'all' && user.location !== filters.location) return false;
    return true;
  }), [users, filters]);

  const unique = (values) => [...new Set(values.filter(Boolean))];
  const toggle = (email) => setSelectedUsers((prev) => prev.includes(email) ? prev.filter((item) => item !== email) : [...prev, email]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6">
      <Card>
        <CardHeader><CardTitle>Assignment Wizard</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={filters.role} onValueChange={(value) => setFilters({ ...filters, role: value })}><SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem>{unique(users.map((user) => user.job_title || user.credential_type || user.role)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.discipline} onValueChange={(value) => setFilters({ ...filters, discipline: value })}><SelectTrigger><SelectValue placeholder="Discipline" /></SelectTrigger><SelectContent><SelectItem value="all">All disciplines</SelectItem>{unique(users.map((user) => user.discipline || user.credential_type)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.department} onValueChange={(value) => setFilters({ ...filters, department: value })}><SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger><SelectContent><SelectItem value="all">All departments</SelectItem>{unique(users.map((user) => user.department)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.business_line} onValueChange={(value) => setFilters({ ...filters, business_line: value })}><SelectTrigger><SelectValue placeholder="Business line" /></SelectTrigger><SelectContent><SelectItem value="all">All business lines</SelectItem>{unique(users.map((user) => user.business_line)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.location} onValueChange={(value) => setFilters({ ...filters, location: value })}><SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem>{unique(users.map((user) => user.location)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Button className="w-full" onClick={() => onAssign?.({ userEmails: selectedUsers, filters })}>Use {selectedUsers.length || filteredUsers.length} Employees</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Eligible Employees</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-[720px] overflow-y-auto">
          {filteredUsers.map((user) => (
            <label key={user.email} htmlFor={`assign-user-${user.email}`} className="flex items-start gap-3 rounded-xl border p-4 bg-white">
              <Checkbox id={`assign-user-${user.email}`} checked={selectedUsers.includes(user.email)} onCheckedChange={() => toggle(user.email)} />
              <div>
                <p className="font-semibold text-slate-900">{user.full_name || user.email}</p>
                <p className="text-sm text-slate-500">{user.job_title || user.credential_type || user.role}</p>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}