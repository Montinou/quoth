'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect when React hydration is complete.
 * Prevents hydration mismatch between server and client rendering.
 *
 * Usage:
 * const hydrated = useHydrated();
 * if (!hydrated) return <Skeleton />;
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
