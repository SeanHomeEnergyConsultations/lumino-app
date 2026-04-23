"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ComponentType, ReactNode } from "react";

export function WorkspaceHero({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">{eyebrow}</div>
          <h1 className="mt-3 text-3xl font-semibold text-ink">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}

export function WorkspaceSwitcher<TSurface extends string>({
  title,
  description,
  activeSurface,
  items
}: {
  title: string;
  description: string;
  activeSurface: TSurface;
  items: Array<{
    id: TSurface;
    label: string;
    detail: string;
    href: Route;
    icon?: ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <section className="app-panel rounded-[2rem] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</div>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const active = activeSurface === item.id;
            const Icon = item.icon;

            return (
              <Link
                key={item.id}
                href={item.href}
                className={`rounded-[1.4rem] border px-4 py-3 text-left transition ${
                  active
                    ? "bg-[rgba(var(--app-primary-rgb),0.92)] text-white shadow-panel"
                    : "bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {Icon ? <Icon className="h-4 w-4" /> : null}
                  {item.label}
                </div>
                <div className={`mt-1 text-xs ${active ? "text-white/75" : "text-slate-500"}`}>{item.detail}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function WorkspaceMetricGrid({
  items
}: {
  items: Array<{
    label: string;
    value: string | number;
    detail: string;
    tone?: "soft" | "glass";
  }>;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={
            item.tone === "soft"
              ? "app-panel-soft rounded-[1.8rem] border p-4"
              : "rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 text-left shadow-panel backdrop-blur"
          }
        >
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
          <div className="mt-3 text-3xl font-semibold text-ink">{item.value}</div>
          <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
        </div>
      ))}
    </section>
  );
}
