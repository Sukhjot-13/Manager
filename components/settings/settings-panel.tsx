"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { AppSettings } from "@/lib/settings";
import type { RotationResult } from "@/lib/secrets";

export function SettingsPanel({
  settings,
  audit,
  timezone,
}: {
  settings: AppSettings;
  audit: { action: string; actor: string; ts: string }[];
  timezone: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [local, setLocal] = useState(settings);
  const [pending, setPending] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [confirm, setConfirm] = useState("");

  async function save() {
    setPending(true);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ingestEnabled: local.ingestEnabled,
        analyticsEnabled: local.analyticsEnabled,
      }),
    });
    setPending(false);
    if (response.ok) {
      push("Settings saved", "success");
      router.refresh();
      return;
    }
    push("Could not save settings", "error");
  }

  async function rotate() {
    setPending(true);
    const response = await fetch("/api/settings/rotate-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newKey: newKey.trim(), confirm }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      push(
        body.error === "invalid_request"
          ? "Key must be 64 hex characters and confirm must be ROTATE"
          : "Rotation failed",
        "error",
      );
      return;
    }
    const result = (await response.json()) as RotationResult;
    setRotateOpen(false);
    setNewKey("");
    setConfirm("");
    push(
      `Rotated ${result.rotated} secret(s) to key version ${result.newKeyVer}` +
        (result.failed > 0 ? ` — ${result.failed} failed, re-run to resume` : ""),
      result.failed > 0 ? "error" : "success",
    );
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Ingest kill switches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle
            label="Accept log ingest"
            description="Turn off to reject every /api/ingest/logs write app-wide."
            checked={local.ingestEnabled}
            onChange={(value) => setLocal({ ...local, ingestEnabled: value })}
          />
          <Toggle
            label="Accept analytics events"
            description="Turn off to reject every /api/ingest/events write app-wide."
            checked={local.analyticsEnabled}
            onChange={(value) => setLocal({ ...local, analyticsEnabled: value })}
          />
          <div className="flex items-center gap-4 pt-1 text-xs text-zinc-500">
            <span>Max log batch: {settings.maxLogBatch}</span>
            <span>Max event batch: {settings.maxEventBatch}</span>
            <span>Display timezone: {timezone}</span>
          </div>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save switches"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Secrets vault master key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">
            <code>ENV_MASTER_KEY</code> lives only in your environment file. Losing it makes
            every stored secret permanently unreadable — keep an offline backup.
          </p>
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert size={14} />
            Rotation re-encrypts every row and is resumable: if it stops halfway, re-run it
            after swapping the env value.
          </div>
          <Button variant="outline" onClick={() => setRotateOpen(true)}>
            <KeyRound size={14} />
            Rotate master key
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent security events</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-zinc-500">No recorded events yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {audit.map((event, index) => (
                <li key={`${event.ts}-${index}`} className="flex gap-2 text-zinc-600 dark:text-zinc-400">
                  <span className="w-40 shrink-0 font-mono text-zinc-400">
                    {new Date(event.ts).toLocaleString()}
                  </span>
                  <span className="w-48 shrink-0 font-medium">{event.action}</span>
                  <span className="truncate">{event.actor}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title="Rotate master key"
        description="Paste the new 64-hex ENV_MASTER_KEY. Rows keep their keyVer so an interrupted run can be resumed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRotateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending || confirm !== "ROTATE"}
              onClick={rotate}
            >
              {pending ? "Rotating…" : "Rotate"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="New master key (64 hex chars)" htmlFor="new-key">
            <Input
              id="new-key"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              className="font-mono text-xs"
              placeholder="…"
            />
          </Field>
          <Field label="Type ROTATE to confirm" htmlFor="rotate-confirm">
            <Input
              id="rotate-confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{description}</span>
      </span>
    </label>
  );
}
