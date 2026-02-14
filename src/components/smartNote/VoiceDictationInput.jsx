import React from "react";
import MobileVoiceRecorder from "@/components/mobile/MobileVoiceRecorder";

export default function VoiceDictationInput({ value, onChange, placeholder }) {

  const handleTranscription = (text) => {
    const newText = value ? `${value}\n\n${text}` : text;
    onChange({ target: { value: newText } });
  };

  return (
    <div className="space-y-3">
      <MobileVoiceRecorder
        onTranscriptionComplete={handleTranscription}
        compact={true}
      />
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full h-40 sm:h-48 p-3 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}