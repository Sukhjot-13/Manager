import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, parseEnvFile, readEnvImportFile } from "@/lib/envImport";

describe("env import parser", () => {
  it("preserves symbols, quoted whitespace and literal dollar references across pasted keys", () => {
    expect(parseEnvFile([
      '\uFEFFexport VAR_NAME = "Value" # comment',
      'API_KEY="abc==#$VALUE"',
      'URL=https://example.test/?a=1&b=2 # comment',
      "LITERAL='  ${VAR_NAME} \\n # literal  '",
      'EMPTY_COMMENT=kept#ignored',
    ].join("\r\n"))).toEqual({
      entries: [
        { key: "VAR_NAME", value: "Value" },
        { key: "API_KEY", value: "abc==#$VALUE" },
        { key: "URL", value: "https://example.test/?a=1&b=2" },
        { key: "LITERAL", value: "  ${VAR_NAME} \\n # literal  " },
        { key: "EMPTY_COMMENT", value: "kept" },
      ], errors: [],
    });
  });

  it("decodes exported escapes once and preserves unknown escapes and raw backslashes", () => {
    expect(parseEnvFile(String.raw`ESCAPED="say \"hi\"\\path\nnext\rend\q"
RAW=C:\tools\new
LITERAL='\n\r\\'
BACKTICK=` + "`quoted # = text`")).toEqual({
      entries: [
        { key: "ESCAPED", value: 'say "hi"\\path\nnext\rend\\q' },
        { key: "RAW", value: "C:\\tools\\new" },
        { key: "LITERAL", value: "\\n\\r\\\\" },
        { key: "BACKTICK", value: "quoted # = text" },
      ], errors: [],
    });
  });

  it("preserves multiline quoted values, including assignment-looking content and spaces", () => {
    expect(parseEnvFile('CERT="first  \r\nINSIDE=value#literal\r\nlast" # note\r\nNEXT=ok')).toEqual({
      entries: [
        { key: "CERT", value: "first  \nINSIDE=value#literal\nlast" },
        { key: "NEXT", value: "ok" },
      ], errors: [],
    });
  });

  it("reports malformed quotes without including secret values in errors", () => {
    const parsed = parseEnvFile('BAD="secret"suffix\nGOOD=ok\nOPEN="do-not-leak');
    expect(parsed.entries).toEqual([{ key: "GOOD", value: "ok" }]);
    expect(parsed.errors).toEqual([
      "line 1: unexpected text after quoted value for BAD",
      "line 3: unterminated quoted value for OPEN",
    ]);
  });

  it("rejects empty quoted values, duplicate keys, long keys and long values", () => {
    const parsed = parseEnvFile(`EMPTY=""\nA=first\nA=second\n${"K".repeat(201)}=v\nBIG=${"v".repeat(20_001)}`);
    expect(parsed.entries).toEqual([{ key: "A", value: "first" }]);
    expect(parsed.errors).toHaveLength(4);
  });

  it("measures pasted size in UTF-8 bytes and rejects binary data", () => {
    expect(parseEnvFile(`A=${"é".repeat(MAX_IMPORT_BYTES / 2)}`).errors).toEqual(["Contents exceed the 200 KB import limit."]);
    expect(parseEnvFile("A=one\0two").entries).toEqual([]);
  });
});

describe("env file selection", () => {
  it("reads a single UTF-8 .env file and uses the same parser as paste", async () => {
    const content = 'A="one=two#three"\nB=next';
    const loaded = await readEnvImportFile([new File([content], ".env")]);
    expect(loaded).toBe(content);
    expect(parseEnvFile(loaded)).toEqual(parseEnvFile(content));
  });

  it("rejects missing/multiple files and other extensions regardless of MIME", async () => {
    for (const files of [[], [new File(["A=1"], "vars.txt")], [new File(["A=1"], ".env.local")], [new File(["A=1"], ".env"), new File(["B=2"], "other.env")]]) {
      await expect(readEnvImportFile(files)).rejects.toThrow("one .env file only");
    }
  });

  it("rejects oversized files, invalid UTF-8, binary content and failed reads", async () => {
    await expect(readEnvImportFile([new File(["x".repeat(MAX_IMPORT_BYTES + 1)], ".env")])).rejects.toThrow("200 KB");
    for (const content of [new Uint8Array([0xff]), "A=one\0two"]) {
      await expect(readEnvImportFile([new File([content], ".env")])).rejects.toThrow("UTF-8 text");
    }
    const unreadable = new File(["A=1"], ".env");
    unreadable.arrayBuffer = async () => { throw new Error("read failed"); };
    await expect(readEnvImportFile([unreadable])).rejects.toThrow("Could not read");
  });
});
