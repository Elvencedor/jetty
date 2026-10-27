import { eq } from 'drizzle-orm';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { storeSettings } from '../../db/schema/index.js';

export const PAYMENT_METHODS = ['card', 'bank_transfer'] as const;

const text = (max: number) => Joi.string().trim().max(max).allow('');
const phone = Joi.string().trim().pattern(/^\+[1-9]\d{7,14}$/).allow('').messages({ 'string.pattern.base': 'must be in E.164 format, e.g. +2348012345678' });

/** Allow-listed, schema-validated settings. Anything not listed here cannot be written through the API. */
export const SETTINGS = {
  store: {
    defaults: { name: "Jetty's Hair", contactEmail: '', contactPhone: '', whatsappNumber: '', showroomAddress: '', showroomHours: '' },
    schema: Joi.object({ name: Joi.string().trim().min(1).max(80), contactEmail: Joi.string().trim().email().max(254).allow(''), contactPhone: phone, whatsappNumber: phone, showroomAddress: text(300), showroomHours: text(200) }),
    public: true,
  },
  policies: {
    defaults: { returnWindowDays: 7, podMaxOrderMinor: null as number | null },
    schema: Joi.object({ returnWindowDays: Joi.number().integer().min(0).max(90), podMaxOrderMinor: Joi.number().integer().min(0).allow(null) }),
    public: true,
  },
  payments: {
    // How long stock is held for an unpaid order. Paystack transfer account numbers are short-lived, so keep the
    // transfer hold close to that; verify the figure for your Paystack account before launch.
    defaults: { enabledMethods: [...PAYMENT_METHODS] as string[], cardHoldMinutes: 30, transferHoldMinutes: 45 },
    schema: Joi.object({
      enabledMethods: Joi.array().items(Joi.string().valid(...PAYMENT_METHODS)).unique().min(1),
      cardHoldMinutes: Joi.number().integer().min(15).max(480),
      transferHoldMinutes: Joi.number().integer().min(15).max(480),
    }),
    public: true,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

const dbKey = (key: SettingKey) => `app.${key}`;

/** Stored values layered over defaults, so a missing or partial row never breaks a reader. */
export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<(typeof SETTINGS)[K]['defaults']> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.key, dbKey(key)));
  return { ...SETTINGS[key].defaults, ...((row?.value as object | undefined) ?? {}) } as (typeof SETTINGS)[K]['defaults'];
}

export async function updateSetting(db: Db, adminId: string, key: SettingKey, patch: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(storeSettings).where(eq(storeSettings.key, dbKey(key))).for('update');
    const before = { ...SETTINGS[key].defaults, ...((row?.value as object | undefined) ?? {}) };
    const after = { ...before, ...patch };
    await tx
      .insert(storeSettings)
      .values({ key: dbKey(key), value: after, updatedByAdminId: adminId })
      .onConflictDoUpdate({ target: storeSettings.key, set: { value: after, updatedByAdminId: adminId, updatedAt: new Date() } });
    return { before, after };
  });
}

export async function publicSettings(db: Db) {
  const entries = await Promise.all(SETTING_KEYS.filter((k) => SETTINGS[k].public).map(async (k) => [k, await getSetting(db, k)] as const));
  return Object.fromEntries(entries);
}
