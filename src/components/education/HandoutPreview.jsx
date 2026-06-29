import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Mail, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { handoutTemplates } from "./handoutTemplates";

export default function HandoutPreview({ 
  isOpen, 
  onClose, 
  template, 
  patientName, 
  selectedSections,
  customNotes,
  onDownload,
  onEmail 
}) {
  if (!template) return null;

  // Get the full template with sections from handoutTemplates
  const fullTemplate = handoutTemplates[template.id];
  if (!fullTemplate || !fullTemplate.sections) return null;

  const sectionsToShow = selectedSections && Object.keys(selectedSections).length > 0
    ? fullTemplate.sections.filter(section => selectedSections[section.heading]?.included !== false)
    : fullTemplate.sections;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] p-0">
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <DialogTitle className="text-2xl font-bold text-slate-900">Preview: {template.title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {/* PDF-like preview */}
          <div className="bg-white shadow-lg mx-auto max-w-3xl border rounded-lg">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-8 py-6 border-b">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <img 
                    src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/c39653ba3_PennHomeHealthInc.png"
                    alt="Penn Home Health"
                    className="h-12"
                  />
                </div>
                <div className="text-right text-sm text-slate-600">
                  <div className="font-semibold">724-465-0440</div>
                  <div>www.pennhh.com</div>
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="px-8 py-6 border-b">
              <h1 className="text-3xl font-bold text-center text-blue-700 mb-2">
                {template.title}
              </h1>
              <div className="h-1 w-32 bg-navy-500 mx-auto"></div>
            </div>

            {/* Patient Info */}
            {patientName && (
              <div className="px-8 py-4 bg-slate-50 border-b">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-slate-700">Prepared for: </span>
                    <span className="text-slate-900">{patientName}</span>
                  </div>
                  <div className="text-sm text-slate-600">
                    {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="px-8 py-6 space-y-6">
              {sectionsToShow.map((section, idx) => (
                <div key={idx} className="space-y-3">
                  {/* Section heading */}
                  <div className={`border-l-4 pl-4 py-2 ${
                    section.emergency ? 'border-red-500 bg-red-50' :
                    section.important ? 'border-amber-500 bg-amber-50' :
                    'border-blue-500 bg-blue-50'
                  }`}>
                    <h2 className={`text-xl font-bold ${
                      section.emergency ? 'text-red-700' :
                      section.important ? 'text-amber-700' :
                      'text-blue-700'
                    }`}>
                      {section.heading}
                    </h2>
                  </div>

                  {/* Content */}
                  {section.content && (
                    <div className={`${section.highlight ? 'bg-blue-50 border border-blue-200 rounded-lg p-4' : ''}`}>
                      <p className="text-slate-700 leading-relaxed">{section.content}</p>
                    </div>
                  )}

                  {/* Subsections */}
                  {section.subsections?.map((subsection, subIdx) => (
                    <div key={subIdx} className="ml-4 space-y-2">
                      <h3 className="font-semibold text-navy-700 text-lg">• {subsection.subheading}</h3>
                      {subsection.bullets && (
                        <ul className="ml-6 space-y-1">
                          {subsection.bullets.map((bullet, bulletIdx) => (
                            <li key={bulletIdx} className="text-slate-700 flex items-start">
                              <span className="text-blue-600 mr-2">•</span>
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}

                  {/* Bullets */}
                  {section.bullets && (
                    <ul className="ml-4 space-y-2">
                      {section.bullets
                        .filter((bullet, idx) => !selectedSections?.[section.heading]?.bullets || selectedSections[section.heading].bullets[idx] !== false)
                        .map((bullet, bulletIdx) => (
                          <li key={bulletIdx} className="text-slate-700 flex items-start">
                            <span className="text-blue-600 mr-2 font-bold">•</span>
                            <span className="flex-1">{bullet}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}

              {/* Custom Notes */}
              {customNotes && customNotes.trim() && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-6 space-y-2">
                  <h2 className="text-xl font-bold text-amber-700">Special Instructions from Your Nurse</h2>
                  <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{customNotes}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-8 py-6 bg-slate-100 border-t">
              <div className="text-center space-y-2">
                <div className="font-bold text-blue-700">Penn Home Health Inc.</div>
                <div className="text-sm text-slate-600">Phone: 724-465-0440 | www.pennhh.com</div>
                <div className="text-xs text-slate-500">
                  This information is for educational purposes only. Always follow your healthcare provider's advice.
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Action buttons */}
        <div className="px-6 py-4 border-t bg-slate-50 flex justify-between items-center">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Close Preview
          </Button>
          <div className="flex gap-3">
            <Button onClick={onDownload} className="bg-blue-600 hover:bg-blue-700">
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            {onEmail && (
              <Button onClick={onEmail} variant="outline">
                <Mail className="w-4 h-4 mr-2" />
                Email PDF
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}