import { createContext, useContext } from 'react'
import { en, type Translations } from './en'
import { ru } from './ru'

export type Lang = 'en' | 'ru'

const LANGS: Record<Lang, Translations> = { en, ru }

export const I18nContext = createContext<Translations>(en)

export function getTranslations(lang: Lang): Translations {
  return LANGS[lang] ?? en
}

export function useT(): Translations {
  return useContext(I18nContext)
}

export type { Translations }
