import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * YouTube settings list geometry: a small section heading, then flat
 * full-width rows on the page background separated by hairline dividers.
 */
export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="px-4 pb-1 pt-4 section-eyebrow text-muted-foreground">{title}</h2>}
      <div className="divide-y divide-border border-y border-border">{children}</div>
    </section>
  );
}

const ROW = "flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors";

function RowBody({
  icon: Icon,
  label,
  description,
  destructive,
  trailing,
}: {
  icon?: LucideIcon;
  label: React.ReactNode;
  description?: React.ReactNode;
  destructive?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      {Icon && (
        <Icon
          className={`h-5 w-5 shrink-0 ${destructive ? "text-destructive" : "text-muted-foreground"}`}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${destructive ? "text-destructive" : "text-foreground"}`}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      {trailing}
    </>
  );
}

/** Navigating row with a chevron. */
export function SettingsLinkRow({
  to,
  search,
  icon,
  label,
  description,
  trailing,
}: {
  to: string;
  search?: Record<string, unknown>;
  icon?: LucideIcon;
  label: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      {...(search ? { search: search as never } : {})}
      className={`${ROW} hover:bg-surface active:bg-surface-2`}
    >
      <RowBody
        icon={icon}
        label={label}
        description={description}
        trailing={
          trailing ?? (
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          )
        }
      />
    </Link>
  );
}

/** Button row — used for sign out, delete, and inline actions. */
export function SettingsButtonRow({
  icon,
  label,
  description,
  destructive,
  trailing,
  onClick,
  disabled,
}: {
  icon?: LucideIcon;
  label: React.ReactNode;
  description?: React.ReactNode;
  destructive?: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${ROW} hover:bg-surface active:bg-surface-2 disabled:opacity-60`}
    >
      <RowBody
        icon={icon}
        label={label}
        description={description}
        destructive={destructive}
        trailing={trailing}
      />
    </button>
  );
}

/** Static row hosting its own control (switch, segmented buttons, text). */
export function SettingsStaticRow({
  icon,
  label,
  description,
  trailing,
  children,
}: {
  icon?: LucideIcon;
  label?: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  if (!label) return <div className="px-4 py-3.5">{children}</div>;
  return (
    <div className={ROW}>
      <RowBody icon={icon} label={label} description={description} trailing={trailing} />
    </div>
  );
}
