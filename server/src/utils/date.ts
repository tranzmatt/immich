import { DateTime } from 'luxon';
import { isoDateToDate, isoDatetimeToDate } from 'src/validation.js';

/**
 * Convert a date to a ISO 8601 datetime string.
 */
export const asDateTimeString = <T extends Date | string | undefined | null>(x: T) => {
  return x instanceof Date ? isoDatetimeToDate.encode(x) : (x as Exclude<T, Date>);
};

/**
 * Convert a date to a date string (yyyy-mm-dd).
 */
export const asDateString = (x: Date | string | null): string | null => {
  return x instanceof Date ? isoDateToDate.encode(x) : x;
};

/**
 * People born on February 29th are celebrated on February 28th in non-leap years.
 */
export const isLeapDayObserved = ({ year, month, day }: { year: number; month: number; day: number }) => {
  return month === 2 && day === 28 && !DateTime.local(year).isInLeapYear;
};

export const extractTimeZone = (dateTimeOriginal?: string | null) => {
  const extractedTimeZone = dateTimeOriginal ? DateTime.fromISO(dateTimeOriginal, { setZone: true }).zone : undefined;
  return extractedTimeZone?.type === 'fixed' ? extractedTimeZone : undefined;
};

export const mergeTimeZone = (dateTimeOriginal?: string | null, timeZone?: string | null) => {
  return dateTimeOriginal
    ? DateTime.fromISO(dateTimeOriginal, { zone: 'UTC' }).setZone(timeZone ?? undefined)
    : undefined;
};

/**
 * The "local" wall-clock reading for a dateTimeOriginal, re-labeled as UTC so it can be stored
 * and compared without also carrying a timezone. Mirrors how metadata extraction computes
 * asset.localDateTime from an image's embedded EXIF date/timezone (see MetadataService.getDates),
 * so a manual date edit stays consistent with what a fresh extraction would have produced.
 */
export const toLocalDateTime = (dateTimeOriginal: string) => {
  return DateTime.fromISO(dateTimeOriginal, { setZone: true }).setZone('UTC', { keepLocalTime: true }).toJSDate();
};

/**
 * Same idea as toLocalDateTime(), for callers that already have the instant as a Date plus a
 * separate fixed-offset timeZone name (e.g. a bulk relative-shift result) rather than a single
 * ISO string with the offset embedded. A missing/unknown timeZone is treated as "no shift":
 * the instant is used as-is, same as MetadataService.getDates()'s no-timezone fallback.
 */
export const localDateTimeFromInstant = (dateTimeOriginal: Date, timeZone?: string | null) => {
  const utc = DateTime.fromJSDate(dateTimeOriginal, { zone: 'utc' });
  const local = timeZone ? utc.setZone(timeZone) : utc;
  return local.setZone('UTC', { keepLocalTime: true }).toJSDate();
};
