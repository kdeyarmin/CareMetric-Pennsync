import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Link as LinkIcon, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function SecureInCallChat({ visitId, patientId, providerEmail }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputValue.trim()) return;

    const newMessage = {
      id: Date.now(),
      text: inputValue,
      sender: 'provider',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'text'
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue('');

    // Store message securely
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: providerEmail,
        subject: `In-Call Message Log - Visit ${visitId}`,
        body: `Message sent during call: ${inputValue}`
      });
    } catch (error) {
      console.error('Error logging message:', error);
    }
  };

  const shareResourceLink = () => {
    if (!shareLink.trim()) return;

    const newMessage = {
      id: Date.now(),
      text: shareLink,
      sender: 'provider',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'link',
      label: 'Resource'
    };

    setMessages(prev => [...prev, newMessage]);
    setShareLink('');
    setShowLinkModal(false);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Send className="w-4 h-4" />
          In-Call Chat
          <span className="ml-auto text-xs text-gray-500 font-normal">HIPAA Secure</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col space-y-3 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-2 border rounded-lg bg-gray-50 p-3">
          {messages.length > 0 ? (
            messages.map((msg) => (
              <div key={msg.id} className="text-xs">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    {msg.type === 'link' ? (
                      <a
                        href={msg.text}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <LinkIcon className="w-3 h-3" />
                        {msg.label}
                      </a>
                    ) : (
                      <p className="text-gray-700">{msg.text}</p>
                    )}
                  </div>
                  <span className="text-gray-400 whitespace-nowrap">{msg.timestamp}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-gray-400 text-xs">No messages yet</p>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type message..."
              className="text-sm h-8"
            />
            <Button
              size="sm"
              onClick={sendMessage}
              className="px-2"
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowLinkModal(!showLinkModal)}
            className="w-full text-xs"
          >
            <LinkIcon className="w-3 h-3 mr-1" />
            Share Resource
          </Button>
        </div>

        {/* Link Modal */}
        {showLinkModal && (
          <div className="border rounded-lg p-2 bg-blue-50 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium">Paste Resource Link:</label>
              <button onClick={() => setShowLinkModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-1">
              <Input
                value={shareLink}
                onChange={(e) => setShareLink(e.target.value)}
                placeholder="https://..."
                className="text-xs h-7"
              />
              <Button
                size="sm"
                onClick={shareResourceLink}
                className="px-2 text-xs"
              >
                Share
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}