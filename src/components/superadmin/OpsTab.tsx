import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  superadminListSettings,
  superadminSetSetting,
  superadminBroadcast,
  superadminListQueues,
} from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmAction } from "./ConfirmAction";
import { sendTestPushToSelf } from "@/lib/push.functions";

/**
 * Settings that have a dedicated editor elsewhere.
 *
 * They are hidden from the raw JSON editor below because two editors over one
 * row means the stale one wins: this list renders as a pointer instead. Every
 * other key keeps the raw editor, which is the escape hatch when a structured
 * UI cannot express something.
 */
const STRUCTURED_KEYS = new Set(["monetization"]);

const STRUCTURED_KEYS_PRESENT = (rows: { key: string }[]) =>
  rows.map((r) => r.key).filter((k) => STRUCTURED_KEYS.has(k));

export function OpsTab() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(superadminListSettings);
  const setSetting = useServerFn(superadminSetSetting);
  const broadcast = useServerFn(superadminBroadcast);
  const loadQueues = useServerFn(superadminListQueues);

  const settings = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => loadSettings({}),
  });
  const queues = useQuery({ queryKey: ["superadmin-queues"], queryFn: () => loadQueues({}) });

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPublic, setNewPublic] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [audience, setAudience] = useState<"all" | "player" | "team" | "trainer" | "gym">("all");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);

  const save = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const send = useMutation({
    mutationFn: (reason: string) =>
      broadcast({
        data: {
          title: title.trim(),
          body: body.trim() || undefined,
          link: link.trim() || undefined,
          audience,
          reason,
        },
      }),
    onSuccess: (r: any) => {
      toast.success(`Announcement sent to ${r.sent} accounts`);
      setConfirmBroadcast(false);
      setTitle("");
      setBody("");
      setLink("");
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Feature flags & settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            (settings.data?.settings ?? [])
              .filter((s: { key: string }) => !STRUCTURED_KEYS.has(s.key))
              .map((s: any) => (
                <SettingRow
                  // Keyed on the value as well as the key so the row re-seeds
                  // its draft after a refetch. Without this, editing the same
                  // row in a structured panel leaves a stale JSON draft here
                  // that silently overwrites those changes on Save.
                  key={`${s.key}:${JSON.stringify(s.value)}`}
                  setting={s}
                  pending={save.isPending}
                  onSave={(value, isPublic) =>
                    save.mutate(() => setSetting({ data: { key: s.key, value, isPublic } }))
                  }
                />
              ))
          )}

          {STRUCTURED_KEYS_PRESENT(settings.data?.settings ?? []).map((key) => (
            <div
              key={key}
              className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
            >
              <span className="font-mono">{key}</span> is edited on the{" "}
              <span className="font-medium">Monetization</span> tab, which understands its shape.
              Editing it as raw JSON here would be easy to get wrong.
            </div>
          ))}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium">Add setting</div>
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key_name"
            />
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder='value (JSON, e.g. true or "text")'
            />
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="description"
            />
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={newPublic} onCheckedChange={setNewPublic} />
              Readable by the app (public)
            </label>
            <Button
              size="sm"
              disabled={!newKey.trim() || save.isPending}
              onClick={() =>
                save.mutate(() =>
                  setSetting({
                    data: {
                      key: newKey.trim(),
                      value: parseValue(newValue),
                      description: newDesc.trim() || undefined,
                      isPublic: newPublic,
                    },
                  }).then(() => {
                    setNewKey("");
                    setNewValue("");
                    setNewDesc("");
                    setNewPublic(false);
                  }),
                )
              }
            >
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Broadcast announcement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message (optional)"
            rows={3}
          />
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link (optional, e.g. /games)"
          />
          <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="player">Players</SelectItem>
              <SelectItem value="team">Teams</SelectItem>
              <SelectItem value="trainer">Trainers</SelectItem>
              <SelectItem value="gym">Gyms</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={title.trim().length < 3} onClick={() => setConfirmBroadcast(true)}>
            Send announcement
          </Button>
        </CardContent>
      </Card>

      <PushTester />

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Live queues</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <Queue
            title="Join requests"
            rows={queues.data?.joins ?? []}
            render={(r: any) => `${r.game_id} · ${r.status}`}
          />
          <Queue
            title="Position waitlist"
            rows={queues.data?.waitlist ?? []}
            render={(r: any) => `${r.game_id} · ${r.position} · ${r.status}`}
          />
          <Queue
            title="Highlight reels"
            rows={queues.data?.reels ?? []}
            render={(r: any) => `${r.title} · ${r.status} (${r.processing_step})`}
          />
          <Queue
            title="Org member requests"
            rows={queues.data?.orgRequests ?? []}
            render={(r: any) => `${r.status}`}
          />
        </CardContent>
      </Card>

      <ConfirmAction
        open={confirmBroadcast}
        onOpenChange={setConfirmBroadcast}
        title="Send announcement"
        description={`This creates a notification for every ${audience === "all" ? "active account" : `${audience} account`}.`}
        confirmWord="SEND"
        pending={send.isPending}
        onConfirm={(reason) => send.mutate(reason)}
      />
    </div>
  );
}

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function SettingRow({
  setting,
  pending,
  onSave,
}: {
  setting: any;
  pending?: boolean;
  onSave: (value: unknown, isPublic: boolean) => void;
}) {
  const isBool = typeof setting.value === "boolean";
  const [text, setText] = useState(isBool ? "" : JSON.stringify(setting.value));
  const [isPublic, setIsPublic] = useState(!!setting.is_public);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-mono font-medium truncate">{setting.key}</div>
          {setting.description ? (
            <div className="text-[11px] text-muted-foreground">{setting.description}</div>
          ) : null}
        </div>
        {setting.is_public ? <Badge variant="secondary">public</Badge> : null}
      </div>
      {isBool ? (
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={setting.value === true}
            disabled={pending}
            onCheckedChange={(v) => onSave(v, isPublic)}
          />
          {setting.value === true ? "Enabled" : "Disabled"}
        </label>
      ) : (
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" disabled={pending} onClick={() => onSave(parseValue(text), isPublic)}>
            Save
          </Button>
        </div>
      )}
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Switch
          checked={isPublic}
          disabled={pending}
          onCheckedChange={(v) => {
            setIsPublic(v);
            onSave(setting.value, v);
          }}
        />
        Readable by the app
      </label>
    </div>
  );
}

