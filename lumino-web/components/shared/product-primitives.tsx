"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const productFieldClassName =
  "app-glass-input app-focus-ring w-full rounded-2xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink";
export const productTextAreaClassName = `${productFieldClassName} min-h-24`;
export const productFileInputClassName =
  "app-focus-ring w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[rgba(var(--app-primary-rgb),0.08)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-[rgba(var(--app-primary-rgb),0.12)]";
export const productFieldLabelClassName =
  "text-xs font-semibold uppercase tracking-[0.12em] text-slate-500";

export function ProductHero({
  eyebrow,
  title,
  description,
  actions,
  children,
  className
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("app-panel rounded-[2rem] border p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{eyebrow}</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

export function ProductStatGrid({
  items,
  columns = "md:grid-cols-3"
}: {
  items: Array<{
    label: string;
    value: React.ReactNode;
    detail: string;
    icon?: LucideIcon;
    accentClassName?: string;
  }>;
  columns?: string;
}) {
  return (
    <div className={clsx("grid gap-3", columns)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="app-panel-soft rounded-[1.8rem] border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              {Icon ? (
                <div className={clsx("app-glass-button rounded-2xl p-3 text-[rgba(var(--app-primary-rgb),0.58)]", item.accentClassName)}>
                  <Icon className="h-4 w-4" />
                </div>
              ) : null}
            </div>
            <div className="mt-3 text-3xl font-semibold text-ink">{item.value}</div>
            <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("app-panel rounded-[2rem] border p-5", className)}>
      {eyebrow || title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">{eyebrow}</div> : null}
            {title ? <div className="mt-2 text-xl font-semibold text-ink">{title}</div> : null}
            {description ? <div className="mt-2 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.68)]">{description}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={clsx(eyebrow || title || description || actions ? "mt-5" : "")}>{children}</div>
    </section>
  );
}

export function ProductFilterBar({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={clsx("app-panel-soft rounded-3xl border p-3", className)}>{children}</div>;
}

export function ProductNotice({
  tone,
  title,
  message,
  className
}: {
  tone: "success" | "error" | "info";
  title?: string;
  message: string;
  className?: string;
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={clsx("rounded-2xl border px-4 py-3 text-sm", toneClassName, className)}>
      {title ? <div className="font-semibold">{title}</div> : null}
      <div className={title ? "mt-1" : ""}>{message}</div>
    </div>
  );
}

export function ProductEmptyState({
  title,
  description,
  className
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={clsx("app-panel-soft rounded-[1.6rem] border p-8 text-center", className)}>
      <div className="text-lg font-semibold text-ink">{title}</div>
      <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">{description}</p>
    </div>
  );
}
