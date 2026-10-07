/**
 * Short two-tone chime for live host alerts (e.g. a player just submitted
 * payment proof). Best-effort: browsers block audio until the page has had a
 * user gesture, and some environments have no WebAudio at all — both are
 * silently ignored so callers never have to guard.
 */
let ctx: AudioContext | null = null;

export function playAttentionPing(): void {
  try {
    const g = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctx: typeof AudioContext | undefined = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    /* audio is a nicety — never let it break the UI */
  }
}
