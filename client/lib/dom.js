// A tiny element builder. Text is always set as text, never as HTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked' || key === 'selected') el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, children);
  // A select can only take its value once its options exist.
  if (tag === 'select' && props?.value !== undefined) el.value = props.value;
  return el;
}

export function add(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const replace = (el, ...children) => {
  el.textContent = '';
  return add(el, ...children);
};

export const icon = (name, { size, flip } = {}) =>
  h('span', {
    class: `ic${flip ? ' flip' : ''}`,
    'aria-hidden': 'true',
    style: `--src:url('/vendor/icons/bold/${name}-bold.svg')${size ? `;--size:${size}px` : ''}`,
  });
