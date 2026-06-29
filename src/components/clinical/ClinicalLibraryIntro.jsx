import { BookOpen, Sparkles, FolderOpen, Globe, User } from "lucide-react";

// Explains what the Clinical Templates tab is for and how personal vs. admin
// global templates work, so users know what to do on this page.
export default function ClinicalLibraryIntro({ isAdmin = false }) {
  return (
    <div className="rounded-xl border border-navy-200 bg-navy-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-navy-600 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-navy-900">Clinical Templates</h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            Create reusable documentation "quick phrases" that expand into full,
            Medicare-compliant text while you chart. Type a short trigger phrase
            (e.g. <code className="bg-white px-1 py-0.5 rounded text-xs">diabetic education</code>) in a
            visit note and it expands into your saved text — so you never retype
            the same narrative twice.
          </p>
          <ul className="text-sm text-slate-700 space-y-1.5">
            <li className="flex items-start gap-2">
              <User className="w-4 h-4 mt-0.5 text-navy-600 flex-shrink-0" />
              <span>
                <strong>Your templates:</strong> Any template you create is private
                to you and the patients you chart on.
              </span>
            </li>
            {isAdmin && (
              <li className="flex items-start gap-2">
                <Globe className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                <span>
                  <strong>Global templates (admins):</strong> Toggle "Make available
                  agency-wide" when creating a template to share it with every user.
                </span>
              </li>
            )}
            <li className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 text-navy-600 flex-shrink-0" />
              <span>
                <strong>AI assist:</strong> Use AI Generate to draft a template, or
                AI Suggestions to improve an existing one.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <FolderOpen className="w-4 h-4 mt-0.5 text-navy-600 flex-shrink-0" />
              <span>
                <strong>Organize:</strong> Group templates into folders and use bulk
                actions to keep your library tidy.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}