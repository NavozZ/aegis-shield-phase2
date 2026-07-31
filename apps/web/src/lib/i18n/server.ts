import { cookies } from 'next/headers';
import {
  dictionaries,
  isLanguage,
  type Dictionary,
  type Language,
} from './dictionaries';

export async function getServerLanguage(): Promise<Language> {
  const value = (await cookies()).get('aegis_language')?.value;
  return isLanguage(value) ? value : 'EN';
}
export async function getServerDictionary(): Promise<Dictionary> {
  return dictionaries[await getServerLanguage()];
}
