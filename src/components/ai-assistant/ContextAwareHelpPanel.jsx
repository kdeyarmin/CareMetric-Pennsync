import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, X, ExternalLink, CheckCircle2 } from "lucide-react";

const HELP_CONTENT = {
  OASIS: {
    title: "OASIS Help",
    sections: [
      {
        title: "Required Fields",
        content: "All OASIS-C2 fields marked as required must be completed. Skipping required fields will result in submission errors."
      },
      {
        title: "Data Validation",
        content: "The system validates all entries against CMS guidelines. Invalid entries will be flagged before submission."
      },
      {
        title: "Regulatory Reference",
        content: "Refer to the current OASIS-C2 guidance document from CMS for field-specific requirements.",
        link: "https://www.cms.gov/oasis"
      }
    ]
  },
  Compliance: {
    title: "Compliance Help",
    sections: [
      {
        title: "Documentation Standards",
        content: "Ensure all clinical documentation meets HIPAA and CMS CoP requirements."
      },
      {
        title: "Audit Preparation",
        content: "Maintain clear documentation trails and complete records for compliance audits."
      },
      {
        title: "Regulatory Updates",
        content: "Stay informed of changes to healthcare regulations that affect your documentation."
      }
    ]
  },
  SmartNoteAssistant: {
    title: "Smart Note Help",
    sections: [
      {
        title: "Best Practices",
        content: "Include specific clinical observations, patient responses, and objective measurements in your notes."
      },
      {
        title: "Required Elements",
        content: "Ensure your notes document assessment, interventions, patient response, and plan for next visit."
      },
      {
        title: "Compliance Checking",
        content: "Use the AI to check your notes for common documentation gaps and compliance issues."
      }
    ]
  }
};

export default function ContextAwareHelpPanel({ currentPage, onClose }) {
  const helpContent = HELP_CONTENT[currentPage];

  if (!helpContent) return null;

  return (
    <Card className="w-96 shadow-lg border-l-4 border-l-blue-600">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-blue-600" />
          <CardTitle className="text-base">{helpContent.title}</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-6 w-6"
        >
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {helpContent.sections.map((section, idx) => (
          <div key={idx} className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              {section.title}
            </h4>
            <p className="text-sm text-slate-600">{section.content}</p>
            {section.link && (
              <a
                href={section.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                Learn more <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}