import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Video, Clock, User } from "lucide-react";
import { motion } from "framer-motion";

export default function QuickTelehealthLauncher({ todayAppointments, onScheduleNew }) {
  const navigate = useNavigate();

  if (!todayAppointments || todayAppointments.length === 0) {
    return (
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Video className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm mb-1">Telehealth Ready</h3>
              <p className="text-xs text-gray-600 mb-3">No virtual visits scheduled for today</p>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={onScheduleNew}
                  className="text-xs"
                >
                  Schedule Visit
                </Button>
                <Button 
                  size="sm"
                  onClick={() => navigate(createPageUrl("TelehealthDashboard"))}
                  className="bg-blue-600 hover:bg-blue-700 text-xs"
                >
                  Go to Telehealth
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-green-400 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Video className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-sm">Today's Virtual Visits</h3>
          </div>
          <Badge className="bg-green-600 text-white">{todayAppointments.length}</Badge>
        </div>

        <div className="space-y-2">
          {todayAppointments.slice(0, 3).map((apt, idx) => (
            <motion.div
              key={apt.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white rounded-lg p-3 border border-green-200"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium text-sm">{apt.patient_name}</p>
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {apt.start_time}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => navigate(createPageUrl("TelehealthVisit") + `?appointmentId=${apt.id}`)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Join
                </Button>
              </div>
            </motion.div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(createPageUrl("TelehealthDashboard"))}
          className="w-full mt-3"
        >
          View All Virtual Visits
        </Button>
      </CardContent>
    </Card>
  );
}