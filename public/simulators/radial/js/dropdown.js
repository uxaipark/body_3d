import {t as translateUI} from '../../../i18n/locale.js';
import {enhanceSelect as enhance,enhanceAllSelects as enhanceAll,observeSelects} from '../../../ui/select.js';
export const enhanceSelect=select=>enhance(select,{translate:translateUI});
let observing=false;
export function enhanceAllSelects(root=document){enhanceAll(root,{translate:translateUI});if(!observing){observing=true;observeSelects(document,{translate:translateUI});}}