function Queue({
  title,
  rows,
  render,
}: {
  title: string;
  rows: any[];
  render: (row: any) => string;
}) {
  return (
    <div className="space-y-1">
      <div className="micro-label text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground">Empty</div>
      ) : (
        rows.slice(0, 12).map((r: any) => (
          <div key={r.id} className="truncate">
            {render(r)}
          </div>
        ))
      )}
    </div>
  );
}

function PushTester() {
  const sendTest = useServerFn(sendTestPushToSelf);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<any>(null);

  const run = useMutation({
    mutationFn: () =>
      sendTest({ data: { title: title.trim() || null, body: body.trim() || null } }),
    onSuccess: (r: any) => {
      setResult(r);
      if (r.reason === "not_configured") toast.error("Push provider key isn't configured");
      else if (r.ok) toast.success(`Push delivered to ${r.recipients} device(s)`);
      else if (!r.linked) toast.error("Your account isn't linked to push yet");
      else toast.error(r.error ? `Send failed: ${r.error}` : "No subscribed devices");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const Row = ({ label, ok, value }: { label: string; ok: boolean; value: string }) => (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? "default" : "destructive"}>{value}</Badge>
    </div>
  );

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Push delivery test (your account)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Sends a sample push to your own devices and verifies your account is linked to the push
          provider with an active subscription.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            placeholder="Message (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Sending…" : "Send test push"}
        </Button>

        {result && (
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <Row
              label="Account linked to push provider"
              ok={!!result.linked}
              value={result.linked ? "Linked" : "Not linked"}
            />
            <Row
              label="Subscribed devices"
              ok={(result.enabledSubscriptions ?? 0) > 0}
              value={String(result.enabledSubscriptions ?? 0)}
            />
            <Row
              label="Devices reached"
              ok={(result.recipients ?? 0) > 0}
              value={String(result.recipients ?? 0)}
            />
            <Row
              label="Delivery log"
              ok={result.delivery?.status === "sent"}
              value={result.delivery?.status ?? "not recorded"}
            />
            {result.error && <p className="text-xs text-destructive">Error: {result.error}</p>}
            {result.reason === "not_configured" && (
              <p className="text-xs text-destructive">Push provider key is not configured.</p>
            )}
            {!result.linked && (
              <p className="text-xs text-muted-foreground">
                Open Notifications and tap “Turn on push” on this device, then retest.
              </p>
            )}
            {result.subscriptions?.length > 0 && (
              <ul className="pt-1 text-[11px] text-muted-foreground">
                {result.subscriptions.map((s: any) => (
                  <li key={s.id}>
                    {s.type ?? "push"} · {s.device ?? "unknown device"} ·{" "}
                    {s.enabled ? "enabled" : "disabled"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
