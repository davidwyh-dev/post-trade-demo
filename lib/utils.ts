import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const fmt = new Intl.NumberFormat('en-US');

export function formatNotional(n: number, ccy?: string): string {
  if (n >= 1_000_000) {
    const mm = n / 1_000_000;
    const display = Number.isInteger(mm) ? mm.toString() : mm.toFixed(2);
    return ccy ? `${display}MM ${ccy}` : `${display}MM`;
  }
  return ccy ? `${fmt.format(n)} ${ccy}` : fmt.format(n);
}

export function formatRate(r: number): string {
  return `${r.toFixed(4)}%`;
}

export function formatDate(d: string | Date): string {
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}
