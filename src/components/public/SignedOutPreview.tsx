import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SampleImage } from "@/components/public/SampleImage";
import { PREVIEW_CONFIGS, type PreviewRow, type PreviewTab } from "@/lib/preview-samples";

/**
 * What a signed-out visitor sees on a tab: the page's usual layout, filled with
 * invented sample content.
 *
 * Everything shown comes from `preview-samples`, which holds no real data. The
 * signed-in page is never mounted for a signed-out visitor (see PreviewGate), so
 * no member query runs and no member data is sent. The buttons are drawn but
 * inert: the way in is the sign-up prompt.
 */
export function SignedOutPreview({ tab, next }: { tab: PreviewTab; next: string }) {
  const config = PREVIEW_CONFIGS[tab];
  const rows = config.rows ?? [];

  return (
    <div data-testid="signed-out-preview" className="page-shell space-y-5 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{config.title}</h1>
          <p className="page-subtitle mt-1">{config.subtitle}</p>
        </div>
        {config.headerAction ? <FakeButton>{config.headerAction}</FakeButton> : null}
      </div>

      <p
        role="note"
        className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground"
      >
        <strong className="font-semibold text-foreground">Sample preview.</strong> These are
        examples, not real listings or people.{" "}
        <Link to="/auth" search={{ next }} className="font-semibold text-lime underline">
          Sign in
        </Link>{" "}
        to see the real thing.
      </p>

      <SignUpPrompt label={config.cta} next={next} />

      {config.fields ? (
        <div className="space-y-3">
          {config.fields.map((field) => (
            <div key={field}>
              <p className="mb-1 text-sm font-medium text-foreground">{field}</p>
              <div
                inert
                className="h-11 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-muted-foreground"
              >
                Sample value
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <PreviewListRow
              key={row.title}
              row={row}
              action={config.rowAction}
              avatar={config.showAvatars !== false}
            />
          ))}
        </ul>
      ) : null}

      {config.locked ? (
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">{config.locked.title}</h2>
          <div className="space-y-2 rounded-2xl border border-border bg-surface p-4 text-sm text-foreground">
            {config.locked.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A button as the real page draws it, but not clickable. */
function FakeButton({ children }: { children: ReactNode }) {
  return (
    <span
      inert
      className="pointer-events-none inline-flex shrink-0 select-none items-center rounded-full bg-lime-gradient px-4 py-1.5 text-sm font-bold text-primary-foreground"
    >
      {children}
    </span>
  );
}

/**
 * Sample rows for a real page that has nothing to show a signed-out visitor yet
 * (no public gyms, no public highlights). Labelled as samples, like the tab previews.
 */
export function SampleRows({
  rows,
  action,
  heading,
}: {
  rows: PreviewRow[];
  action?: string;
  heading: string;
}) {
  return (
    <section aria-label={heading} className="space-y-3">
      <p
        role="note"
        className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground"
      >
        <strong className="font-semibold text-foreground">{heading}.</strong> These are examples,
        not real listings or people. Dates and times are invented.
      </p>
      <ul className="space-y-3">
        {rows.map((row) => (
          <PreviewListRow key={row.title} row={row} action={action} avatar />
        ))}
      </ul>
    </section>
  );
}

function PreviewListRow({
  row,
  action,
  avatar,
}: {
  row: PreviewRow;
  action?: string;
  avatar: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      {avatar ? (
        row.sport ? (
          <SampleImage sport={row.sport} className="h-14 w-14 shrink-0 rounded-xl" />
        ) : (
          <span className="h-11 w-11 shrink-0 rounded-full bg-secondary" />
        )
      ) : null}
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate font-semibold text-foreground">{row.title}</p>
        <p className="text-sm text-muted-foreground">{row.detail}</p>
        {row.person ? <p className="truncate text-xs text-muted-foreground">{row.person}</p> : null}
        {row.chips && row.chips.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {row.chips.map((chip) => (
              <li
                key={chip}
                className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {chip}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {action ? (
        <span className="ml-auto">
          <FakeButton>{action}</FakeButton>
        </span>
      ) : null}
    </li>
  );
}

function SignUpPrompt({ label, next }: { label: string; next: string }) {
  return (
    <div className="rounded-2xl border border-lime/40 bg-surface p-4 text-center">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <Link
        to="/auth"
        search={{ next, mode: "signup" }}
        className="mt-3 flex w-full items-center justify-center rounded-2xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground glow-lime"
      >
        Create account
      </Link>
      <p className="mt-2 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/auth" search={{ next }} className="font-semibold text-lime underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
