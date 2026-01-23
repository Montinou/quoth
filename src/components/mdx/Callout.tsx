// src/components/mdx/Callout.tsx

import { Info, AlertTriangle, Lightbulb, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type CalloutType = 'info' | 'warning' | 'tip' | 'danger';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const styles: Record<CalloutType, { icon: typeof Info; bg: string; border: string; text: string }> = {
  info: {
    icon: Info,
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
  },
  tip: {
    icon: Lightbulb,
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
  },
  danger: {
    icon: AlertCircle,
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
  },
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const style = styles[type];
  const Icon = style.icon;

  return (
    <div className={cn(style.bg, style.border, 'border rounded-lg p-4 my-4')}>
      <div className="flex items-start gap-3">
        <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', style.text)} strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          {title && <p className={cn('font-semibold mb-1', style.text)}>{title}</p>}
          <div className="text-gray-400 text-sm [&>p]:mb-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
