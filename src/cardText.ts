/** Helpers for summarising a card's rich text on the card face. */

export interface Summary {
  excerpt: string;
  checked: number;
  total: number;
}

const cache = new Map<string, Summary>();

export function summarise(html: string): Summary {
  if (!html) return { excerpt: '', checked: 0, total: 0 };
  const hit = cache.get(html);
  if (hit) return hit;

  // textContent glues blocks together ("…check-in.Draft the…"), so give every
  // block close a space to break on before parsing.
  const spaced = html.replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr|td|th)>/gi, ' $& ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  const items = doc.querySelectorAll('li[data-type="taskItem"]');
  const summary: Summary = {
    excerpt: (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim(),
    checked: doc.querySelectorAll('li[data-type="taskItem"][data-checked="true"]').length,
    total: items.length,
  };

  if (cache.size > 500) cache.clear();
  cache.set(html, summary);
  return summary;
}

export function formatEstimate(hours: number): string {
  if (!hours) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
