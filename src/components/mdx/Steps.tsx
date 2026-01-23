// src/components/mdx/Steps.tsx

'use client';

import React from 'react';

interface StepsProps {
  children: React.ReactNode;
}

interface StepProps {
  title: string;
  children: React.ReactNode;
}

export function Steps({ children }: StepsProps) {
  const childArray = React.Children.toArray(children);

  return (
    <div className="my-6">
      {childArray.map((child, index) => {
        if (React.isValidElement<StepProps>(child)) {
          return React.cloneElement(child, {
            ...child.props,
            // @ts-expect-error - injecting step number
            _stepNumber: index + 1,
            _isLast: index === childArray.length - 1,
          });
        }
        return child;
      })}
    </div>
  );
}

interface StepInternalProps extends StepProps {
  _stepNumber?: number;
  _isLast?: boolean;
}

export function Step({ title, children, _stepNumber = 1, _isLast = false }: StepInternalProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-violet-spectral/20 border border-violet-spectral/30 flex items-center justify-center text-violet-ghost font-semibold text-sm shrink-0">
          {_stepNumber}
        </div>
        {!_isLast && <div className="w-px flex-1 bg-violet-spectral/20 mt-2" />}
      </div>
      <div className={`flex-1 ${_isLast ? '' : 'pb-6'}`}>
        <h4 className="font-semibold text-white mb-2">{title}</h4>
        <div className="text-gray-400 text-sm [&>p]:mb-2 [&>pre]:my-2">{children}</div>
      </div>
    </div>
  );
}
