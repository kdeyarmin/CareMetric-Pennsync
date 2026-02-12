import React from "react";

export default function DocStep({ number, title, children }) {
  return (
    <div className="flex gap-4 mb-4">
      <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
        {number}
      </div>
      <div className="flex-1">
        <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">{title}</h4>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}