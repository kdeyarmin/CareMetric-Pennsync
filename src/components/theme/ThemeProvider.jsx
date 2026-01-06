import React, { createContext, useContext, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const ThemeContext = createContext({
  theme: "light",
  accentColor: "blue",
  setTheme: () => {},
  setAccentColor: () => {}
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const queryClient = useQueryClient();
  const [localTheme, setLocalTheme] = useState("light");
  const [localAccentColor, setLocalAccentColor] = useState("blue");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  useEffect(() => {
    if (currentUser?.theme_mode) {
      const theme = currentUser.theme_mode === 'system' 
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : currentUser.theme_mode;
      setLocalTheme(theme);
    }
    if (currentUser?.accent_color) {
      setLocalAccentColor(currentUser.accent_color);
    }
  }, [currentUser]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(localTheme);
    
    // Set accent color CSS variable
    root.setAttribute('data-accent', localAccentColor);
  }, [localTheme, localAccentColor]);

  const setTheme = async (newTheme) => {
    setLocalTheme(newTheme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : newTheme
    );
    
    if (currentUser) {
      try {
        await base44.auth.updateMe({ theme_mode: newTheme });
        queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      } catch (error) {
        console.error('Failed to save theme:', error);
      }
    }
  };

  const setAccentColor = async (color) => {
    setLocalAccentColor(color);
    
    if (currentUser) {
      try {
        await base44.auth.updateMe({ accent_color: color });
        queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      } catch (error) {
        console.error('Failed to save accent color:', error);
      }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme: localTheme, accentColor: localAccentColor, setTheme, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
}