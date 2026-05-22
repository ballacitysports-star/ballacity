import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      <motion.div
        initial={{ rotate: -8, scale: 0.9 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        className="relative grid place-items-center rounded-xl bg-lime-gradient text-primary-foreground font-display font-bold glow-lime"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        O
        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-coral animate-pulse" />
      </motion.div>
      <span className="font-display font-bold text-lg tracking-tight">
        Open<span className="text-lime">Run</span>
      </span>
    </Link>
  );
}
