import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  MessageSquare, 
  Send, 
  Users, 
  AlertCircle,
  Search,
  Pin,
  Loader2,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

export default function InternalMessaging() {
  const [selectedChannel, setSelectedChannel] = useState('general');
  const [selectedThread, setSelectedThread] = useState(null);
  const [messageBody, setMessageBody] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: messages, isLoading } = useQuery({
    queryKey: ['team-messages', selectedChannel],
    queryFn: async () => {
      const msgs = await base44.entities.TeamMessage.filter({ 
        channel: selectedChannel 
      });
      return msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    },
    refetchInterval: 5000 // Poll every 5 seconds
  });

  const { data: users } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.filter({})
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData) => {
      return await base44.entities.TeamMessage.create({
        agency_id: user.agency_id || 'default',
        channel: selectedChannel,
        thread_id: selectedThread || null,
        sender_email: user.email,
        sender_name: user.full_name,
        body: messageData.body,
        priority: messageData.priority || 'normal',
        mentions: messageData.mentions || [],
        read_by: [user.email]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['team-messages']);
      setMessageBody('');
      setSelectedThread(null);
      toast.success('Message sent');
    },
    onError: (error) => {
      toast.error('Failed to send message: ' + error.message);
    }
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId) => {
      const message = messages.find(m => m.id === messageId);
      if (!message || message.read_by?.includes(user.email)) return;
      
      const updatedReadBy = [...(message.read_by || []), user.email];
      return await base44.entities.TeamMessage.update(messageId, {
        read_by: updatedReadBy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['team-messages']);
    }
  });

  const handleSendMessage = () => {
    if (!messageBody.trim()) return;

    // Extract mentions (@user)
    const mentions = [];
    const mentionRegex = /@(\S+)/g;
    let match;
    while ((match = mentionRegex.exec(messageBody)) !== null) {
      const mentionedUser = users?.find(u => 
        u.full_name?.toLowerCase().includes(match[1].toLowerCase()) ||
        u.email?.toLowerCase().includes(match[1].toLowerCase())
      );
      if (mentionedUser) {
        mentions.push(mentionedUser.email);
      }
    }

    sendMessageMutation.mutate({
      body: messageBody,
      mentions
    });
  };

  const threadsMap = {};
  messages?.forEach(msg => {
    const threadId = msg.thread_id || msg.id;
    if (!threadsMap[threadId]) {
      threadsMap[threadId] = [];
    }
    threadsMap[threadId].push(msg);
  });

  const threads = Object.values(threadsMap);
  const filteredThreads = threads.filter(thread => {
    if (!searchQuery) return true;
    return thread.some(msg => 
      msg.body?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.sender_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const pinnedMessages = messages?.filter(m => m.is_pinned) || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b">
            <h2 className="text-lg font-bold text-slate-900">Channels</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {['general', 'urgent', 'patient_care', 'scheduling', 'compliance'].map(channel => (
              <button
                key={channel}
                onClick={() => setSelectedChannel(channel)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                  selectedChannel === channel ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="font-medium capitalize">{channel.replace('_', ' ')}</span>
                </div>
                {messages?.filter(m => m.channel === channel && !m.read_by?.includes(user.email)).length > 0 && (
                  <Badge className="ml-auto bg-blue-600 text-white">
                    {messages.filter(m => m.channel === channel && !m.read_by?.includes(user.email)).length}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-white border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900 capitalize">
                  #{selectedChannel.replace('_', ' ')}
                </h1>
                <p className="text-sm text-slate-600">Team communication channel</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Pinned Messages */}
          {pinnedMessages.length > 0 && (
            <div className="bg-yellow-50 border-b border-yellow-200 p-3">
              <div className="flex items-start gap-2">
                <Pin className="h-4 w-4 text-yellow-600 mt-1" />
                <div>
                  <p className="text-sm font-medium text-yellow-900">Pinned Messages</p>
                  <div className="space-y-1 mt-1">
                    {pinnedMessages.map(msg => (
                      <p key={msg.id} className="text-xs text-yellow-800">{msg.body}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-600">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              filteredThreads.map((thread, idx) => {
                const mainMessage = thread[0];
                const replies = thread.slice(1);
                
                return (
                  <Card key={idx} className={mainMessage.priority === 'urgent' ? 'border-red-300' : ''}>
                    <CardContent className="pt-4">
                      {/* Main Message */}
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <Users className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{mainMessage.sender_name}</span>
                            <span className="text-xs text-slate-500">
                              {new Date(mainMessage.created_date).toLocaleString()}
                            </span>
                            {mainMessage.priority === 'urgent' && (
                              <Badge className="bg-red-100 text-red-800">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Urgent
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{mainMessage.body}</p>
                          
                          {/* Replies */}
                          {replies.length > 0 && (
                            <div className="mt-3 ml-4 pl-4 border-l-2 border-slate-200 space-y-2">
                              {replies.map(reply => (
                                <div key={reply.id}>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-xs">{reply.sender_name}</span>
                                    <span className="text-xs text-slate-500">
                                      {new Date(reply.created_date).toLocaleString()}
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-700">{reply.body}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedThread(mainMessage.thread_id || mainMessage.id)}
                            className="mt-2 text-xs"
                          >
                            Reply to thread
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Message Input */}
          <div className="bg-white border-t border-slate-200 p-4">
            {selectedThread && (
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="outline">Replying to thread</Badge>
                <Button size="sm" variant="ghost" onClick={() => setSelectedThread(null)}>
                  Cancel
                </Button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                placeholder="Type your message... Use @name to mention someone"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                className="flex-1 min-h-[80px]"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!messageBody.trim() || sendMessageMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}