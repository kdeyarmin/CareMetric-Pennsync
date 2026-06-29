import { useState, useCallback } from 'react';

export const useNoteManagement = () => {
  const [roughNote, setRoughNote] = useState("");
  const [enhancedNote, setEnhancedNote] = useState("");
  const [analysisResults, setAnalysisResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);
  const [recheckMode, setRecheckMode] = useState(false);

  const resetNote = useCallback(() => {
    setRoughNote("");
    setEnhancedNote("");
    setAnalysisResults(null);
    setCopied(false);
    setSavedSuccessfully(false);
    setRecheckMode(false);
  }, []);

  const startRecheck = useCallback(() => {
    setRoughNote(enhancedNote);
    setEnhancedNote("");
    setAnalysisResults(null);
    setRecheckMode(true);
  }, [enhancedNote]);

  const completeEnhancement = useCallback((finalNote, analysis) => {
    setEnhancedNote(finalNote);
    setAnalysisResults(analysis);
    setRecheckMode(false);
  }, []);

  return {
    roughNote, setRoughNote, enhancedNote, setEnhancedNote,
    analysisResults, setAnalysisResults, copied, setCopied,
    savedSuccessfully, setSavedSuccessfully, recheckMode, setRecheckMode,
    resetNote, startRecheck, completeEnhancement
  };
};