import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'rect' | 'circle' | 'text';
}

/**
 * Animal-Island skeleton component
 * Features:
 * - Soft shimmer effect
 * - Subtle breath pulse
 * - Accessibility: respects prefers-reduced-motion
 */
export const Skeleton = ({ className = '', variant = 'rect' }: SkeletonProps) => {
  const baseStyles = 'relative overflow-hidden bg-black/5';
  const variantStyles = {
    rect: 'rounded-2xl',
    circle: 'rounded-full',
    text: 'rounded-lg h-4 w-full',
  };

  return (
    <div className={`${baseStyles} ${variantStyles[variant]} ${className} animate-soft-pulse`}>
      {/* Shimmer gradient overlay */}
      <div className="absolute inset-0 -translate-x-full animate-shimmer">
        <div className="h-full w-full bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      </div>
    </div>
  );
};

export const LibrarySkeleton = () => {
  return (
    <div className="space-y-10">
      {/* Header Skeleton */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-5 w-64 opacity-60" />
        </div>
        <Skeleton className="h-12 w-32 rounded-2xl" />
      </header>

      {/* Grid of Library Cards */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-24" />
          <div className="h-px flex-1 bg-black/5" />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="glass rounded-[32px] p-7 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton variant="circle" className="h-14 w-14" />
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-48 opacity-60" />
                  </div>
                </div>
                <Skeleton className="h-10 w-24 rounded-full" />
              </div>
              <div className="mt-8 flex gap-3">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-24" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Custom Groups Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-24" />
          <div className="h-px flex-1 bg-black/5" />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-[32px] p-6 shadow-sm">
              <div className="space-y-4">
                <Skeleton className="h-6 w-40" />
                <div className="flex justify-between items-center">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="pt-2">
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
