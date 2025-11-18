import React from 'react';

// Runs the effect after a short debounce to avoid excessive firing on rapid changes. 
export function useDebouncedEffect(effect: () => void, deps: any[], delay = 200) {
  React.useEffect(() => {
    const t = setTimeout(effect, delay);
    return () => clearTimeout(t);
  }, deps);
}