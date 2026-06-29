import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText,
  Users,
  ClipboardList,
  Download,
  ChevronDown,
  ChevronUp,
  Sparkles
} from "lucide-react";

export default function MobileQuickActions() {
  const [expanded, setExpanded] = useState(false);

  const quickActions = [
    {
      name: "Quick Note",
      icon: FileText,
      page: "QuickNote",
      color: "from-blue-500 to-blue-600",
      description: "Document a visit"
    },
    {
      name: "Patients",
      icon: Users,
      page: "Patients",
      color: "from-green-500 to-green-600",
      description: "View patient list"
    },
    {
      name: "Care Plans",
      icon: ClipboardList,
      page: "CarePlanManagement",
      color: "from-navy-500 to-navy-600",
      description: "Manage care plans"
    },
    {
      name: "Offline Mode",
      icon: Download,
      page: "OfflineMode",
      color: "from-orange-500 to-orange-600",
      description: "Cache patient data"
    }
  ];

  return (
    <div className="lg:hidden fixed bottom-4 left-4 right-4 z-40">
      <Card className="shadow-2xl border-2 border-blue-300">
        {expanded && (
          <CardContent className="p-3 grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <Link key={action.page} to={createPageUrl(action.page)}>
                <Button
                  variant="outline"
                  className={`w-full h-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-br ${action.color} text-white border-none hover:opacity-90 active:scale-95 transition-all`}
                >
                  <action.icon className="w-6 h-6" />
                  <span className="text-xs font-semibold">{action.name}</span>
                </Button>
              </Link>
            ))}
          </CardContent>
        )}
        <Button
          onClick={() => setExpanded(!expanded)}
          className="w-full bg-blue-600 hover:bg-blue-700 rounded-t-none"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-4 h-4 mr-2" />
              Hide Quick Actions
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Quick Actions
              <ChevronUp className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </Card>
    </div>
  );
}