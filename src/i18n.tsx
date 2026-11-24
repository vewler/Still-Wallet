import { Fragment, useSyncExternalStore, type ReactNode } from 'react'

/** App languages. English is built in, the rest load on demand. Names are shown in their own language. */
export const languages = [
  ['en', 'English'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['tr', 'Türkçe'],
  ['ru', 'Русский'],
  ['zh', '中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
] as const

export type Language = typeof languages[number][0]
type Dictionary = Record<string, string>

const loaders: Record<Exclude<Language, 'en'>, () => Promise<{ default: Dictionary }>> = {
  es: () => import('./locales/es'),
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  pt: () => import('./locales/pt'),
  it: () => import('./locales/it'),
  nl: () => import('./locales/nl'),
  tr: () => import('./locales/tr'),
  ru: () => import('./locales/ru'),
  zh: () => import('./locales/zh'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
}

const KEY = 'still.language'
const isLanguage = (value: unknown): value is Language => languages.some(([code]) => code === value)

/** What the device asks for, English if none of ours match. */
export function deviceLanguage(): Language {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag?.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

function savedChoice(): Language | 'auto' {
  try {
    const value = localStorage.getItem(KEY)
    return isLanguage(value) ? value : 'auto'
  } catch { return 'auto' }
}

let choice = savedChoice()
let current: Language = 'en'
let dictionary: Dictionary = {}
let request = 0
const listeners = new Set<() => void>()

async function apply(language: Language) {
  const id = ++request
  const next = language === 'en' ? {} : (await loaders[language]()).default
  if (id !== request) return
  dictionary = next
  current = language
  document.documentElement.lang = language
  listeners.forEach((listener) => listener())
}

/** Resolves once the first language is loaded, so the app never flashes English. */
export const languageReady = apply(choice === 'auto' ? deviceLanguage() : choice).catch(() => undefined)

/** 'auto' follows the device. */
export function languageChoice() { return choice }

export async function setLanguage(next: Language | 'auto') {
  choice = next
  try {
    if (next === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch { /* Keep it for this visit. */ }
  await apply(next === 'auto' ? deviceLanguage() : next)
}

// The device language can change while the app is open.
addEventListener('languagechange', () => { if (choice === 'auto') void apply(deviceLanguage()).catch(() => undefined) })

/** Re-render on language change. */
export function useLanguage() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => current)
}

/** Translate an English string. {name} placeholders get filled from `values`. Unknown strings stay English. */
export function t(text: string, values?: Record<string, string | number>) {
  const out = dictionary[text] ?? text
  return values ? out.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match) : out
}

/** Same as t, but placeholders can be elements (bold names, links). */
export function tx(text: string, values: Record<string, ReactNode>): ReactNode {
  return (dictionary[text] ?? text).split(/(\{\w+\})/).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1]
    return <Fragment key={index}>{key && key in values ? values[key] : part}</Fragment>
  })
}
