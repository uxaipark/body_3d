import {cookies} from 'next/headers';
import {normalizeLanguage, languageCookie} from '../../public/i18n/locale.js';
export async function getServerLanguage(){return normalizeLanguage((await cookies()).get(languageCookie)?.value);}
