import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, Loader2, Send, Users, AlertCircle, CheckCircle2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export default function InactiveUserEmailManager() {
  const [daysInactive, setDaysInactive] = useState(7);
  const [testMode, setTestMode] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [results, setResults] = useState(null);

  const sendEmailsMutation = useMutation({
    mutationFn: async ({ days, test }) => {
      const response = await base44.functions.invoke('sendInactiveUserEmail', {
        days_inactive: days,
        test_mode: test
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setResults(data);
      if (data.success) {
        if (data.test_mode) {
          toast.success(`Found ${data.inactive_users_found || 0} inactive users (test mode)`);
        } else {
          toast.success(`Sent ${data.emails_sent || 0} emails to inactive users`);
        }
      }
    },
    onError: (error) => {
      console.error('Error sending emails:', error);
      toast.error('Failed to process inactive users');
    }
  });

  const handleSendEmails = () => {
    if (!testMode && !confirm(`Send re-engagement emails to inactive users who joined in the last ${daysInactive} days?\n\nThis will send actual emails.`)) {
      return;
    }
    
    sendEmailsMutation.mutate({ days: daysInactive, test: testMode });
  };

  return (
    <>
      <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-purple-600" />
            Inactive User Re-Engagement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-300">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 dark:text-blue-100">
              <p className="font-semibold mb-1">Re-Engagement Email Campaign</p>
              <p className="text-sm">
                Send professional, welcoming emails to users who signed up but haven't logged in or shown activity. 
                Perfect for converting sign-ups into active users.
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <Label htmlFor="daysInactive">Days Since Registration</Label>
              <Input
                id="daysInactive"
                type="number"
                min="1"
                max="30"
                value={daysInactive}
                onChange={(e) => setDaysInactive(parseInt(e.target.value) || 7)}
                placeholder="7"
              />
              <p className="text-xs text-gray-600 mt-1">
                Target users who registered within the last X days but have no activity
              </p>
            </div>

            <div className="flex items-center gap-2 p-3 bg-white dark:bg-slate-900 rounded border">
              <input
                type="checkbox"
                id="testMode"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="w-4 h-4"
              />
              <Label htmlFor="testMode" className="cursor-pointer">
                Test Mode (Preview only - don't send emails)
              </Label>
            </div>

            {results && (
              <Alert className={results.test_mode ? "bg-yellow-50 border-yellow-300" : "bg-green-50 border-green-300"}>
                <CheckCircle2 className={`w-4 h-4 ${results.test_mode ? 'text-yellow-600' : 'text-green-600'}`} />
                <AlertDescription>
                  <p className="font-semibold mb-2">
                    {results.test_mode ? '📋 Test Results' : '✅ Campaign Complete'}
                  </p>
                  <div className="space-y-1 text-sm">
                    <p>• Found {results.inactive_users_found || 0} inactive users</p>
                    {!results.test_mode && (
                      <>
                        <p>• Sent {results.emails_sent || 0} emails successfully</p>
                        {results.emails_failed > 0 && (
                          <p className="text-red-600">• Failed to send {results.emails_failed} emails</p>
                        )}
                      </>
                    )}
                  </div>
                  
                  {results.inactive_users && results.inactive_users.length > 0 && (
                    <div className="mt-3 max-h-40 overflow-y-auto bg-white dark:bg-slate-800 p-2 rounded">
                      <p className="font-semibold text-xs mb-2">Inactive Users:</p>
                      {results.inactive_users.map((user, i) => (
                        <p key={i} className="text-xs text-gray-700 dark:text-gray-300">
                          • {user.email} - Joined {new Date(user.created_date).toLocaleDateString()}
                        </p>
                      ))}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSendEmails}
                disabled={sendEmailsMutation.isPending}
                className={testMode ? "bg-yellow-600 hover:bg-yellow-700" : "bg-purple-600 hover:bg-purple-700"}
              >
                {sendEmailsMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : testMode ? (
                  <>
                    <Users className="w-4 h-4 mr-2" />
                    Preview Inactive Users
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Re-Engagement Emails
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowPreview(true)}
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview Email
              </Button>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded border space-y-2">
              <p className="text-sm font-semibold">Email Content Preview:</p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <li>✓ Professional, warm welcome message</li>
                <li>✓ Platform value proposition with statistics</li>
                <li>✓ Key features overview</li>
                <li>✓ Simple 3-step getting started guide</li>
                <li>✓ User testimonial for social proof</li>
                <li>✓ Clear call-to-action button</li>
                <li>✓ Support contact information</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Preview</DialogTitle>
            <DialogDescription>
              This is what inactive users will receive
            </DialogDescription>
          </DialogHeader>
          
          <div className="border rounded p-4 bg-gray-50 dark:bg-slate-900">
            <div className="bg-white dark:bg-slate-800 rounded shadow-sm max-w-2xl mx-auto">
              <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-8 rounded-t text-center">
                <h1 className="text-2xl font-bold mb-2">🏥 Welcome Back to CareMetric AI</h1>
                <p className="text-sm opacity-95">We noticed you haven't had a chance to explore yet</p>
              </div>
              
              <div className="p-6 space-y-4">
                <h2 className="text-xl text-blue-800 dark:text-blue-200">Hi [User Name],</h2>
                
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  We're excited to have you as part of the CareMetric AI community! We noticed you created your account but haven't had a chance to dive in yet.
                </p>

                <div className="grid grid-cols-3 gap-4 my-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-600">70%</div>
                    <div className="text-xs text-gray-600">Less Documentation Time</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-600">95%</div>
                    <div className="text-xs text-gray-600">Compliance Accuracy</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-600">3hrs</div>
                    <div className="text-xs text-gray-600">Saved Per Day</div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">What You Can Do in Just 5 Minutes:</h3>
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">✓</span>
                      <span><strong>Smart Note Assistant</strong> - Turn rough notes into compliance-ready documentation</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">✓</span>
                      <span><strong>AI Visit Scribe</strong> - Record your visit, get a perfect note automatically</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">✓</span>
                      <span><strong>Risk Prediction</strong> - Identify high-risk patients before issues arise</span>
                    </li>
                  </ul>
                </div>

                <div className="text-center my-6">
                  <a 
                    href="https://caremetricai.com" 
                    className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                  >
                    Get Started Now →
                  </a>
                </div>
              </div>
              
              <div className="bg-gray-100 dark:bg-slate-900 p-6 text-center text-xs text-gray-600 dark:text-gray-400 rounded-b">
                <p className="font-semibold">CareMetric AI</p>
                <p>AI-Powered Clinical Documentation & Compliance Platform</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}