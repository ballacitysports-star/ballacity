import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, ArrowRight, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { reverseGeocode } from "@/lib/geocode.functions";
import { SPORTS, type Sport } from "@/lib/sample-data";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Welcome — OpenRun" }] }),
  component: OnboardingPage,
});

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Pro"] as const;
type SkillLevel = (typeof SKILL_LEVELS)[number];

function OnboardingPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [skillLevels, setSkillLevels] = useState<Record<string, SkillLevel>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reverse = useServerFn(reverseGeocode);


  // Bounce out if unauthenticated or already onboarded
  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/auth", replace: true });
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.username) nav({ to: "/profile", replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, nav]);

  // Debounced username availability check
  useEffect(() => {
    const raw = username.trim().toLowerCase().replace(/^@/, "");
    if (!USERNAME_RE.test(raw)) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", raw)
        .neq("id", user?.id ?? "")
        .maybeSingle();
      setChecking(false);
      if (error) {
        setAvailable(null);
        return;
      }
      setAvailable(!data);
    }, 350);
    return () => clearTimeout(t);
  }, [username, user?.id]);

  const cleanUsername = username.trim().toLowerCase().replace(/^@/, "");
  const usernameValid = USERNAME_RE.test(cleanUsername) && available === true;

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 384);
      setAvatarDataUrl(dataUrl);
    } catch {
      toast.error("Couldn't load that image");
    }
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation isn't available on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { city: c, formatted } = await reverse({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          setCity(c || formatted || null);
        } catch {
          toast.error("Couldn't resolve your location");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === 1
            ? "Location permission denied. You can set it later in your profile."
            : "Couldn't get your location",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const finish = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: cleanUsername,
          avatar_url: avatarDataUrl,
          city: city ?? null,
          skill_levels: skillLevels,
        })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("You're all set!");
      nav({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save profile");
    } finally {
      setBusy(false);
    }
  };


  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md min-h-screen flex flex-col px-5 pt-10 pb-16">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        <div className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-lime" : "bg-border"}`} />
        <div className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-lime" : "bg-border"}`} />
        <div className={`h-1 flex-1 rounded-full ${step >= 3 ? "bg-lime" : "bg-border"}`} />
        <div className={`h-1 flex-1 rounded-full ${step >= 4 ? "bg-lime" : "bg-border"}`} />
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Pick a username</h1>
            <p className="text-sm text-muted-foreground mt-2">
              This is how other players will find you. 3–20 characters, letters, numbers, and underscores.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-lime">
              <span className="text-muted-foreground text-sm mr-1">@</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {cleanUsername && USERNAME_RE.test(cleanUsername) && (
                <span className="ml-2">
                  {checking ? (
                    <span className="h-4 w-4 block animate-spin rounded-full border-2 border-muted border-t-foreground" />
                  ) : available === true ? (
                    <Check className="h-4 w-4 text-lime" />
                  ) : available === false ? (
                    <span className="text-xs text-red-400">taken</span>
                  ) : null}
                </span>
              )}
            </div>
            {cleanUsername && !USERNAME_RE.test(cleanUsername) && (
              <p className="text-xs text-red-400">
                Use 3–20 lowercase letters, numbers, or underscores.
              </p>
            )}
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!usernameValid}
            className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Add a profile photo</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Help teammates recognize you on the court. You can skip and add one later.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 py-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative h-32 w-32 rounded-full border-2 border-dashed border-border bg-surface overflow-hidden grid place-items-center"
              aria-label="Choose profile photo"
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-8 w-8 text-muted-foreground" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-sm font-medium text-lime underline"
            >
              {avatarDataUrl ? "Change photo" : "Upload photo"}
            </button>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setStep(3)}
              className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground flex items-center justify-center gap-2"
            >
              {avatarDataUrl ? "Continue" : "Skip for now"} <ArrowRight className="h-4 w-4" />
            </button>
            {avatarDataUrl && (
              <button
                onClick={() => setAvatarDataUrl(null)}
                className="w-full text-center text-xs text-muted-foreground py-2"
              >
                Remove photo
              </button>
            )}
            <button
              onClick={() => setStep(1)}
              className="w-full text-center text-xs text-muted-foreground py-1"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Find games nearby</h1>
            <p className="text-sm text-muted-foreground mt-2">
              OpenRun uses your location to show pickup games happening near you.
              We never share your precise location with other players.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 py-6">
            <div className="h-24 w-24 rounded-full bg-lime/10 grid place-items-center">
              <MapPin className="h-10 w-10 text-lime" />
            </div>
            {city ? (
              <div className="text-center">
                <div className="text-xs text-muted-foreground">You're near</div>
                <div className="font-display text-lg font-bold flex items-center gap-1 justify-center">
                  <Check className="h-4 w-4 text-lime" /> {city}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Tap "Allow location" and confirm the browser prompt.
              </p>
            )}
          </div>

          <div className="space-y-2">
            {!city ? (
              <button
                onClick={requestLocation}
                disabled={locating}
                className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {locating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Finding you…
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" /> Allow location
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={finish}
                disabled={busy}
                className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Saving…" : "Finish"}
              </button>
            )}
            <button
              onClick={finish}
              disabled={busy}
              className="w-full text-center text-xs text-muted-foreground py-2"
            >
              {city ? "Use a different location later" : "Skip for now"}
            </button>
            <button
              onClick={() => setStep(2)}
              className="w-full text-center text-xs text-muted-foreground py-1"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function resizeImageToDataUrl(file: File, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}
