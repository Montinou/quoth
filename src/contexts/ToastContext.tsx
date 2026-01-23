// src/contexts/ToastContext.tsx
"use client";

import * as React from "react";
import { createContext, useContext, useState, useCallback } from "react";
import { Toast, ToastContainer, ToastType } from "@/components/ui/toast";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration: number;
}

interface ToastContextType {
  toast: (options: {
    type?: ToastType;
    message: string;
    description?: string;
    duration?: number;
  }) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const toast = useCallback(
    ({
      type = "info",
      message,
      description,
      duration = DEFAULT_DURATION,
    }: {
      type?: ToastType;
      message: string;
      description?: string;
      duration?: number;
    }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      setToasts((prev) => [...prev, { id, type, message, description, duration }]);

      // Auto dismiss
      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const success = useCallback(
    (message: string, description?: string) => {
      toast({ type: "success", message, description });
    },
    [toast]
  );

  const error = useCallback(
    (message: string, description?: string) => {
      toast({ type: "error", message, description, duration: 6000 });
    },
    [toast]
  );

  const warning = useCallback(
    (message: string, description?: string) => {
      toast({ type: "warning", message, description });
    },
    [toast]
  );

  const info = useCallback(
    (message: string, description?: string) => {
      toast({ type: "info", message, description });
    },
    [toast]
  );

  return (
    <ToastContext.Provider
      value={{ toast, success, error, warning, info, dismiss, dismissAll }}
    >
      {children}
      <ToastContainer>
        {toasts.map((t) => (
          <Toast
            key={t.id}
            id={t.id}
            type={t.type}
            message={t.message}
            description={t.description}
            duration={t.duration}
            onClose={dismiss}
          />
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
