import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, Wifi, WifiOff, FileText, Send, Info, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function FaxInstructions({ isOnline }) {
  return (
    <div className="space-y-3">
      {!isOnline && (
        <Alert className="bg-amber-50 border-amber-200">
          <WifiOff className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            <strong>You are offline.</strong> Faxes will be queued and sent automatically when you reconnect.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            How to Send a Fax
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <ol className="text-xs space-y-2 text-slate-600">
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 flex-shrink-0">1.</span>
              Enter the recipient's fax number or select from your address book
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 flex-shrink-0">2.</span>
              Optionally fill out a cover sheet with subject and message
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 flex-shrink-0">3.</span>
              Upload a PDF, take a photo, or attach documents
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 flex-shrink-0">4.</span>
              Hit "Send Fax" — you'll see status updates in your fax history
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 text-green-600" />
            Tips for Good Photos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <ul className="text-xs space-y-1.5 text-slate-600">
            <li className="flex gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              Place document on a flat, dark surface
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              Use good lighting — avoid shadows on the document
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              Hold camera directly above, parallel to the page
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              Ensure all text is in focus before capturing
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              For multi-page docs, take one photo per page
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wifi className="w-4 h-4 text-indigo-600" />
            Offline Faxing
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <p className="text-xs text-slate-600">
            You must be online to send a fax. If you're offline, your fax will be saved to a queue
            and sent automatically the next time you connect. You'll see a notification when it's sent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}