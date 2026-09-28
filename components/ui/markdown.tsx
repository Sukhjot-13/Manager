import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "quote"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence !== null) {
      const language = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", language, text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote !== null) {
      blocks.push({ kind: "quote", text: quote[1] });
      index += 1;
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const pattern = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index]);
        if (match === null) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() !== "" && !/^(#{1,6})\s|^```|^>\s?/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let position = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${position}`;
    position += 1;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link === null ? token : link[2];
      const label = link === null ? token : link[1];
      const safe = isSafeHref(href) ? href : "#";
      nodes.push(
        <a
          key={key}
          href={safe}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-blue-600 underline dark:text-blue-400"
        >
          {label}
        </a>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function isSafeHref(href: string): boolean {
  return (
    href.startsWith("https://") ||
    href.startsWith("http://") ||
    href.startsWith("mailto:") ||
    href.startsWith("/")
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === "heading") {
          const size =
            block.level <= 2 ? "text-lg" : block.level <= 4 ? "text-base" : "text-sm";
          return (
            <p key={key} className={`${size} font-semibold text-zinc-900 dark:text-zinc-100`}>
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.kind === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            >
              {renderInline(block.text, key)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const items = block.items.map((item, position) => (
            <li key={`${key}-${position}`} className="ml-4 list-disc">
              {renderInline(item, `${key}-${position}`)}
            </li>
          ));
          return block.ordered ? (
            <ol key={key} className="list-decimal">
              {items}
            </ol>
          ) : (
            <ul key={key}>{items}</ul>
          );
        }
        return <p key={key}>{renderInline(block.text, key)}</p>;
      })}
    </div>
  );
}
