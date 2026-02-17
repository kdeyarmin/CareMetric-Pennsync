import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, CheckCircle2, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function EntUserProductivity({ activities, noteConversions, tasks, users }) {
  const stats = useMemo(() => {
    // Per-user stats
    const userMap = {};
    users.forEach(u => {
      userMap[u.email] = { name: u.full_name || u.email, email: u.email, notes: 0, tasksCompleted: 0, aiActions: 0, totalActions: 0 };
    });

    noteConversions.forEach(nc => {
      if (userMap[nc.nurse_email]) userMap[nc.nurse_email].notes++;
    });

    tasks.forEach(t => {
      if (t.status === "completed" && userMap[t.created_by]) userMap[t.created_by].tasksCompleted++;
    });

    activities.forEach(a => {
      if (!userMap[a.user_email]) return;
      userMap[a.user_email].totalActions++;
      if (["note_enhanced", "note_ai_generated", "template_generated"].includes(a.action)) {
        userMap[a.user_email].aiActions++;
      }
    });

    const userData = Object.values(userMap)
      .filter(u => u.notes > 0 || u.tasksCompleted > 0 || u.totalActions > 0)
      .sort((a, b) => b.notes - a.notes)
      .slice(0, 15);

    const totalNotes = noteConversions.length;
    const totalTasksCompleted = tasks.filter(t => t.status === "completed").length;
    const totalTasksPending = tasks.filter(t => t.status === "pending" || t.status === "in_progress").length;
    const taskCompletionRate = tasks.length > 0 ? ((totalTasksCompleted / tasks.length) * 100).toFixed(1) : 0;

    return { userData, totalNotes, totalTasksCompleted, totalTasksPending, taskCompletionRate, activeUsers: userData.length };
  }, [activities, noteConversions, tasks, users]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini icon={Users} label="Active Users" value={stats.activeUsers} color="text-blue-600" />
        <StatMini icon={FileText} label="Notes Created" value={stats.totalNotes} color="text-green-600" />
        <StatMini icon={CheckCircle2} label="Task Completion" value={`${stats.taskCompletionRate}%`} color="text-amber-600" />
        <StatMini icon={Zap} label="Tasks Pending" value={stats.totalTasksPending} color="text-red-600" />
      </div>

      {/* User comparison chart */}
      {stats.userData.length > 0 && (
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">User Productivity Comparison</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={Math.max(200, stats.userData.length * 35)}>
              <BarChart data={stats.userData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" style={{ fontSize: "10px" }} />
                <YAxis type="category" dataKey="name" style={{ fontSize: "9px" }} width={80} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="notes" fill="#3b82f6" name="Notes" radius={[0, 4, 4, 0]} />
                <Bar dataKey="tasksCompleted" fill="#10b981" name="Tasks Done" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* User detail table */}
      {stats.userData.length > 0 && (
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">User Detail</CardTitle></CardHeader>
          <CardContent className="p-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="p-2">User</th>
                  <th className="p-2 text-center">Notes</th>
                  <th className="p-2 text-center">Tasks Done</th>
                  <th className="p-2 text-center">AI Actions</th>
                  <th className="p-2 text-center">Total Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.userData.map(u => (
                  <tr key={u.email} className="border-b hover:bg-slate-50">
                    <td className="p-2 font-medium text-slate-800 truncate max-w-[150px]">{u.name}</td>
                    <td className="p-2 text-center">{u.notes}</td>
                    <td className="p-2 text-center">{u.tasksCompleted}</td>
                    <td className="p-2 text-center">{u.aiActions}</td>
                    <td className="p-2 text-center">{u.totalActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatMini({ icon: Icon, label, value, color }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className={`w-5 h-5 ${color} flex-shrink-0`} />
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">{value}</p>
          <p className="text-[10px] text-slate-500 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}