import { Bug } from "lucide-react";
import { useDebugMode } from "@/lib/debug-mode";

export function DebugModeToggle() {
  const [on, setOn] = useDebugMode();
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      title={on ? "Disable debug mode" : "Enable debug mode (highlight SSR vs client diffs)"}
      className={`fixed bottom-24 right-4 z-[100] grid h-10 w-10 place-items-center rounded-full border shadow-lg transition-colors ${
        on
          ? "border-coral bg-coral text-white"
          : "border-border bg-surface/90 text-muted-foreground backdrop-blur hover:text-foreground"
      }`}
      aria-pressed={on}
      aria-label="Toggle debug mode"
    >
      <Bug className="h-4 w-4" />
    </button>
  );
}
