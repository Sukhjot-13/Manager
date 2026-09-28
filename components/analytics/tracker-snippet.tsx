"use client";

import { useState } from "react";
import { Copy, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { getEmbedSnippet } from "@/lib/tracker";

const API_CALLS = `window.__mgr("event", "signup_clicked", { plan: "pro" });
window.__mgr("event", "checkout_started", { cart: 3 });
window.__mgr("pageview");`;

export function TrackerSnippet({
  origin,
  slug,
  maskedKey,
}: {
  origin: string;
  slug: string;
  maskedKey: string;
}) {
  const { push } = useToast();
  const [key, setKey] = useState("");
  const snippet = getEmbedSnippet({ origin, slug, key });
  const display = key.trim() === "" ? snippet.maskedHtml : snippet.html;

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      push(`${label} copied`, "success");
    } catch {
      push("clipboard write failed", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Paste your analytics key</CardTitle>
          <span className="text-xs text-zinc-500">stored in this tab only</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Analytics key (mak_…)"
            htmlFor="analytics-key"
            hint={`Manager only stores a hash of your key. It is shown in full once, at creation. Current key: ${maskedKey || "none created yet"}`}
          >
            <Input
              id="analytics-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="mak_…"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <p className="flex items-start gap-2 text-xs text-zinc-500">
            <EyeOff size={14} className="mt-0.5 shrink-0" />
            The key is public by design: it is readable in any page&apos;s source, so it
            is kind-scoped to <code>events</code> only. It can never write logs, and it
            carries tighter rate limits plus the per-project kill switch.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Embed the tracker</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void copy(display, "snippet")}>
            <Copy size={14} />
            Copy
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {display}
          </pre>
          <p className="text-xs text-zinc-500">
            ~2.5 KB gzipped, one immutable request, no cookies, no cross-site identifier.
            Bump <code>?v=</code> to ship a new tracker version instantly.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(snippet.maskedHtml, "masked snippet")}
          >
            <Copy size={14} />
            Copy masked version (safe to commit)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Custom events</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(API_CALLS, "examples")}
          >
            <Copy size={14} />
            Copy
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {API_CALLS}
          </pre>
          <p className="flex items-start gap-2 text-xs text-zinc-500">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            Visitors are anonymous HMAC-SHA256 ids over IP + user agent, rotated daily with
            <code> VISITOR_PEPPER</code>. Bots are dropped at ingest, and the tracker
            respects <code>doNotTrack</code>, <code>globalPrivacyControl</code> and{" "}
            <code>localStorage.mgr_optout = &quot;1&quot;</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
