export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogMeta = Record<string, unknown> | unknown[];

export type InitOptions = {
  endpoint: string;
  appId: string;
  apiKey: string;
  environment?: string;
  release?: string;
  appVersion?: string;
  captureConsole?: boolean | readonly LogLevel[];
  captureGlobalErrors?: boolean;
  captureFetch?: boolean;
  redactKeys?: readonly string[];
  sampleRate?: number | Partial<Record<LogLevel, number>>;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxLogsPerSecond?: number;
  maxQueueSize?: number;
};

export type LogEntry = {
  level: LogLevel;
  message: string;
  meta?: unknown;
  stack?: string;
  ts: number;
  sessionId: string;
  pageId: string;
  traceId: string;
  requestId?: string;
  url?: string;
  route?: string;
  referrer?: string;
  ua?: string;
  viewport?: string;
  lang?: string;
  tz?: string;
  connection?: string;
  appVersion?: string;
  environment?: string;
  release?: string;
  hostname?: string;
  pid?: number;
  runtimeVersion?: string;
  rssMb?: number;
  uptimeSec?: number;
  durationMs?: number;
};

export type FlushOptions = {
  beacon?: boolean;
  final?: boolean;
};

export type LogMethod = (message: string, meta?: LogMeta) => void;

export type Logger = {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  child(bindings: LogMeta): Logger;
  time(label: string): void;
  timeEnd(label: string, meta?: LogMeta): number | null;
  flush(options?: FlushOptions): Promise<void>;
  setContext(patch: LogMeta): void;
  withTrace(traceId: string): Logger;
  newTrace(): string;
  traceId(): string;
  sessionId(): string;
  droppedCount(): number;
};
