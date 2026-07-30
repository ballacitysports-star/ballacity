/**
 * Facebook-style crop overlay: dimmed surround, thin frame, corner ticks and a
 * rule-of-thirds grid that only appears while the user is dragging/pinching.
 */
export function CropOverlay({
  width,
  height,
  shape = "rect",
  showGrid = false,
}: {
  width: number;
  height: number;
  shape?: "square" | "rect" | "circle";
  showGrid?: boolean;
}) {
  const circle = shape === "circle";
  const radius = circle ? "9999px" : "12px";

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width,
          height,
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
          borderRadius: radius,
          border: "1.5px solid rgba(255,255,255,0.92)",
        }}
      >
        {/* Rule-of-thirds grid */}
        <div
          className="absolute inset-0 overflow-hidden transition-opacity duration-200"
          style={{ borderRadius: radius, opacity: showGrid ? 1 : 0 }}
        >
          {[1, 2].map((i) => (
            <div
              key={`v${i}`}
              className="absolute top-0 bottom-0 w-px bg-white/40"
              style={{ left: `${(i * 100) / 3}%` }}
            />
          ))}
          {[1, 2].map((i) => (
            <div
              key={`h${i}`}
              className="absolute left-0 right-0 h-px bg-white/40"
              style={{ top: `${(i * 100) / 3}%` }}
            />
          ))}
        </div>

        {/* Corner ticks (skipped for circular crops) */}
        {!circle &&
          (
            [
              ["top-0 left-0", "border-t-2 border-l-2 rounded-tl-[12px]"],
              ["top-0 right-0", "border-t-2 border-r-2 rounded-tr-[12px]"],
              ["bottom-0 left-0", "border-b-2 border-l-2 rounded-bl-[12px]"],
              ["bottom-0 right-0", "border-b-2 border-r-2 rounded-br-[12px]"],
            ] as const
          ).map(([pos, edges]) => (
            <span key={pos} className={`absolute h-6 w-6 border-white ${pos} ${edges}`} />
          ))}
      </div>
    </div>
  );
}
