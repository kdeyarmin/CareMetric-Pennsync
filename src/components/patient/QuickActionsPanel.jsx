import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  FileText,
  Stethoscope,
  MessageSquare,
  ClipboardList,
  Phone,
  Mail,
  Clock,
  Target
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, isValid } from "date-fns";
import { toast } from 'sonner';

export default function QuickActionsPanel({ 
  patient, 
  recentVisits = [], 
  upcomingVisits = [],
  activeCarePlans = [],
  pendingTasks = []
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayVisit = upcomingVisits.find(v => v.visit_date && isValid(new Date(v.visit_date)) && v.visit_date === today);
  const _nextVisit = upcomingVisits.find(v => v.visit_date && isValid(new Date(v.visit_date)) && v.visit_date > today);

  const quickActions = [
    {
      icon: Calendar,
      label: "Schedule Visit",
      description: "Add new appointment",
      color: "bg-blue-500 hover:bg-blue-600",
      onClick: () => toast.error("Open schedule visit dialog - implement as needed")
    },
    {
      icon: Stethoscope,
      label: todayVisit ? "Document Today's Visit" : "Quick Documentation",
      description: todayVisit ? `${todayVisit.visit_type}` : "Add clinical notes",
      color: "bg-green-500 hover:bg-green-600",
      link: todayVisit ? `${createPageUrl("VisitScribe")}?visitId=${todayVisit.id}` : null,
      badge: todayVisit ? "Today" : null
    },
    {
      icon: Target,
      label: "Care Plan",
      description: `${activeCarePlans.length} active`,
      color: "bg-navy-500 hover:bg-navy-600",
      link: createPageUrl("CarePlanManagement")
    },
    {
      icon: MessageSquare,
      label: "Smart Note",
      description: "AI-assisted documentation",
      color: "bg-indigo-500 hover:bg-indigo-600",
      link: createPageUrl("SmartNoteAssistant")
    },
  ];

  const contactActions = [
    {
      icon: Phone,
      label: "Call Patient",
      value: patient.phone,
      href: patient.phone ? `tel:${patient.phone}` : null
    },
    {
      icon: Mail,
      label: "Email Patient",
      value: patient.email,
      href: patient.email ? `mailto:${patient.email}` : null
    },
    {
      icon: Phone,
      label: "Call Caregiver",
      value: patient.caregiver_phone,
      href: patient.caregiver_phone ? `tel:${patient.caregiver_phone}` : null
    },
  ];

  return (
    <div className="space-y-4">
      {/* Quick Actions Grid */}
      <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-blue-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-600" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action, idx) => {
              const ActionButton = action.link ? Link : 'button';
              const buttonProps = action.link 
                ? { to: action.link }
                : { onClick: action.onClick };

              return (
                <ActionButton
                  key={idx}
                  {...buttonProps}
                  className={`${action.color} text-white p-4 rounded-lg transition-all hover:shadow-lg relative overflow-hidden group`}
                >
                  {action.badge && (
                    <Badge className="absolute top-2 right-2 bg-yellow-500 text-white text-xs">
                      {action.badge}
                    </Badge>
                  )}
                  <action.icon className="w-6 h-6 mb-2" />
                  <p className="font-semibold text-sm">{action.label}</p>
                  <p className="text-xs opacity-90">{action.description}</p>
                </ActionButton>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent & Upcoming */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Recent Notes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" />
              Recent Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentVisits.slice(0, 3).map((visit, idx) => (
              <Link
                key={idx}
                to={`${createPageUrl("VisitScribe")}?visitId=${visit.id}`}
                className="block p-2 hover:bg-slate-50 rounded transition-colors mb-2 border border-slate-200"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-slate-900">{visit.visit_type}</p>
                  <p className="text-xs text-slate-500">{visit.visit_date}</p>
                </div>
                {visit.nurse_notes && (
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {visit.nurse_notes.substring(0, 80)}...
                  </p>
                )}
              </Link>
            ))}
            {recentVisits.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No recent notes</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Appointments */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              Upcoming Visits
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingVisits.slice(0, 3).map((visit, idx) => (
              <div
                key={idx}
                className={`p-2 rounded mb-2 border ${
                  visit.visit_date === today
                    ? 'bg-green-50 border-green-300'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-slate-900">{visit.visit_type}</p>
                  {visit.visit_date === today && (
                    <Badge className="bg-green-600 text-white text-xs">Today</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Calendar className="w-3 h-3" />
                  <span>{visit.visit_date}</span>
                  {visit.visit_time && <span>at {visit.visit_time}</span>}
                </div>
              </div>
            ))}
            {upcomingVisits.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No scheduled visits</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contact Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Phone className="w-4 h-4 text-green-600" />
            Quick Contact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {contactActions.map((action, idx) => (
              action.value ? (
                <a
                  key={idx}
                  href={action.href}
                  className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded transition-colors border border-slate-200"
                >
                  <action.icon className="w-4 h-4 text-slate-600" />
                  <div>
                    <p className="text-xs font-medium text-slate-900">{action.label}</p>
                    <p className="text-xs text-slate-600">{action.value}</p>
                  </div>
                </a>
              ) : null
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Outstanding Tasks */}
      {pendingTasks.length > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-orange-600" />
              Outstanding Tasks ({pendingTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingTasks.slice(0, 3).map((task, idx) => (
                <div key={idx} className="bg-white p-2 rounded border border-orange-200">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-slate-900">{task.title}</p>
                    <Badge className={
                      task.priority === 'high' ? 'bg-red-600' :
                      task.priority === 'medium' ? 'bg-orange-500' : 'bg-yellow-500'
                    }>
                      {task.priority}
                    </Badge>
                  </div>
                  {task.due_date && (
                    <p className="text-xs text-slate-600">Due: {task.due_date}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}