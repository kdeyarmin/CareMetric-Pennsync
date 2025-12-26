import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { 
  Menu, 
  FileText, 
  Users, 
  ClipboardList, 
  WifiOff,
  Settings,
  GraduationCap
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function MobileQuickAccessMenu() {
  const [open, setOpen] = useState(false);

  const quickActions = [
    {
      name: "Document Visit",
      icon: FileText,
      page: "SmartNoteAssistant",
      color: "text-blue-600 bg-blue-50",
      description: "Create a new visit note"
    },
    {
      name: "My Patients",
      icon: Users,
      page: "Patients",
      color: "text-green-600 bg-green-50",
      description: "View patient list"
    },
    {
      name: "Care Plans",
      icon: ClipboardList,
      page: "CarePlanManagement",
      color: "text-purple-600 bg-purple-50",
      description: "Manage care plans"
    },
    {
      name: "Offline Mode",
      icon: WifiOff,
      page: "OfflineMode",
      color: "text-orange-600 bg-orange-50",
      description: "Work without internet"
    },
    {
      name: "Training",
      icon: GraduationCap,
      page: "StaffTrainingHub",
      color: "text-indigo-600 bg-indigo-50",
      description: "View training modules"
    },
    {
      name: "Settings",
      icon: Settings,
      page: "Settings",
      color: "text-gray-600 bg-gray-50",
      description: "App preferences"
    }
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button 
          size="icon" 
          className="md:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full shadow-2xl bg-blue-600 hover:bg-blue-700"
        >
          <Menu className="w-6 h-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-xl">Quick Actions</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.page}
              to={createPageUrl(action.page)}
              onClick={() => setOpen(false)}
              className="block"
            >
              <div className={`p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 active:scale-95 transition-all ${action.color}`}>
                <action.icon className="w-8 h-8 mb-2" />
                <h3 className="font-semibold text-sm mb-1">{action.name}</h3>
                <p className="text-xs opacity-70">{action.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}