import { connectToDatabase } from "@/lib/db/connect";
import { APP_SETTING_KEYS, AppSettingModel } from "@/lib/db/ops";

export type AppSettings = {
  ingestEnabled: boolean;
  analyticsEnabled: boolean;
  maxLogBatch: number;
  maxEventBatch: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  ingestEnabled: true,
  analyticsEnabled: true,
  maxLogBatch: 100,
  maxEventBatch: 100,
};

export async function getSettings(): Promise<AppSettings> {
  await connectToDatabase();
  const rows = await AppSettingModel.find({
    key: { $in: Object.values(APP_SETTING_KEYS) },
  }).lean();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const bool = (key: string, fallback: boolean): boolean => {
    const value = values.get(key);
    return typeof value === "boolean" ? value : fallback;
  };
  const num = (key: string, fallback: number): number => {
    const value = values.get(key);
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  return {
    ingestEnabled: bool(APP_SETTING_KEYS.ingestEnabled, DEFAULT_SETTINGS.ingestEnabled),
    analyticsEnabled: bool(
      APP_SETTING_KEYS.analyticsEnabled,
      DEFAULT_SETTINGS.analyticsEnabled,
    ),
    maxLogBatch: num(APP_SETTING_KEYS.maxLogBatch, DEFAULT_SETTINGS.maxLogBatch),
    maxEventBatch: num(APP_SETTING_KEYS.maxEventBatch, DEFAULT_SETTINGS.maxEventBatch),
  };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await connectToDatabase();
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    const settingKey = Object.entries(APP_SETTING_KEYS).find(
      ([name]) => name === key,
    )?.[1];
    if (settingKey === undefined) {
      continue;
    }
    await AppSettingModel.updateOne(
      { key: settingKey },
      { $set: { value } },
      { upsert: true },
    ).exec();
  }
  return getSettings();
}
