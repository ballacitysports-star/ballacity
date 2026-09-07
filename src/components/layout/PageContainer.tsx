import { cn } from "@/lib/utils";
import { PAGE_PADDING_TOP, pageShellUtility, type PageWidth } from "@/lib/page-shell";

/**
 * The app's one page wrapper.
 *
 * A thin ergonomic wrapper over the `page-shell*` utilities in styles.css, not
 * a second container system: the geometry lives in CSS, so the routes that
 * write `page-shell` directly and the routes that use this component stay in
 * step. Either is fine — a plain `className="page-shell-content"` is perfectly
 * good in a route already hand-rolling its markup.
 */
export type PageContainerProps = {
  children: React.ReactNode;
  width?: PageWidth;
  /** Drop the built-in top padding for a page that opens with its own hero. */
  flush?: boolean;
  className?: string;
  as?: "div" | "main" | "section" | "article";
};

export function PageContainer({
  children,
  width = "content",
  flush = false,
  className,
  as: Tag = "div",
}: PageContainerProps) {
  return (
    <Tag className={cn(pageShellUtility(width), !flush && PAGE_PADDING_TOP, className)}>
      {children}
    </Tag>
  );
}
