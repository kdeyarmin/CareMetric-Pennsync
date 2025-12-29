import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Key, RefreshCw } from "lucide-react";
import { adminResetPassword } from "@/functions/adminResetPassword";

export default function UserPasswordReset({ user, trigger }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const generateRandomPassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
  };

  const handleReset = async () => {
    if (!newPassword || newPassword.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }

    setIsResetting(true);
    try {
      const response = await adminResetPassword({
        user_email: user.email,
        new_password: newPassword
      });

      if (response.data.success) {
        alert(`Password reset successfully for ${user.email}. User has been notified via email.`);
        setOpen(false);
        setNewPassword("");
      } else {
        alert(response.data.error || "Failed to reset password");
      }
    } catch (error) {
      console.error("Error resetting password:", error);
      alert("Failed to reset password. Please try again.");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <div onClick={() => setOpen(true)}>
          {trigger}
        </div>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-blue-600" />
            Reset Password for {user.full_name || user.email}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="newPassword">New Password</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="newPassword"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 8 chars)"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={generateRandomPassword}
                size="sm"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              User will receive this password via email and should change it immediately
            </p>
          </div>

          {newPassword && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-xs font-medium text-blue-900 mb-1">Password Preview:</p>
              <p className="font-mono text-sm text-blue-800 break-all">{newPassword}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              setNewPassword("");
            }}
            disabled={isResetting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReset}
            disabled={isResetting || !newPassword}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isResetting ? "Resetting..." : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}