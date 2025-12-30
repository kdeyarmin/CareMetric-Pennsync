import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, TrendingUp, Calendar, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export default function TimeSavingsCalculator() {
  const [visitsPerDay, setVisitsPerDay] = useState("");

  const calculateSavings = () => {
    const visits = parseFloat(visitsPerDay) || 0;
    const minutesSavedPerVisit = 20;
    const dailyMinutes = visits * minutesSavedPerVisit;
    const dailyHours = dailyMinutes / 60;
    const weeklyHours = dailyHours * 5;
    const monthlyHours = dailyHours * 21;
    const yearlyHours = dailyHours * 252;

    return {
      dailyHours: dailyHours.toFixed(1),
      weeklyHours: weeklyHours.toFixed(1),
      monthlyHours: monthlyHours.toFixed(1),
      yearlyHours: yearlyHours.toFixed(1)
    };
  };

  const savings = calculateSavings();
  const hasValue = visitsPerDay && parseFloat(visitsPerDay) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <Card className="border-0 bg-white/95 backdrop-blur shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-500 opacity-5" />
        <CardHeader className="text-center relative pb-4">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="flex justify-center mb-4"
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-xl">
              <Clock className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </div>
          </motion.div>
          <CardTitle className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 mb-2">
            How Much Time Will You Save?
          </CardTitle>
          <p className="text-sm sm:text-base text-gray-600">
            Calculate your personal time savings with CareMetric AI
          </p>
        </CardHeader>
        <CardContent className="space-y-6 relative px-4 sm:px-6">
          <div className="max-w-md mx-auto">
            <Label htmlFor="visits" className="text-base sm:text-lg font-semibold text-gray-900 mb-3 block">
              How many patient visits do you do per day?
            </Label>
            <Input
              id="visits"
              type="number"
              min="0"
              step="1"
              placeholder="Enter number of visits..."
              value={visitsPerDay}
              onChange={(e) => setVisitsPerDay(e.target.value)}
              className="h-14 sm:h-16 text-xl sm:text-2xl text-center font-bold border-2 border-gray-300 focus:border-green-500"
            />
          </div>

          {hasValue && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-6 rounded-xl border-2 border-blue-200 text-center"
                >
                  <Clock className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm text-blue-600 font-medium mb-1">Daily Savings</p>
                  <p className="text-3xl sm:text-4xl font-extrabold text-blue-900">
                    {savings.dailyHours}
                  </p>
                  <p className="text-xs sm:text-sm text-blue-700 font-medium">hours</p>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 sm:p-6 rounded-xl border-2 border-indigo-200 text-center"
                >
                  <Calendar className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-600 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm text-indigo-600 font-medium mb-1">Weekly Savings</p>
                  <p className="text-3xl sm:text-4xl font-extrabold text-indigo-900">
                    {savings.weeklyHours}
                  </p>
                  <p className="text-xs sm:text-sm text-indigo-700 font-medium">hours • 5 days</p>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 sm:p-6 rounded-xl border-2 border-purple-200 text-center"
                >
                  <Calendar className="w-8 h-8 sm:w-10 sm:h-10 text-purple-600 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm text-purple-600 font-medium mb-1">Monthly Savings</p>
                  <p className="text-3xl sm:text-4xl font-extrabold text-purple-900">
                    {savings.monthlyHours}
                  </p>
                  <p className="text-xs sm:text-sm text-purple-700 font-medium">hours • 21 days</p>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="bg-gradient-to-br from-green-50 to-green-100 p-4 sm:p-6 rounded-xl border-2 border-green-200 text-center"
                >
                  <TrendingUp className="w-8 h-8 sm:w-10 sm:h-10 text-green-600 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm text-green-600 font-medium mb-1">Yearly Savings</p>
                  <p className="text-3xl sm:text-4xl font-extrabold text-green-900">
                    {savings.yearlyHours}
                  </p>
                  <p className="text-xs sm:text-sm text-green-700 font-medium">hours • 252 days</p>
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="bg-gradient-to-r from-amber-50 to-orange-50 p-6 sm:p-8 rounded-xl border-2 border-amber-200 text-center"
              >
                <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-amber-500 mx-auto mb-3" />
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
                  What would you do with all that extra time?
                </h3>
                <div className="flex flex-wrap justify-center gap-2 text-sm sm:text-base text-gray-700">
                  <span className="bg-white px-3 sm:px-4 py-2 rounded-full shadow">✨ Spend more time with patients</span>
                  <span className="bg-white px-3 sm:px-4 py-2 rounded-full shadow">💼 Reduce overtime</span>
                  <span className="bg-white px-3 sm:px-4 py-2 rounded-full shadow">👨‍👩‍👧‍👦 Get home earlier</span>
                  <span className="bg-white px-3 sm:px-4 py-2 rounded-full shadow">🌟 Improve work-life balance</span>
                </div>
              </motion.div>
            </motion.div>
          )}

          {!hasValue && (
            <div className="text-center py-6 text-gray-500">
              <p className="text-sm sm:text-base">Enter your daily visit count above to see your potential time savings</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}