import { Link } from "@tanstack/react-router";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      <div
        className="enter-pop relative grid place-items-center rounded-xl bg-lime-gradient text-primary-foreground font-display font-bold glow-lime"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
b
        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-coral animate-pulse" />
      </div>
      <span className="font-display font-bold text-lg tracking-tight">
        balla<span className="text-lime">City</span>
      </span>
    </Link>
  );
}
