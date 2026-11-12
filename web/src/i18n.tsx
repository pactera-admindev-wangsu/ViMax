import {useSyncExternalStore} from 'react';
import {translations} from './translations';

export const LOCALE_STORAGE_KEY = 'vimax.locale';
export const locales = ['zh-CN', 'en-US', 'ja-JP'] as const;
export type Locale = typeof locales[number];
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function resolveLocale(value: unknown): Locale {
  return locales.includes(value as Locale) ? value as Locale : 'zh-CN';
}

export function readLocale(storage?: StorageLike): Locale {
  try { return resolveLocale(storage?.getItem(LOCALE_STORAGE_KEY)); }
  catch { return 'zh-CN'; }
}

export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const entry = Object.hasOwn(translations, key) ? translations[key] : undefined;
  const text = locale === 'en-US' || !entry ? key : entry[locale === 'zh-CN' ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

function browserStorage(): StorageLike | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

let locale = readLocale(browserStorage());
const listeners = new Set<() => void>();

export function setLocale(value: Locale, storage = browserStorage()) {
  locale = resolveLocale(value);
  try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* 保存できなくても切り替えを維持する。 */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'Workspace') + ' · ViMax';
  }
  listeners.forEach((listener) => listener());
}

export function t(key: string, values?: Record<string, string | number>) {
  return translate(locale, key, values);
}

export function translateError(message: string) {
  const http = /^(Request|Upload) failed with HTTP (\d+)$/.exec(message);
  if (http) return t(`${http[1]} failed with HTTP {status}`, {status: http[2]});
  const limit = /^File exceeds the (.+) upload limit$/.exec(message);
  if (limit) return t('File exceeds the {limit} upload limit', {limit: limit[1]});
  const field = /^(\w+\.\w+) (must be a string|is too long|must use http:\/\/ or https:\/\/)$/.exec(message);
  if (field) return `${field[1]}: ${t(field[2])}`;
  return t(message);
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLocale() {
  return locale;
}

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function LanguageSwitcher() {
  const current = useLocale();
  return <label className="language-switcher">
    <span>{t('Language')}</span>
    <select aria-label={t('Language')} value={current} onChange={(event) => setLocale(resolveLocale(event.target.value))}>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
      <option value="en-US" lang="en-US">English</option>
      <option value="ja-JP" lang="ja-JP">日本語</option>
    </select>
  </label>;
}

setLocale(locale);
