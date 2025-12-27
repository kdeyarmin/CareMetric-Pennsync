import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Share2, Mail, Copy, Check } from "lucide-react";

export default function ShareAppButton({ variant = "default", size = "default" }) {
  const [copied, setCopied] = useState(false);
  
  const appUrl = window.location.origin;
  const shareMessage = "Check out CareMetric AI - an amazing AI-powered clinical documentation assistant that saves nurses 2-3 hours daily!";
  
  const handleCopyLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleEmailShare = () => {
    const subject = encodeURIComponent("You should check out CareMetric AI!");
    const body = encodeURIComponent(`${shareMessage}\n\nTry it here: ${appUrl}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          <Share2 className="w-4 h-4" />
          Share App
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleEmailShare} className="cursor-pointer">
          <Mail className="w-4 h-4 mr-2" />
          Share via Email
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-2 text-green-600" />
              <span className="text-green-600">Link Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Copy Link
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}