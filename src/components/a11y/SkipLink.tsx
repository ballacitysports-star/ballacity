/**
 * P3-5: "Skip to content" for keyboard and screen-reader users. It is the first
 * focusable element on every page, hidden until it receives focus, and moves focus
 * to the routed page past the staff bar and banners. The target is an empty,
 * focusable marker (`MainContentTarget`) placed directly before the page, so no
 * page layout changes.
 */
export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-lime"
      onClick={(e) => {
        // Move focus explicitly: a hash link alone does not focus the target in every
        // browser, and the router would otherwise treat it as a navigation.
        const target = document.getElementById(MAIN_CONTENT_ID);
        if (!target) return;
        e.preventDefault();
        target.focus();
        target.scrollIntoView({ block: "start" });
      }}
    >
      Skip to content
    </a>
  );
}

export function MainContentTarget() {
  return (
    <div id={MAIN_CONTENT_ID} tabIndex={-1} aria-label="Main content" className="outline-none" />
  );
}
