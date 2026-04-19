import { useEffect, useState } from 'react';

/**
 * Hook to handle deferred loading states.
 * Prevents flickering by waiting for a specified delay (default 300ms) 
 * before showing a loading UI.
 */
export function useDeferredLoading(isLoading: boolean, delayMs: number = 300) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (isLoading) {
      timer = setTimeout(() => {
        setShouldShow(true);
      }, delayMs);
    } else {
      setShouldShow(false);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, delayMs]);

  return shouldShow;
}
