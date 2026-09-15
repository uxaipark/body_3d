
import {t as translateUI,html as localizeHTML} from '../../../i18n/locale.js';
// Custom dropdown that replaces native <select> elements (keeps the <select> as the data
// model so existing `.value` / 'change' wiring keeps working). Usage: enhanceSelect(selectEl).

const open = new Set();

export function enhanceSelect(select) {
  if (select._dd) { select._dd.refresh(); return select._dd; }
  const wrap = document.createElement('div');
  wrap.className = 'dd';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dd-btn';
  const label = document.createElement('span'); label.className = 'dd-label';
  const caret = document.createElement('span'); caret.className = 'dd-caret'; caret.textContent = translateUI('▾');
  btn.append(label, caret);
  const list = document.createElement('ul'); list.className = 'dd-list'; list.setAttribute('role', 'listbox');
  wrap.append(btn, list);
  select.style.display = 'none';
  select.parentNode.insertBefore(wrap, select.nextSibling);

  const api = {
    refresh() {
      list.innerHTML = localizeHTML('');
      for (const opt of select.options) {
        const li = document.createElement('li');
        li.className = 'dd-item' + (opt.value === select.value ? ' selected' : '');
        li.textContent = translateUI(opt.textContent); li.dataset.value = opt.value; li.setAttribute('role', 'option');
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          if (select.value !== opt.value) { select.value = opt.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
          api.close();
        });
        list.appendChild(li);
      }
      const cur = select.options[select.selectedIndex];
      label.textContent = translateUI(cur ? cur.textContent : '');
      btn.disabled = select.disabled;
      wrap.classList.toggle('disabled', select.disabled);
    },
    open() { for (const o of open) if (o !== api) o.close(); wrap.classList.add('open'); open.add(api); },
    close() { wrap.classList.remove('open'); open.delete(api); },
    toggle() { wrap.classList.contains('open') ? api.close() : api.open(); },
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (!select.disabled) api.toggle(); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      const i = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + d));
      if (i !== select.selectedIndex) { select.selectedIndex = i; select.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (e.key === 'Escape') api.close();
  });
  select.addEventListener('change', api.refresh);
  api.refresh();
  select._dd = api;
  return api;
}

document.addEventListener('click', () => { for (const o of [...open]) o.close(); });

export function enhanceAllSelects(root = document) {
  for (const s of root.querySelectorAll('select')) enhanceSelect(s);
}
