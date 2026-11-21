// Day dividers between messages ("今天" / "昨天" / date), matching the Mac wording.
import { $t, intlLocale } from '@/i18n';

export function dayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso);
  if (!Number.isFinite(day.getTime())) return '';
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(now) - start(day)) / 86400000);
  if (diff === 0) return $t('今天');
  if (diff === 1) return $t('昨天');
  return day.toLocaleDateString(intlLocale(), { ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), month: 'long', day: 'numeric', weekday: 'short' });
}

export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
