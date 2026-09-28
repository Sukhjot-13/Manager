import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RankedCount, UtmRow } from "@/lib/analytics";

function share(count: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.max(1, Math.round((count / total) * 100))}%`;
}

export function StatTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "ring-1 ring-emerald-500/40" : undefined}>
      <CardContent className="px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint === undefined ? null : <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function RankingCard({
  title,
  rows,
  total,
  empty,
  columns = ["Name", "Hits"],
  formatName,
}: {
  title: string;
  rows: RankedCount[];
  total: number;
  empty: string;
  columns?: [string, string] | [string, string, string];
  formatName?: (name: string) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-zinc-500">{rows.length} entries</span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">{empty}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                {columns.map((column) => (
                  <TH key={column}>{column}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.name}>
                  <TD className="max-w-[22rem] truncate font-mono text-xs">
                    {formatName === undefined ? row.name : formatName(row.name)}
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums">{row.count}</TD>
                  {columns.length === 3 ? (
                    <TD className="whitespace-nowrap text-xs text-zinc-500">
                      {share(row.count, total)}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function DeviceBreakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: RankedCount[];
  empty: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-zinc-500">{total} hits</span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.name}>
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{row.name}</span>
                  <span className="tabular-nums text-zinc-500">
                    {row.count} · {share(row.count, total)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-zinc-400 dark:bg-zinc-600"
                    style={{ width: `${total === 0 ? 0 : (row.count / total) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function UtmCard({ rows }: { rows: UtmRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
        <span className="text-xs text-zinc-500">utm_source · medium · campaign</span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No campaign visits in this range.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Source</TH>
                <TH>Medium</TH>
                <TH>Campaign</TH>
                <TH>Hits</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={`${row.source}|${row.medium}|${row.campaign}`}>
                  <TD className="font-mono text-xs">{row.source || "—"}</TD>
                  <TD className="font-mono text-xs">{row.medium || "—"}</TD>
                  <TD className="font-mono text-xs">{row.campaign || "—"}</TD>
                  <TD className="tabular-nums">{row.count}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
