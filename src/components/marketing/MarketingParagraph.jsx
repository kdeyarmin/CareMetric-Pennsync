import React from "react";

/**
 * Marketing Paragraph - CareMetric AI
 * Use this compelling paragraph across marketing materials, presentations, and communications
 */

export const marketingParagraph = `CareMetric AI is the intelligent clinical documentation platform that transforms how home health nurses work. Our AI-powered system reduces documentation time by 70%—saving nurses 2-3 hours every day—while ensuring 99% Medicare compliance and significantly improving patient outcomes. With advanced features including voice-to-text dictation, real-time compliance checking, predictive risk analytics, and automated care plan generation, CareMetric AI eliminates the documentation burden that keeps nurses from doing what they do best: providing exceptional patient care. Join thousands of home health nurses who have reclaimed their time, reduced stress, and achieved a 30% reduction in patient hospitalizations through proactive, AI-driven clinical intelligence.`;

export const shortVersion = `CareMetric AI empowers home health nurses with AI-powered documentation that saves 2-3 hours daily, ensures 99% Medicare compliance, and improves patient outcomes through predictive analytics and intelligent clinical decision support.`;

export const elevatorPitch = `CareMetric AI: The AI assistant that gives home health nurses their time back. Transform rough notes into Medicare-compliant documentation in seconds, predict patient risks before they escalate, and spend 70% less time charting.`;

export default function MarketingParagraph() {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg">
      <div>
        <h3 className="text-lg font-semibold mb-2 text-gray-900">Full Marketing Paragraph</h3>
        <p className="text-gray-700 leading-relaxed">{marketingParagraph}</p>
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2 text-gray-900">Short Version</h3>
        <p className="text-gray-700 leading-relaxed">{shortVersion}</p>
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2 text-gray-900">Elevator Pitch</h3>
        <p className="text-gray-700 leading-relaxed">{elevatorPitch}</p>
      </div>
    </div>
  );
}