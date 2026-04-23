"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  title?: string;
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = ToastInput & {
  id: number;
  tone: ToastTone;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmState = ConfirmOptions & {
  id: number;
};

type AppFeedbackContextValue = {
  notify: (input: ToastInput) => void;
  confirm: (input: ConfirmOptions) => Promise<boolean>;
};

const AppFeedbackContext = createContext<AppFeedbackContextValue | null>(null);

function toastToneStyles(tone: ToastTone) {
  if (tone === "success") {
    return {
      icon: CheckCircle2,
      container: "border-emerald-200/80 bg-emerald-50/95 text-emerald-950",
      iconWrap: "bg-emerald-100 text-emerald-700"
    };
  }

  if (tone === "error") {
    return {
      icon: AlertTriangle,
      container: "border-rose-200/80 bg-rose-50/95 text-rose-950",
      iconWrap: "bg-rose-100 text-rose-700"
    };
  }

  return {
    icon: Info,
    container: "border-slate-200/80 bg-white/95 text-slate-900",
    iconWrap: "bg-slate-100 text-slate-600"
  };
}

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const toastIdRef = useRef(0);
  const confirmIdRef = useRef(0);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = ++toastIdRef.current;
      const tone = input.tone ?? "info";
      const durationMs = input.durationMs ?? (tone === "error" ? 5600 : 3800);
      setToasts((current) => [...current, { ...input, id, tone }]);

      if (durationMs > 0) {
        window.setTimeout(() => {
          dismissToast(id);
        }, durationMs);
      }
    },
    [dismissToast]
  );

  const settleConfirm = useCallback((value: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    resolver?.(value);
  }, []);

  const confirm = useCallback(
    (input: ConfirmOptions) => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
      }

      const id = ++confirmIdRef.current;
      setConfirmState({
        id,
        confirmLabel: input.confirmLabel ?? "Confirm",
        cancelLabel: input.cancelLabel ?? "Cancel",
        tone: input.tone ?? "default",
        title: input.title,
        message: input.message
      });

      return new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
      });
    },
    []
  );

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!confirmState) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        settleConfirm(false);
      }
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmState, settleConfirm]);

  useEffect(() => {
    return () => {
      confirmResolverRef.current?.(false);
    };
  }, []);

  const contextValue = useMemo<AppFeedbackContextValue>(
    () => ({
      notify,
      confirm
    }),
    [confirm, notify]
  );

  return (
    <AppFeedbackContext.Provider value={contextValue}>
      {children}
      {portalReady
        ? createPortal(
            <>
              <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[130] flex justify-end px-4 pb-4">
                <div aria-live="polite" className="flex w-full max-w-md flex-col gap-3">
                  {toasts.map((toast) => {
                    const toneStyles = toastToneStyles(toast.tone);
                    const Icon = toneStyles.icon;

                    return (
                      <div
                        key={toast.id}
                        className={`pointer-events-auto rounded-[1.6rem] border px-4 py-4 shadow-2xl backdrop-blur ${toneStyles.container}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${toneStyles.iconWrap}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            {toast.title ? <div className="text-sm font-semibold">{toast.title}</div> : null}
                            <div className={`text-sm ${toast.title ? "mt-1" : ""}`}>{toast.message}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismissToast(toast.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-current/55 transition hover:bg-black/5 hover:text-current"
                            aria-label="Dismiss notification"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {confirmState ? (
                <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={`confirm-dialog-title-${confirmState.id}`}
                    className="app-panel w-full max-w-lg rounded-[2rem] border p-6 shadow-2xl"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                          confirmState.tone === "danger"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-[rgba(var(--app-primary-rgb),0.06)] text-[rgba(var(--app-primary-rgb),0.72)]"
                        }`}
                      >
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 id={`confirm-dialog-title-${confirmState.id}`} className="text-xl font-semibold text-ink">
                          {confirmState.title}
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-[rgba(var(--app-primary-rgb),0.68)]">
                          {confirmState.message}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => settleConfirm(false)}
                        className="app-glass-button app-focus-button rounded-2xl px-4 py-2.5 text-sm font-semibold text-[rgba(var(--app-primary-rgb),0.72)] transition hover:brightness-105"
                      >
                        {confirmState.cancelLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => settleConfirm(true)}
                        className={`app-focus-button rounded-2xl px-4 py-2.5 text-sm font-semibold text-white transition ${
                          confirmState.tone === "danger"
                            ? "bg-rose-600 hover:bg-rose-700"
                            : "app-primary-button hover:brightness-105"
                        }`}
                      >
                        {confirmState.confirmLabel}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </AppFeedbackContext.Provider>
  );
}

export function useAppFeedback() {
  const context = useContext(AppFeedbackContext);

  if (!context) {
    throw new Error("useAppFeedback must be used inside AppFeedbackProvider");
  }

  return context;
}
