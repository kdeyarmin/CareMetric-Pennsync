import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Clock } from 'lucide-react';

const TIMEOUT_MINUTES = 15;
const WARNING_MINUTES = 2;
const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;
const WARNING_MS = WARNING_MINUTES * 60 * 1000;

export default function SessionTimeoutWarning() {
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(WARNING_MS);

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const updateSessionMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      
      // Update session timeout record
      const sessions = await base44.entities.SessionTimeout.filter({
        user_email: user.email
      });

      if (sessions.length > 0) {
        await base44.entities.SessionTimeout.update(sessions[0].id, {
          last_activity: new Date().toISOString(),
          warning_shown: false
        });
      } else {
        await base44.entities.SessionTimeout.create({
          user_email: user.email,
          last_activity: new Date().toISOString(),
          session_token: `session_${Date.now()}`,
          timeout_minutes: TIMEOUT_MINUTES,
          warning_shown: false,
          auto_logout: true
        });
      }
    }
  });

  useEffect(() => {
    if (!user) return;

    const resetActivity = () => {
      setLastActivity(Date.now());
      setShowWarning(false);
      updateSessionMutation.mutate();
    };

    // Track user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      document.addEventListener(event, resetActivity, true);
    });

    // Check for timeout
    const checkInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivity;
      const remainingTime = TIMEOUT_MS - timeSinceActivity;

      if (remainingTime <= 0) {
        // Timeout - logout
        handleLogout();
      } else if (remainingTime <= WARNING_MS && !showWarning) {
        // Show warning
        setShowWarning(true);
        setTimeRemaining(remainingTime);
      }

      if (showWarning) {
        setTimeRemaining(remainingTime);
      }
    }, 1000);

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resetActivity, true);
      });
      clearInterval(checkInterval);
    };
  }, [user, lastActivity, showWarning]);

  const handleLogout = async () => {
    await base44.auth.logout();
    window.location.reload();
  };

  const handleStayLoggedIn = () => {
    setLastActivity(Date.now());
    setShowWarning(false);
    updateSessionMutation.mutate();
  };

  if (!user || !showWarning) return null;

  const secondsRemaining = Math.max(0, Math.floor(timeRemaining / 1000));
  const minutesRemaining = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const progressValue = (timeRemaining / WARNING_MS) * 100;

  return (
    <Dialog open={showWarning} onOpenChange={(open) => !open && handleStayLoggedIn()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Session Timeout Warning
          </DialogTitle>
          <DialogDescription>
            Your session is about to expire due to inactivity
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center gap-2 text-4xl font-bold text-slate-900">
            <Clock className="h-8 w-8 text-yellow-600" />
            {minutesRemaining}:{seconds.toString().padStart(2, '0')}
          </div>

          <Progress value={progressValue} className="h-2" />

          <p className="text-sm text-center text-slate-600">
            You will be automatically logged out in {minutesRemaining} minute{minutesRemaining !== 1 ? 's' : ''} and {seconds} second{seconds !== 1 ? 's' : ''} for security purposes.
          </p>

          <p className="text-xs text-center text-slate-500">
            Click "Stay Logged In" to continue your session or "Logout" to end it now.
          </p>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleLogout}
            className="flex-1"
          >
            Logout Now
          </Button>
          <Button
            onClick={handleStayLoggedIn}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            Stay Logged In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}