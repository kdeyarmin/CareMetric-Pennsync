import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  Sparkles,
  Shield,
  TrendingUp,
  Heart,
  FileText,
  Users,
  Clock,
  Target,
  BookOpen,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Stethoscope,
  Activity,
  Zap,
  Home,
  Award,
  Lightbulb,
  DollarSign
} from "lucide-react";
import { motion } from "framer-motion";
import ProspectChatbot from "../components/marketing/ProspectChatbot";
import ShareAppButton from "../components/marketing/ShareAppButton";

export const publicPage = true;

export default function Homepage() {
  const [scrollY, setScrollY] = useState(0);
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-30">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl animate-pulse" />
        <div className="absolute top-40 right-10 w-96 h-96 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl animate-pulse animation-delay-2000" />
        <div className="absolute bottom-20 left-1/3 w-80 h-80 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-pulse animation-delay-4000" />
      </div>

      {/* Hero Section */}
      <section className="relative overflow-hidden"
        style={{ transform: `translateY(${scrollY * 0.3}px)` }}>
        <div className="relative max-w-7xl mx-auto px-4 py-24 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex items-center justify-center gap-4 mb-8"
            >
              <motion.img
                whileHover={{ rotate: 360, scale: 1.1 }}
                transition={{ duration: 0.6 }}
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                alt="CareMetric AI Logo"
                className="w-24 h-24 object-contain drop-shadow-2xl" />
              <h1 className="text-6xl md:text-8xl font-extrabold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent leading-tight">
                CareMetric AI
              </h1>
            </motion.div>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-3xl md:text-4xl text-gray-800 mb-4 font-bold tracking-tight"
            >
              Your AI-Powered Clinical Documentation Assistant
            </motion.p>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="text-xl md:text-2xl text-gray-600 mb-8 max-w-4xl mx-auto leading-relaxed"
            >
              Revolutionizing home health nursing with intelligent documentation, 
              predictive analytics, and personalized patient education
            </motion.p>
            
            {/* Free Trial Banner */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="max-w-2xl mx-auto mb-10"
            >
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="relative"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-500 rounded-2xl blur-xl opacity-50" />
                <Card className="relative border-0 bg-gradient-to-r from-green-400 to-emerald-500 shadow-2xl">
                  <CardContent className="p-8 text-center">
                    <motion.div 
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                      className="flex items-center justify-center gap-2 mb-3"
                    >
                      <Sparkles className="w-7 h-7 text-white" />
                      <span className="text-3xl font-extrabold text-white">14-Day Free Trial</span>
                      <Sparkles className="w-7 h-7 text-white" />
                    </motion.div>
                    <p className="text-xl font-bold text-white mb-2">
                      Full Access • No Credit Card Required
                    </p>
                    <p className="text-base text-green-50">
                      Try all premium features free for 14 days. Cancel anytime.
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="flex flex-col sm:flex-row gap-5 justify-center items-center"
            >
              {currentUser ? (
                <Link to={createPageUrl("Dashboard")}>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button
                      size="lg"
                      className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-xl px-10 py-7 rounded-full shadow-2xl font-bold">
                        Go to Dashboard
                        <ArrowRight className="w-6 h-6 ml-2" />
                      </Button>
                  </motion.div>
                </Link>
              ) : (
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    size="lg"
                    onClick={() => base44.auth.redirectToLogin()}
                    className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-xl px-10 py-7 rounded-full shadow-2xl font-bold">
                      Sign In / Get Started
                      <ArrowRight className="w-6 h-6 ml-2" />
                    </Button>
                </motion.div>
              )}
              <Link to={createPageUrl("Pricing")}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button size="lg" variant="outline" className="text-xl px-10 py-7 border-3 rounded-full font-bold border-gray-300 hover:border-blue-600 hover:text-blue-600">
                    View Pricing
                    <DollarSign className="w-6 h-6 ml-2" />
                  </Button>
                </motion.div>
              </Link>
              <Link to={createPageUrl("About")}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button size="lg" variant="ghost" className="text-xl px-10 py-7 rounded-full font-semibold">
                    Learn More
                  </Button>
                </motion.div>
              </Link>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.6 }}
              className="mt-8 flex justify-center"
            >
              <ShareAppButton variant="ghost" size="lg" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Key Stats */}
      <section className="relative max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: Clock, value: "70%", label: "Time Saved on Notes", color: "green", delay: 0 },
            { icon: Shield, value: "100%", label: "Medicare Compliant", color: "purple", delay: 0.2 },
            { icon: TrendingUp, value: "95%+", label: "Quality Scores", color: "orange", delay: 0.4 }
          ].map((stat, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: stat.delay, duration: 0.6 }}
            >
              <motion.div whileHover={{ y: -10, scale: 1.03 }}>
                <Card className={`border-0 bg-white/90 backdrop-blur shadow-2xl overflow-hidden relative group`}>
                  <div className={`absolute inset-0 bg-gradient-to-br from-${stat.color}-400 to-${stat.color}-600 opacity-0 group-hover:opacity-10 transition-opacity duration-300`} />
                  <CardContent className="p-8 text-center relative">
                    <motion.div
                      whileHover={{ rotate: 360 }}
                      transition={{ duration: 0.6 }}
                    >
                      <stat.icon className={`w-16 h-16 text-${stat.color}-600 mx-auto mb-4`} />
                    </motion.div>
                    <motion.p 
                      className={`text-5xl font-extrabold text-${stat.color}-600 mb-2`}
                      whileHover={{ scale: 1.1 }}
                    >
                      {stat.value}
                    </motion.p>
                    <p className="text-base text-gray-700 font-semibold">{stat.label}</p>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Main Content Tabs */}
      <section className="relative max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <Tabs defaultValue="features" className="w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <TabsList className="grid w-full grid-cols-3 mb-12 h-auto bg-white/90 backdrop-blur shadow-xl rounded-2xl p-2">
              <TabsTrigger value="features" className="text-lg py-4 rounded-xl font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all">
                <FileText className="w-5 h-5 mr-2" />
                Features
              </TabsTrigger>
              <TabsTrigger value="benefits" className="text-lg py-4 rounded-xl font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-purple-700 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all">
                <Award className="w-5 h-5 mr-2" />
                Benefits
              </TabsTrigger>
              <TabsTrigger value="how-it-works" className="text-lg py-4 rounded-xl font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-600 data-[state=active]:to-green-700 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all">
                <Lightbulb className="w-5 h-5 mr-2" />
                How It Works
              </TabsTrigger>
            </TabsList>
          </motion.div>

          {/* Features Tab */}
          <TabsContent value="features" className="space-y-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <h2 className="text-5xl font-extrabold text-gray-900 mb-6">
                Everything You Need for Clinical Excellence
              </h2>
              <p className="text-2xl text-gray-600 max-w-3xl mx-auto">
                Comprehensive tools designed specifically for home health nurses
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0, duration: 0.5 }}
              >
                <motion.div whileHover={{ y: -8, scale: 1.02 }}>
                  <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-blue-700 opacity-0 group-hover:opacity-5 transition-opacity duration-300" />
                    <CardHeader>
                      <motion.div 
                        whileHover={{ rotate: 360 }}
                        transition={{ duration: 0.6 }}
                        className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
                      >
                        <Brain className="w-8 h-8 text-white" />
                      </motion.div>
                      <CardTitle className="text-2xl font-bold">AI Smart Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-700 mb-6 text-base leading-relaxed">
                        Transform rough notes into Medicare-compliant documentation in seconds. AI enhances clarity, completeness, and compliance.
                      </p>
                      <ul className="text-sm text-gray-700 space-y-3">
                        <li className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Real-time compliance checking</span>
                        </li>
                        <li className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Voice dictation support</span>
                        </li>
                        <li className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Automated quality scoring</span>
                        </li>
                      </ul>
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>

              <Card className="border-2 border-purple-200 hover:shadow-xl transition-shadow bg-white">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                    <Activity className="w-6 h-6 text-purple-600" />
                  </div>
                  <CardTitle className="text-xl">Patient Analytics</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">
                    AI-powered risk prediction and outcome tracking to identify patients who need extra attention.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Readmission risk scoring</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Fall prevention tracking</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Outcome trend analysis</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-2 border-green-200 hover:shadow-xl transition-shadow bg-white">
                <CardHeader>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                    <Target className="w-6 h-6 text-green-600" />
                  </div>
                  <CardTitle className="text-xl">Care Plan Management</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">
                    AI generates personalized care plans based on diagnosis, patient history, and best practices.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Auto-generated interventions</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Progress tracking</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Goal achievement analytics</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-2 border-orange-200 hover:shadow-xl transition-shadow bg-white">
                <CardHeader>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
                    <BookOpen className="w-6 h-6 text-orange-600" />
                  </div>
                  <CardTitle className="text-xl">Patient Education</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">
                    Generate personalized education materials tailored to each patient's conditions and learning needs.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Simplified explanations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Custom handouts</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Teach-back prompts</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-2 border-indigo-200 hover:shadow-xl transition-shadow bg-white">
                <CardHeader>
                  <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
                    <Shield className="w-6 h-6 text-indigo-600" />
                  </div>
                  <CardTitle className="text-xl">Compliance Monitoring</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">
                    Real-time Medicare compliance checking and proactive regulatory alerts keep you audit-ready.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Automated auditing</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Regulatory updates</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Quality scoring</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-2 border-pink-200 hover:shadow-xl transition-shadow bg-white">
                <CardHeader>
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-3">
                    <Stethoscope className="w-6 h-6 text-pink-600" />
                  </div>
                  <CardTitle className="text-xl">Clinical Decision Support</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">
                    AI analyzes patient data to provide evidence-based recommendations and early warning alerts.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Medication interaction alerts</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Deterioration prediction</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>Evidence-based guidance</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Benefits Tab */}
          <TabsContent value="benefits" className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Why Nurses Love CareMetric AI
              </h2>
              <p className="text-xl text-gray-600">
                Designed by nurses, for nurses
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <Clock className="w-10 h-10 text-blue-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Save Time</h3>
                  <p className="text-gray-600">
                    Reduce documentation time by up to 70%, giving you more time for patient care
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <Zap className="w-10 h-10 text-purple-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Reduce Stress</h3>
                  <p className="text-gray-600">
                    Eliminate compliance anxiety with automated checks and real-time guidance
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <TrendingUp className="w-10 h-10 text-green-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Improve Outcomes</h3>
                  <p className="text-gray-600">
                    Predictive analytics help prevent adverse events and readmissions
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <Heart className="w-10 h-10 text-red-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Better Patient Care</h3>
                  <p className="text-gray-600">
                    Personalized education and care plans improve patient engagement
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <BarChart3 className="w-10 h-10 text-indigo-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Data-Driven Insights</h3>
                  <p className="text-gray-600">
                    Track outcomes, identify trends, and continuously improve care quality
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6">
                  <Users className="w-10 h-10 text-orange-600 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Easy Collaboration</h3>
                  <p className="text-gray-600">
                    Seamless team coordination and comprehensive patient tracking
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* How It Works Tab */}
          <TabsContent value="how-it-works" className="space-y-6">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Simple, Powerful, Effective
              </h2>
              <p className="text-xl text-gray-600">
                Get started in minutes, master in days
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                    1
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Document Your Visit</h3>
                  <p className="text-gray-600">
                    Use voice dictation or type rough notes during or after your patient visit
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-purple-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                    2
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">AI Enhances & Validates</h3>
                  <p className="text-gray-600">
                    AI transforms your notes into compliant documentation and checks for quality
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 hover:shadow-xl transition-shadow bg-white">
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-green-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                    3
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Review & Submit</h3>
                  <p className="text-gray-600">
                    Quick review, make any adjustments, and submit with confidence
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* CTA Section */}
      <section className="max-w-5xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-purple-50">
          <CardContent className="p-12 text-center">
            <Sparkles className="w-16 h-16 text-purple-600 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Ready to Transform Your Documentation?
            </h2>
            <p className="text-xl text-gray-600 mb-6">
              Join nurses who are saving time, reducing stress, and improving patient outcomes
            </p>
            
            {/* Trial CTA Badge */}
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-6 py-3 rounded-full mb-6 border-2 border-green-300">
              <Clock className="w-5 h-5" />
              <span className="font-bold">14-Day Free Trial • No Credit Card Required</span>
            </div>
            
            <div>
              {currentUser ? (
                <Link to={createPageUrl("Dashboard")}>
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-12 py-6">
                      Go to Dashboard
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  onClick={() => base44.auth.redirectToLogin()}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-12 py-6">
                    Sign In to Start Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
              )}
              <p className="text-sm text-gray-500 mt-3">
                No commitment • Cancel anytime • Full access to all features
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                  alt="CareMetric AI Logo"
                  className="w-10 h-10 object-contain" />
                <span className="text-xl font-bold">CareMetric AI</span>
              </div>
              <p className="text-gray-400">
                Empowering home health nurses with AI-driven clinical intelligence
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-4">Quick Links</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <Link to={createPageUrl("Features")} className="hover:text-white transition-colors">
                    Features
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("Pricing")} className="hover:text-white transition-colors">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("About")} className="hover:text-white transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("Support")} className="hover:text-white transition-colors">
                    Support
                  </Link>
                </li>
                {currentUser &&
                <li>
                    <Link to={createPageUrl("Dashboard")} className="hover:text-white transition-colors">
                      Dashboard
                    </Link>
                  </li>
                }
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-4">Legal</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <Link to={createPageUrl("TermsOfUse")} className="hover:text-white transition-colors">
                    Terms of Use
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("PrivacyPolicy")} className="hover:text-white transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("EULA")} className="hover:text-white transition-colors">
                    EULA
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2025 CareMetric AI. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Prospect Chatbot */}
      <ProspectChatbot />
    </div>
  );
}