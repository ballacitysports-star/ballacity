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
            (settings.data?.settings ?? []).map((s: any) => (
              <SettingRow
                key={s.key}
                setting={s}
                pending={save.isPending}
                onSave={(value, isPublic) =>
                  save.mutate(() => setSetting({ data: { key: s.key, value, isPublic } }))
                }
              />
            ))
          )}

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
          <Button
            disabled={title.trim().length < 3}
            onClick={() => setConfirmBroadcast(true)}
          >
            Send announcement
          </Button>
        </CardContent>
      </Card>

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
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
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
