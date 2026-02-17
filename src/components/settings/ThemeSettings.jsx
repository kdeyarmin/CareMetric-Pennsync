import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Moon, Sun, Palette } from "lucide-react";

export default function ThemeSettings({ currentUser }) {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    const savedTheme = localStorage?.getItem('theme') || 'system';
    setTheme(savedTheme);
  }, []);

  const applyTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage?.setItem('theme', newTheme);
    
    const html = document.documentElement;
    if (newTheme === 'dark') {
      html.classList.add('dark');
    } else if (newTheme === 'light') {
      html.classList.remove('dark');
    } else {
      // System preference
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="bg-gradient-to-r from-purple-100/60 to-slate-100/60 dark:from-slate-800/40 dark:to-slate-900/30 p-3 sm:p-4 md:p-6">
        <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base">
          <Palette className="w-4 h-4 sm:w-5 sm:h-5" />
          Theme & Appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div>
          <Label className="text-sm font-medium mb-3 block">Color Theme</Label>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => applyTheme('light')}
              className={`p-3 rounded-lg border-2 transition-all ${
                theme === 'light'
                  ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                  : 'border-slate-300 dark:border-slate-600 hover:border-yellow-400'
              }`}
            >
              <Sun className="w-5 h-5 mx-auto mb-1 text-yellow-600" />
              <span className="text-xs font-medium">Light</span>
            </button>
            <button
              onClick={() => applyTheme('dark')}
              className={`p-3 rounded-lg border-2 transition-all ${
                theme === 'dark'
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400'
              }`}
            >
              <Moon className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
              <span className="text-xs font-medium">Dark</span>
            </button>
            <button
              onClick={() => applyTheme('system')}
              className={`p-3 rounded-lg border-2 transition-all ${
                theme === 'system'
                  ? 'border-slate-500 bg-slate-50 dark:bg-slate-900/20'
                  : 'border-slate-300 dark:border-slate-600 hover:border-slate-400'
              }`}
            >
              <Palette className="w-5 h-5 mx-auto mb-1 text-slate-600" />
              <span className="text-xs font-medium">System</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Select your preferred color theme or let your system settings decide.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}