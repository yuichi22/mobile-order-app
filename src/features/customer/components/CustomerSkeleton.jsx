import React from 'react';

const SkeletonBlock = ({ className }) => (
  <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />
);

const CustomerSkeleton = () => (
  <div className="min-h-screen bg-white">
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-4">
      <div className="rounded-[2rem] bg-white px-5 py-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SkeletonBlock className="mb-2 h-5 w-28" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
          <SkeletonBlock className="h-12 w-12 rounded-2xl" />
        </div>
      </div>

      <div className="rounded-[2rem] bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
        <div className="flex gap-2 overflow-hidden">
          <SkeletonBlock className="h-10 w-20 rounded-full" />
          <SkeletonBlock className="h-10 w-24 rounded-full" />
          <SkeletonBlock className="h-10 w-20 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-[2rem] bg-white p-3 shadow-sm ring-1 ring-black/5">
            <SkeletonBlock className="mb-3 aspect-square w-full rounded-[1.5rem]" />
            <SkeletonBlock className="mb-2 h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default CustomerSkeleton;
