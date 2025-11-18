import { startOfDay } from 'date-fns';
import type { EventType, Locale, Person } from './types';

// ============== Helpers ==============
export const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export const ymdToDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const LOCALE_TAG: Record<string, string> = {
  nl: 'nl-NL',
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  pt: 'pt-PT',
  fr: 'fr-FR',
  it: 'it-IT',
};

const tag = (L: Locale) => LOCALE_TAG[L] ?? (L.includes('-') ? L : 'en-US');

function parseYmd(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function ymdToLocalNoonDate(iso: string) {
  const { y, m, d } = parseYmd(iso);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function ageOn(iso: string, at: Date) {
  const { y, m, d } = parseYmd(iso);
  let age = at.getFullYear() - y;
  const hadBirthday =
    (at.getMonth() + 1 > m) || ((at.getMonth() + 1 === m) && (at.getDate() >= d));
  if (!hadBirthday) age--;
  return Math.max(0, age);
}

export function nextOccurrence(iso: string, ref = new Date()) {
  const { m, d } = parseYmd(iso);
  const thisYear = new Date(ref.getFullYear(), (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
  return thisYear >= startOfDay(ref)
    ? thisYear
    : new Date(ref.getFullYear() + 1, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

// ---- Plural helpers per taal
function yearsWord(L: Locale, n: number) {
  switch (L) {
    case 'nl': return 'jaar'; // onveranderlijk
    case 'de': return n === 1 ? 'Jahr'  : 'Jahre';
    case 'es': return n === 1 ? 'año'   : 'años';
    case 'pt': return n === 1 ? 'ano'   : 'anos';
    case 'fr': return n === 1 ? 'an'    : 'ans';
    case 'it': return n === 1 ? 'anno'  : 'anni';
    default:   return n === 1 ? 'year'  : 'years';
  }
}

// ---- Zinsdelen voor verjaardagen / leeftijden
function birthdayUpcoming(L: Locale, yrs: number) {
  switch (L) {
    case 'nl': return `wordt ${yrs} ${yearsWord(L, yrs)}`;
    case 'de': return `wird ${yrs} ${yearsWord(L, yrs)} alt`;
    case 'es': return `cumplirá ${yrs} ${yearsWord(L, yrs)}`;
    case 'pt': return `fará ${yrs} ${yearsWord(L, yrs)}`;
    case 'fr': return `aura ${yrs} ${yearsWord(L, yrs)}`;
    case 'it': return `compirà ${yrs} ${yearsWord(L, yrs)}`;
    default:   return `turns ${yrs}`;
  }
}

function birthdayCurrent(L: Locale, yrs: number) {
  switch (L) {
    case 'nl': return `is ${yrs} ${yearsWord(L, yrs)}`;
    case 'de': return `ist ${yrs} ${yearsWord(L, yrs)} alt`;
    case 'es': return `tiene ${yrs} ${yearsWord(L, yrs)}`;
    case 'pt': return `tem ${yrs} ${yearsWord(L, yrs)}`;
    case 'fr': return `a ${yrs} ${yearsWord(L, yrs)}`;
    case 'it': return `ha ${yrs} ${yearsWord(L, yrs)}`;
    default:   return `is ${yrs} ${yearsWord(L, yrs)}`;
  }
}

export function agePhrase(
  L: Locale,
  yrs: number,
  mode: 'upcoming' | 'current',
  type: EventType
) {
  if (type === 'birthday') {
    return mode === 'upcoming'
      ? birthdayUpcoming(L, yrs)
      : birthdayCurrent(L, yrs);
  }
  // Anniversary/other → alleen “X jaar/years/Jahre/…”
  return `${yrs} ${yearsWord(L, yrs)}`;
}

export function formatDM_localized(iso: string, L: Locale) {
  const { m, d } = parseYmd(iso);
  const fake = new Date(Date.UTC(2000, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat(tag(L), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(fake);
}

export function formatDMY_localized(iso: string, L: Locale) {
  const { y, m, d } = parseYmd(iso);
  const fake = new Date(Date.UTC(2000, (m ?? 1) - 1, d ?? 1));
  const formatted = new Intl.DateTimeFormat(tag(L), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fake);

  // Vervang het “fake” jaar 2000 door het echte jaar uit de string
  // (zo blijf je vrij van TZ issues en behoud je locale volgorde/komma’s)
  return formatted.replace(/2000\b/, String(y));
}

export function formatDM(iso: string, L: Locale) {
  return formatDM_localized(iso, L);
}

export function firstFutureFireFor(iso: string, hour: number, minute: number, now = new Date()) {
  const { y, m, d } = parseYmd(iso);
  let fire = new Date(now.getFullYear(), (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0);
  if (fire <= now) {
    fire = new Date(now.getFullYear() + 1, (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0);
  }
  return fire;
}

// ============== CSV ==============
export const CSV_HEADER = 'id,name,type,dateISO,label,sameDayReminder';

const csvEsc = (s?: string) =>
  `"${(s ?? '').toString().replace(/"/g, '""')}"`;

export function toCSVRow(p: Person) {
  return [p.id, csvEsc(p.name), p.type, p.dateISO, csvEsc(p.label), p.sameDayReminder ? 'true' : 'false'].join(',');
}

export function parseCSV(text: string): Person[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length || lines[0].trim() !== CSV_HEADER) throw new Error('BAD_HEADER');
  const out: Person[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols: string[] = [];
    let cur = '', inQ = false;
    const row = lines[i];
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (inQ) {
        if (ch === '"' && row[k + 1] === '"') { cur += '"'; k++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cols.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cols.push(cur);
    const [id, name, type, dateISO, label, sameDayReminder] = cols;
    if (!name || !dateISO) continue;
    out.push({
      id: id || uuid(),
      name,
      type: (['birthday', 'anniversary', 'other'].includes(type) ? (type as EventType) : 'other'),
      dateISO,
      label,
      sameDayReminder: sameDayReminder === 'true' || sameDayReminder === '1',
    });
  }
  return out;
}

//Formats a Date into a local YYYY-MM-DD string.
export function toISODateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}