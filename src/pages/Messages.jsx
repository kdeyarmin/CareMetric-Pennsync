import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Mail,
  Send,
  ArrowUp,
  Paperclip,
  CheckCircle2,
  User,
  PenSquare,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import PhoneFrame, { PhoneEmptyState } from "@/components/phone/PhoneFrame";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";
import { shortAgo } from "@/components/phone/timeUtils";

const PRIORITY_DOT = { urgent: "bg-red-500", high: "bg-orange-500", normal: "bg-navy-600" };

export default function Messages() {
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [visibleThreadCount, setVisibleThreadCount] = useState(20);
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterRead, setFilterRead] = useState("all");
  const [replyText, setReplyText] = useState("");
  const [newMessage, setNewMessage] = useState({
    subject: "",
    message_text: "",
    recipients: [],
    priority: "normal",
    patient_id: null
  });
  const bottomRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages'],
    queryFn: () => base44.entities.Message.list('-created_date', 200),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('full_name', 200),
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('first_name', 100),
    initialData: [],
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId) => {
      const message = messages.find(m => m.id === messageId);
      if (!message || !currentUser?.email) return;
      const readBy = message.read_by || [];
      if (!readBy.includes(currentUser.email)) {
        await base44.entities.Message.update(messageId, {
          is_read: true,
          read_by: [...readBy, currentUser.email]
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (messageData) => base44.entities.Message.create(messageData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      setShowNewMessage(false);
      setNewMessage({
        subject: "",
        message_text: "",
        recipients: [],
        priority: "normal",
        patient_id: null
      });
    },
  });

  // Group messages by thread
  const groupedMessages = messages.reduce((acc, msg) => {
    const threadId = msg.thread_id || msg.id;
    if (!acc[threadId]) {
      acc[threadId] = [];
    }
    acc[threadId].push(msg);
    return acc;
  }, {});

  // Get thread preview (most recent message)
  const threads = Object.entries(groupedMessages).map(([threadId, threadMessages]) => {
    const sortedMessages = threadMessages.sort((a, b) =>
      new Date(b.created_date) - new Date(a.created_date)
    );
    const latestMessage = sortedMessages[0];
    const unreadCount = threadMessages.filter(m =>
      !m.read_by?.includes(currentUser?.email)
    ).length;

    return {
      threadId,
      messages: sortedMessages,
      latestMessage,
      unreadCount,
      subject: latestMessage.subject || 'No Subject',
      priority: latestMessage.priority || 'normal',
      isMyMessage: latestMessage.sender_email === currentUser?.email,
      isRecipient: latestMessage.recipients?.includes(currentUser?.email)
    };
  });

  // Filter threads
  const filteredThreads = threads
    .filter(thread => thread.isRecipient || thread.isMyMessage)
    .filter(thread => {
      if (filterPriority !== "all" && thread.priority !== filterPriority) return false;
      if (filterRead === "unread" && thread.unreadCount === 0) return false;
      if (filterRead === "read" && thread.unreadCount > 0) return false;
      return true;
    })
    .sort((a, b) => new Date(b.latestMessage.created_date) - new Date(a.latestMessage.created_date));

  const selectedThread = threads.find(t => t.threadId === selectedThreadId) || null;
  // Conversation bubbles read oldest → newest.
  const conversation = selectedThread ? [...selectedThread.messages].reverse() : [];

  // Keep the latest reply in view.
  const convoLastId = conversation[conversation.length - 1]?.id;
  useEffect(() => {
    if (selectedThreadId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [convoLastId, selectedThreadId]);

  const handleThreadClick = (thread) => {
    setSelectedThreadId(thread.threadId);
    setReplyText("");
    // Mark all unread messages in thread as read
    thread.messages
      .filter(m => !m.read_by?.includes(currentUser?.email))
      .forEach(m => markAsReadMutation.mutate(m.id));
  };

  const handleSendMessage = () => {
    if (newMessage.recipients.length === 0 || !newMessage.subject.trim() || !newMessage.message_text.trim()) {
      toast.error('Please add a recipient, subject, and message.');
      return;
    }

    sendMessageMutation.mutate({
      ...newMessage,
      sender_name: currentUser?.full_name,
      sender_email: currentUser?.email,
      thread_id: null
    });
  };

  const handleReply = () => {
    if (!selectedThread || !replyText.trim()) return;

    const me = currentUser?.email;
    const originalMessage = selectedThread.latestMessage;
    // Address the reply to the *other* participant(s), never to myself. If the
    // latest message in the thread was mine (incl. a reply I just sent), reply to
    // the people I sent it to; otherwise reply to its sender. Without this, a
    // reply to my own latest row would be addressed back to me.
    const targets =
      originalMessage.sender_email === me
        ? originalMessage.recipients || []
        : [originalMessage.sender_email];
    const recipients = [...new Set(targets.filter((email) => email && email !== me))];
    if (recipients.length === 0) return;

    sendMessageMutation.mutate({
      subject: `Re: ${originalMessage.subject}`,
      message_text: replyText.trim(),
      sender_name: currentUser?.full_name,
      sender_email: me,
      recipients,
      priority: originalMessage.priority,
      patient_id: originalMessage.patient_id,
      thread_id: selectedThread.threadId
    });
    setReplyText("");
  };

  const unreadCount = threads.filter(t => t.unreadCount > 0).length;

  return (
    <PageContainer>
      <PageHeader
        icon={Mail}
        eyebrow="Communication"
        title="Messages"
        description="Secure internal messaging for patient care coordination"
        badges={unreadCount > 0 ? [{ label: `${unreadCount} Unread`, className: "bg-red-600 text-white hover:bg-red-600" }] : []}
        favoritePage="Messages"
        actions={
          <Button onClick={() => setShowNewMessage(true)} className="min-h-[44px] w-full bg-navy-600 hover:bg-navy-700 sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            New Message
          </Button>
        }
      />

      <PhoneFrame>
        {selectedThread ? (
          /* Conversation screen */
          <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
            <PhoneTopBar
              onBack={() => setSelectedThreadId(null)}
              backLabel="Messages"
              title={selectedThread.subject}
              subtitle={selectedThread.priority !== "normal" ? `${selectedThread.priority} priority` : undefined}
            />
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {conversation.map((msg) => {
                const mine = msg.sender_email === currentUser?.email;
                return (
                  <div key={msg.id} className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}>
                    {!mine && <ContactAvatar name={msg.sender_name} size="sm" className="mr-2 mt-auto" />}
                    <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                      {!mine && <span className="mb-0.5 px-1 text-[11px] font-medium text-slate-500">{msg.sender_name}</span>}
                      <div
                        className={`whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug shadow-sm ${
                          mine
                            ? "rounded-2xl rounded-br-md bg-navy-600 text-white"
                            : "rounded-2xl rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200"
                        }`}
                      >
                        {msg.message_text}
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1 px-1 text-[10px] text-slate-400 ${mine ? "flex-row-reverse" : ""}`}>
                        <span>{format(new Date(msg.created_date), "MMM d, h:mm a")}</span>
                        {mine && msg.read_by?.includes(currentUser?.email) && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                      </div>
                      {msg.patient_id && (
                        <Link
                          to={`/PatientDetails?id=${msg.patient_id}`}
                          className="mt-1 inline-flex items-center gap-1 px-1 text-[11px] text-navy-600 hover:underline"
                        >
                          <User className="h-3 w-3" />
                          View Patient
                        </Link>
                      )}
                      {msg.attachments?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2 px-1">
                          {msg.attachments.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] text-navy-600 hover:underline"
                            >
                              <Paperclip className="h-3 w-3" />
                              Attachment {i + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Reply compose */}
            <div className="flex flex-shrink-0 items-end gap-2 border-t border-slate-200 bg-white px-2.5 pb-2.5 pt-2">
              <div className="flex flex-1 items-center rounded-3xl border border-slate-300 bg-white px-3">
                <textarea
                  rows={1}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReply();
                    }
                  }}
                  placeholder="Reply…"
                  className="max-h-28 w-full resize-none border-0 bg-transparent py-2 text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-0"
                />
              </div>
              <Button
                type="button"
                size="icon"
                onClick={handleReply}
                disabled={!replyText.trim() || sendMessageMutation.isPending}
                aria-label="Send reply"
                className="h-9 w-9 flex-shrink-0 rounded-full bg-navy-600 hover:bg-navy-700 disabled:bg-slate-300"
              >
                <ArrowUp className="h-5 w-5" />
              </Button>
            </div>
          </div>
        ) : (
          /* Inbox screen */
          <div className="flex min-h-0 flex-1 flex-col">
            <PhoneTopBar
              title="Messages"
              large
              accessory={
                <button
                  type="button"
                  onClick={() => setShowNewMessage(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-navy-600 hover:bg-navy-50"
                  title="New message"
                  aria-label="New message"
                >
                  <PenSquare className="h-5 w-5" />
                </button>
              }
            />
            {/* Filters */}
            <div className="flex flex-shrink-0 gap-2 border-b border-slate-100 bg-white px-3 py-2">
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="h-9 flex-1 text-xs">
                  <SelectValue placeholder="All Priorities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterRead} onValueChange={setFilterRead}>
                <SelectTrigger className="h-9 flex-1 text-xs">
                  <SelectValue placeholder="All Messages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Messages</SelectItem>
                  <SelectItem value="unread">Unread Only</SelectItem>
                  <SelectItem value="read">Read Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-slate-500">Loading messages…</p>
              ) : filteredThreads.length === 0 ? (
                <PhoneEmptyState icon={Mail} title="No messages found" hint="Start a conversation with the pencil icon." />
              ) : (
                <>
                  <ul className="divide-y divide-slate-100 bg-white">
                    {filteredThreads.slice(0, visibleThreadCount).map((thread) => (
                      <li key={thread.threadId}>
                        <button
                          type="button"
                          onClick={() => handleThreadClick(thread)}
                          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                        >
                          <div className="relative">
                            <ContactAvatar
                              name={thread.isMyMessage ? "You" : thread.latestMessage.sender_name}
                              size="md"
                            />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${PRIORITY_DOT[thread.priority] || PRIORITY_DOT.normal}`}
                              title={`${thread.priority} priority`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={`truncate text-[15px] ${thread.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
                                {thread.subject}
                              </p>
                              <span className="flex-shrink-0 text-[11px] text-slate-400">{shortAgo(thread.latestMessage.created_date)}</span>
                            </div>
                            <p className="truncate text-[12px] text-slate-400">
                              {thread.isMyMessage ? "You" : thread.latestMessage.sender_name}
                            </p>
                            <p className={`truncate text-[13px] ${thread.unreadCount > 0 ? "text-slate-700" : "text-slate-500"}`}>
                              {thread.latestMessage.message_text}
                            </p>
                          </div>
                          {thread.unreadCount > 0 && (
                            <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-navy-600 px-1.5 text-[11px] font-bold text-white">
                              {thread.unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {filteredThreads.length > visibleThreadCount && (
                    <div className="p-3">
                      <Button variant="outline" className="w-full" onClick={() => setVisibleThreadCount((c) => c + 20)}>
                        Load more ({filteredThreads.length - visibleThreadCount} remaining)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </PhoneFrame>

      {/* New Message Dialog */}
      <Dialog open={showNewMessage} onOpenChange={setShowNewMessage}>
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl">New Message</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="new-message-recipients" className="mb-2 block text-sm font-semibold">Recipients *</label>
              <Select
                value={newMessage.recipients[0] || ""}
                onValueChange={(value) => setNewMessage({ ...newMessage, recipients: [value] })}
              >
                <SelectTrigger id="new-message-recipients" className="h-11">
                  <SelectValue placeholder="Select recipient" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.email} value={u.email}>
                      {u.full_name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="new-message-patient" className="mb-2 block text-sm font-semibold">Related Patient (Optional)</label>
              <Select
                value={newMessage.patient_id || "none"}
                onValueChange={(value) => setNewMessage({ ...newMessage, patient_id: value === "none" ? null : value })}
              >
                <SelectTrigger id="new-message-patient" className="h-11">
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="new-message-priority" className="mb-2 block text-sm font-semibold">Priority</label>
              <Select
                value={newMessage.priority}
                onValueChange={(value) => setNewMessage({ ...newMessage, priority: value })}
              >
                <SelectTrigger id="new-message-priority" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="new-message-subject" className="mb-2 block text-sm font-semibold">Subject *</label>
              <Input
                id="new-message-subject"
                value={newMessage.subject}
                onChange={(e) => setNewMessage({ ...newMessage, subject: e.target.value })}
                placeholder="Enter subject"
                className="h-11"
              />
            </div>

            <div>
              <label htmlFor="new-message-text" className="mb-2 block text-sm font-semibold">Message *</label>
              <Textarea
                id="new-message-text"
                value={newMessage.message_text}
                onChange={(e) => setNewMessage({ ...newMessage, message_text: e.target.value })}
                placeholder="Type your message here..."
                rows={6}
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowNewMessage(false)} className="min-h-[44px] w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleSendMessage}
              disabled={sendMessageMutation.isPending}
              className="min-h-[44px] w-full bg-navy-600 hover:bg-navy-700 sm:w-auto"
            >
              <Send className="mr-2 h-4 w-4" />
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}