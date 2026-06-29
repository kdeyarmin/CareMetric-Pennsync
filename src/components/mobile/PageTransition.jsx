import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Slide-in page transition wrapper for route changes
 * Applies a smooth slide-in animation when the page/location changes
 */
export default function PageTransition({ children }) {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(true);
  const [key, setKey] = useState(location.pathname);

  useEffect(() => {
    // Reset animation on route change
    setIsVisible(false);
    setKey(location.pathname);
    
    // Trigger animation after brief delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div
      key={key}
      className={`transition-all duration-300 ease-out ${
        isVisible
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 translate-x-full'
      }`}
    >
      {children}
    </div>
  );
}