import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronDown, ChevronUp, Lightbulb, BookOpenCheck, MessageSquare, Eye,
  AlertTriangle, Zap, ListChecks, ThumbsUp, ThumbsDown, Brain, Stethoscope,
  HelpCircle, ClipboardList
} from "lucide-react";
import ModuleVideoPlayer from "./ModuleVideoPlayer";

function ReadingTime({ content }) {
  const text = JSON.stringify(content || "");
  const words = text.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return <span className="text-xs text-slate-400">~{minutes} min read</span>;
}

function Section({ section, index, onViewed, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRef(null);

  useEffect(() => {
    if (!open || !sectionRef.current || !onViewed) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onViewed(index); },
      { threshold: 0.5 }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [open, index, onViewed]);

  const doDont = section.do_dont;
  const hasDoDont = doDont && ((doDont.do?.length > 0) || (doDont.dont?.length > 0));

  return (
    <div ref={sectionRef} className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
            {index + 1}
          </span>
          {section.heading}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-4 sm:px-5 py-4 space-y-4 text-slate-700 text-sm leading-7">
          {section.body && <p>{section.body}</p>}

          {section.bullets?.length > 0 && (
            <ul className="space-y-2">
              {section.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2.5 flex-shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Step-by-step procedure */}
          {section.steps?.length > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5" /> Step-by-Step
              </p>
              <ol className="space-y-2">
                {section.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-indigo-900">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {section.example && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Practical Example</p>
              <p className="text-blue-900">{section.example}</p>
            </div>
          )}

          {/* Pro tip */}
          {section.pro_tip && (
            <div className="rounded-xl bg-navy-50 border border-navy-200 p-4 flex gap-3">
              <Zap className="w-5 h-5 text-navy-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-navy-700 uppercase tracking-wide mb-1">Pro Tip</p>
                <p className="text-navy-900 text-sm">{section.pro_tip}</p>
              </div>
            </div>
          )}

          {/* Warning callout */}
          {section.warning && (
            <div className="rounded-xl bg-red-50 border-2 border-red-200 p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Important Warning</p>
                <p className="text-red-900 text-sm font-medium">{section.warning}</p>
              </div>
            </div>
          )}

          {/* Do / Don't comparison */}
          {hasDoDont && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {doDont.do?.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <ThumbsUp className="w-3.5 h-3.5" /> Do This
                  </p>
                  <ul className="space-y-1.5">
                    {doDont.do.map((item, i) => (
                      <li key={i} className="text-sm text-emerald-900 flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doDont.dont?.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <ThumbsDown className="w-3.5 h-3.5" /> Avoid This
                  </p>
                  <ul className="space-y-1.5">
                    {doDont.dont.map((item, i) => (
                      <li key={i} className="text-sm text-red-900 flex items-start gap-2">
                        <span className="text-red-500 mt-0.5">✗</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Mnemonic / Memory aid */}
          {section.mnemonic && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
              <Brain className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Memory Aid</p>
                <p className="text-amber-900 text-sm font-medium">{section.mnemonic}</p>
              </div>
            </div>
          )}

          {/* Regulation reference */}
          {section.regulation_ref && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-600">
              <ClipboardList className="w-3.5 h-3.5 flex-shrink-0" />
              <span><strong>Regulatory Reference:</strong> {section.regulation_ref}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrainingModuleViewer({ module }) {
  const content = module?.content_json || {};
  const sections = content.sections || [];
  const scenarios = content.case_scenarios || [];
  const takeaways = content.key_takeaways || [];
  const checkQuestions = content.check_your_understanding || [];
  const [viewedSections, setViewedSections] = useState(new Set());

  const handleSectionViewed = (index) => {
    setViewedSections(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  const readingProgress = sections.length > 0
    ? Math.round((viewedSections.size / sections.length) * 100)
    : 100;

  const typeColors = {
    lesson: "bg-blue-100 text-blue-800",
    video: "bg-navy-100 text-navy-800",
    policy: "bg-orange-100 text-orange-800",
    checklist: "bg-navy-100 text-navy-800",
    attestation: "bg-gold-100 text-gold-800",
    simulation: "bg-indigo-100 text-indigo-800",
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base sm:text-lg text-slate-900">{module.title}</CardTitle>
            <div className="flex items-center gap-3 mt-1">
              <ReadingTime content={content} />
              {sections.length > 0 && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {viewedSections.size}/{sections.length} sections read
                </span>
              )}
            </div>
          </div>
          <Badge className={typeColors[module.type] || "bg-slate-100 text-slate-700"}>
            {module.type}
          </Badge>
        </div>
        {sections.length > 1 && (
          <Progress value={readingProgress} className="h-1 mt-3 [&>div]:bg-blue-500" />
        )}
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-5">
        {/* Video-first lesson: plays the produced video if present, otherwise a
            narrated slideshow built from this module's content. */}
        <ModuleVideoPlayer module={module} />

        {content.intro && (
          <p className="text-slate-700 leading-7 text-sm sm:text-base border-l-4 border-blue-200 pl-4 bg-blue-50/50 py-2 rounded-r-xl">
            {content.intro}
          </p>
        )}

        {sections.length > 0 && (
          <div className="space-y-2">
            {sections.map((section, i) => (
              <Section
                key={i}
                section={section}
                index={i}
                onViewed={handleSectionViewed}
                defaultOpen={sections.length <= 4 || i === 0}
              />
            ))}
          </div>
        )}

        {/* Check Your Understanding */}
        {checkQuestions.length > 0 && (
          <div className="rounded-xl border border-navy-200 bg-navy-50 p-4">
            <h3 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
              <HelpCircle className="w-4 h-4" /> Check Your Understanding
            </h3>
            <ul className="space-y-2">
              {checkQuestions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-navy-900">
                  <span className="w-5 h-5 rounded-full bg-navy-200 text-navy-800 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Case Scenarios */}
        {scenarios.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-500" /> Case Scenarios
            </h3>
            {scenarios.map((scenario, i) => (
              <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="font-semibold text-amber-900">{scenario.title}</p>
                {scenario.patient_context && (
                  <div className="text-xs text-amber-800 bg-amber-100/70 rounded-lg px-3 py-2 flex items-start gap-2">
                    <Stethoscope className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{scenario.patient_context}</span>
                  </div>
                )}
                <p className="text-amber-900/90 text-sm leading-6">{scenario.situation}</p>
                {scenario.challenge && (
                  <div className="text-sm text-amber-900 bg-amber-100 rounded-lg px-3 py-2 font-medium">
                    <strong>The Question:</strong> {scenario.challenge}
                  </div>
                )}
                {scenario.guidance && (
                  <div className="text-sm text-amber-800 bg-white/60 rounded-lg px-3 py-2 border border-amber-200">
                    <strong>Best Practice:</strong> {scenario.guidance}
                  </div>
                )}
                {scenario.what_could_go_wrong && (
                  <div className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2 border border-red-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span><strong>Risk:</strong> {scenario.what_could_go_wrong}</span>
                  </div>
                )}
                {scenario.discussion_questions?.length > 0 && (
                  <div className="pt-2 border-t border-amber-200">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Think About It</p>
                    <ul className="space-y-1">
                      {scenario.discussion_questions.map((dq, j) => (
                        <li key={j} className="text-sm text-amber-800 flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5">→</span>
                          <span>{dq}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Clinical Pearl */}
        {content.clinical_pearl && (
          <div className="rounded-xl bg-gradient-to-r from-navy-50 to-navy-50 border border-navy-200 p-4 flex gap-3">
            <Stethoscope className="w-5 h-5 text-navy-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-navy-700 uppercase tracking-wide mb-1">Clinical Pearl</p>
              <p className="text-navy-900 text-sm">{content.clinical_pearl}</p>
            </div>
          </div>
        )}

        {/* Key Takeaways */}
        {takeaways.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-semibold text-emerald-900 mb-3 flex items-center gap-2">
              <BookOpenCheck className="w-4 h-4" /> Key Takeaways
            </h3>
            <ul className="space-y-2">
              {takeaways.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-emerald-900">
                  <Lightbulb className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Module Summary */}
        {content.summary && (
          <div className="rounded-xl bg-slate-100 border border-slate-200 p-4 flex gap-3">
            <ClipboardList className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Module Summary</p>
              <p className="text-slate-800 text-sm leading-relaxed">{content.summary}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
