import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMoney(amount: number) {
  return currency.format(amount)
}

/** Formats minutes-since-midnight as a 12-hour clock, e.g. 485 -> "8:05 AM". */
export function formatClock(minute: number) {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${suffix}`
}

const wholeCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function formatMoneyWhole(amount: number) {
  return wholeCurrency.format(amount)
}

/** Board feet, rounded, e.g. "1,250 bf". */
export function formatBf(boardFeet: number) {
  return `${Math.round(boardFeet).toLocaleString('en-US')} bf`
}

export function formatSqFt(sqFt: number) {
  return `${Math.round(sqFt).toLocaleString('en-US')} sq ft`
}

/** A 0–1 fraction as a percentage, e.g. 0.125 -> "12.5%". */
export function formatPct(fraction: number) {
  return `${(fraction * 100).toFixed(1)}%`
}
