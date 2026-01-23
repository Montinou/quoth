// src/components/ui/toast.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  onClose: (id: string) => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const styleMap = {
  success: {
    border: "border-emerald-500/30",
    icon: "text-emerald-400",
    glow: "shadow-emerald-500/10",
  },
  error: {
    border: "border-red-500/30",
    icon: "text-red-400",
    glow: "shadow-red-500/10",
  },
  warning: {
    border: "border-amber-500/30",
    icon: "text-amber-400",
    glow: "shadow-amber-500/10",
  },
  info: {
    border: "border-violet-spectral/30",
    icon: "text-violet-ghost",
    glow: "shadow-violet-spectral/10",
  },
};

export function Toast({ id, type, message, description, onClose }: ToastProps) {
  const Icon = iconMap[type];
  const styles = styleMap[type];

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 w-full max-w-sm p-4",
        "bg-charcoal/95 backdrop-blur-xl border rounded-lg",
        "shadow-lg animate-slide-up",
        styles.border,
        styles.glow
      )}
      role="alert"
    >
      {/* Icon */}
      <div className={cn("shrink-0 mt-0.5", styles.icon)}>
        <Icon className="w-5 h-5" strokeWidth={1.5} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{message}</p>
        {description && (
          <p className="mt-1 text-xs text-gray-400 line-clamp-2">{description}</p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={() => onClose(id)}
        className={cn(
          "shrink-0 p-1 rounded-md",
          "text-gray-500 hover:text-white",
          "hover:bg-white/10 transition-all duration-200",
          "opacity-0 group-hover:opacity-100 focus:opacity-100"
        )}
        aria-label="Close notification"
      >
        <X className="w-4 h-4" strokeWidth={1.5} />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5 rounded-b-lg overflow-hidden">
        <div
          className={cn(
            "h-full animate-toast-progress",
            type === "success" && "bg-emerald-500/50",
            type === "error" && "bg-red-500/50",
            type === "warning" && "bg-amber-500/50",
            type === "info" && "bg-violet-spectral/50"
          )}
        />
      </div>
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-[100]",
        "flex flex-col gap-2",
        "pointer-events-none [&>*]:pointer-events-auto"
      )}
      aria-live="polite"
      aria-label="Notifications"
    >
      {children}
    </div>
  );
}
