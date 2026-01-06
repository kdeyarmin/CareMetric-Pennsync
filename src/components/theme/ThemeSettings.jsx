import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Palette, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

export default function ThemeSettings() {
  const { theme, accentColor, setTheme, setAccentColor } = useTheme();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const themeMode = currentUser?.theme_mode || 'light';

  const accentColors = [
    { value: "blue", color: "bg-blue-600", name: "Blue" },
    { value: "purple", color: "bg-purple-600", name: "Purple" },
    { value: "green", color: "bg-green-600", name: "Green" },
    { value: "orange", color: "bg-orange-600", name: "Orange" },
    { value: "pink", color: "bg-pink-600", name: "Pink" },
    { value: "indigo", color: "bg-indigo-600", name: "Indigo" }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-600" />
            Theme & Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme Mode */}
          <div>
            <Label className="text-base font-semibold mb-3 block">Theme Mode</Label>
            <RadioGroup value={themeMode} onValueChange={setTheme}>
              <motion.div 
                whileHover={{ scale: 1.02 }}
                className="flex items-center space-x-3 p-4 border-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-all"
              >
                <RadioGroupItem value="light" id="light" />
                <Label htmlFor="light" className="cursor-pointer flex items-center gap-2 flex-1">
                  <Sun className="w-5 h-5 text-yellow-600" />
                  <div>
                    <p className="font-semibold">Light Mode</p>
                    <p className="text-sm text-gray-500">Classic bright interface</p>
                  </div>
                </Label>
              </motion.div>

              <motion.div 
                whileHover={{ scale: 1.02 }}
                className="flex items-center space-x-3 p-4 border-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-all"
              >
                <RadioGroupItem value="dark" id="dark" />
                <Label htmlFor="dark" className="cursor-pointer flex items-center gap-2 flex-1">
                  <Moon className="w-5 h-5 text-indigo-600" />
                  <div>
                    <p className="font-semibold">Dark Mode</p>
                    <p className="text-sm text-gray-500">Easy on the eyes</p>
                  </div>
                </Label>
              </motion.div>

              <motion.div 
                whileHover={{ scale: 1.02 }}
                className="flex items-center space-x-3 p-4 border-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-all"
              >
                <RadioGroupItem value="system" id="system" />
                <Label htmlFor="system" className="cursor-pointer flex items-center gap-2 flex-1">
                  <Monitor className="w-5 h-5 text-gray-600" />
                  <div>
                    <p className="font-semibold">System</p>
                    <p className="text-sm text-gray-500">Match your device settings</p>
                  </div>
                </Label>
              </motion.div>
            </RadioGroup>
          </div>

          {/* Accent Color */}
          <div>
            <Label className="text-base font-semibold mb-3 block">Accent Color</Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {accentColors.map((color) => (
                <motion.button
                  key={color.value}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAccentColor(color.value)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    accentColor === color.value 
                      ? 'border-gray-900 dark:border-white shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-full ${color.color} mx-auto mb-2`} />
                  <p className="text-xs font-medium">{color.name}</p>
                </motion.button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}