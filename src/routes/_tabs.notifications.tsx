import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Logo } from "@/components/Logo";
import { Zap, Users, MessageCircle, Trophy } from "lucide-react";

export const Route = createFileRoute("/_tabs/notifications")({
  head: () => ({ meta: [{ title: "Alerts — OpenRun" }] }),
  component: Notifications,
});

const notifs = [
  { icon: Zap, color: "coral", title: "Friday Night Run needs 2 more", time: "12 min ago", desc: "Marcus is hosting at Tompkins Square. Tap to claim a spot." },
  { icon: Users, color: "lime", title: "Ana invited you to Sunday Sunset 7v7", time: "1 hr ago", desc: "Pier 40 Turf · 22 spots filling fast." },
  { icon: MessageCircle, color: "lime", title: "New chat in Pickleball Round Robin", time: "2 hr ago", desc: "Devon: \"Bringing 4 paddles, see you at 6!\"" },
  { icon: Trophy, color: "coral", title: "You unlocked: On a 9-game streak 🔥", time: "Yesterday", desc: "Keep showing up. One more for the next tier." },
  { icon: Users, color: "lime", title: "Riley followed you", time: "Yesterday", desc: "@riley plays the same court as you." },
];

function Notifications() {
  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <button className="text-xs font-semibold text-muted-foreground">Mark all read</button>
      </div>
      <h1 className="font-display text-3xl font-bold leading-tight mb-1">Alerts</h1>
      <p className="text-muted-foreground text-sm mb-5">Real-time updates from your games & crew.</p>

      <div className="space-y-2">
        {notifs.map((n, i) => {
          const Icon = n.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${n.color === "lime" ? "bg-lime/15 text-lime" : "bg-coral/15 text-coral"}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm leading-tight">{n.title}</h3>
                  <span className="text-[10px] text-muted-foreground shrink-0">{n.time}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.desc}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
