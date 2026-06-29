import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/ui/PageHeader";
import { MessageSquare, PhoneCall, UserCheck, Phone, CalendarClock, PhoneForwarded } from "lucide-react";
import SmsConversationList from "@/components/messaging/SmsConversationList";
import ScheduledSmsList from "@/components/messaging/ScheduledSmsList";
import CallHistoryList from "@/components/voice/CallHistoryList";
import CallbackQueue from "@/components/voice/CallbackQueue";
import DutyStatusCard from "@/components/voice/DutyStatusCard";
import PhoneFrame from "@/components/phone/PhoneFrame";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import { callbackCount } from "@/components/voice/callbackQueue";
import { isOffDutyNow } from "@/components/voice/dutyUtils";
import { formatPhoneDisplay } from "@/components/voice/phoneUtils";
import { cn } from "@/lib/utils";
import PageContainer from "@/components/ui/PageContainer";

/**
 * PhoneCenter — a nurse's hub for patient texting, masked call history,
 * callbacks, scheduled texts, and on/off-duty controls, presented like a real
 * phone: a device frame with a bottom tab bar that switches between app screens.
 * All communication goes through the nurse's Telnyx work number so their personal
 * cell is never exposed.
 */
export default function PhoneCenter() {
  const [activeTab, setActiveTab] = useState("texts");

  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: calls = [] } = useQuery({
    queryKey: ["call-logs", user?.email],
    queryFn: () => base44.entities.CallLog.filter({ nurse_email: user.email }, "-created_date", 200),
    enabled: !!user?.email,
    refetchInterval: 30000,
    initialData: [],
  });
  const callbacks = callbackCount(calls);

  const offNow = isOffDutyNow(user);
  const hasWorkNumber = !!user?.work_phone_number;

  // Live status chips shown in the header so a nurse sees at a glance whether
  // patients can reach them right now, and which work line they're using.
  const headerBadges = !user
    ? []
    : hasWorkNumber
      ? [
          {
            label: (
              <span className="flex items-center gap-1.5">
                <span className={cn("inline-block h-2 w-2 rounded-full", offNow ? "bg-amber-500" : "bg-emerald-500")} />
                {offNow ? "Off duty" : "On duty"}
              </span>
            ),
            className: offNow
              ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
              : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
          },
          {
            label: `Work line · ${formatPhoneDisplay(user.work_phone_number)}`,
            className: "bg-slate-100 text-slate-700 hover:bg-slate-100",
          },
        ]
      : [
          {
            label: "No work line assigned",
            className: "bg-amber-100 text-amber-800 hover:bg-amber-100",
          },
        ];

  const tabs = [
    { key: "texts", label: "Texts", icon: MessageSquare },
    { key: "calls", label: "Recents", icon: PhoneCall },
    { key: "callbacks", label: "Callbacks", icon: PhoneForwarded, badge: callbacks },
    { key: "scheduled", label: "Scheduled", icon: CalendarClock },
    { key: "duty", label: "Duty", icon: UserCheck },
  ];

  return (
    <PageContainer>
      <PageHeader
        icon={Phone}
        eyebrow="Communication"
        title="Phone Center"
        description="Text and call patients privately through your work number — your personal cell stays hidden."
        favoritePage="PhoneCenter"
        badges={headerBadges}
      />

      <PhoneFrame tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === "texts" && <SmsConversationList />}
        {activeTab === "calls" && <CallHistoryList />}
        {activeTab === "callbacks" && <CallbackQueue />}
        {activeTab === "scheduled" && <ScheduledSmsList />}
        {activeTab === "duty" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <PhoneTopBar
              title="Duty Status"
              large
              accessory={
                hasWorkNumber ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <span className={cn("inline-block h-2 w-2 rounded-full", offNow ? "bg-amber-500" : "bg-emerald-500")} />
                    {offNow ? "Off" : "On"}
                  </span>
                ) : null
              }
            />
            <div className="flex-1 overflow-y-auto overscroll-contain p-3">
              <DutyStatusCard />
            </div>
          </div>
        )}
      </PhoneFrame>
    </PageContainer>
  );
}
