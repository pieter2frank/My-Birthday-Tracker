// notifications.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ───────────────────────────────────────────────────────────────────────────────
// Types die je ook in index.tsx gebruikt
export type EventType = 'birthday' | 'anniversary' | 'other';
export type Locale = 'nl' | 'en';

export type Person = {
  id: string;
  name: string;
  type: EventType;
  dateISO: string; // YYYY-MM-DD (geboortedatum/jubileumdatum)
  label?: string;
  sameDayReminder?: boolean; // optioneel per-persoon toggle
};

export type Settings = {
  weeklySummaryEnabled: boolean;
  weeklySummaryWeekday: number; // 1=Mon..7=Sun
  weeklySummaryHour: number;
  weeklySummaryMinute: number;
  sameDayHour: number;
  sameDayMinute: number;
  locale: Locale;
};

// ───────────────────────────────────────────────────────────────────────────────
// Notification handler (vereist om banners te tonen; foreground gedrag)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ───────────────────────────────────────────────────────────────────────────────
// Permissions + Android kanalen
export async function ensureNotifPerms(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  }
  return true;
}

export async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('daily-reminders', {
    name: 'Daily Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('weekly-summary', {
    name: 'Weekly Summary',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Datumhelpers
function parseYmd(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
function setTimeToDate(date: Date, h: number, m: number) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}
function nextOccurrence(iso: string, ref = new Date()) {
  const { m, d } = parseYmd(iso);
  const thisYear = new Date(ref.getFullYear(), (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
  return thisYear >= new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
    ? thisYear
    : new Date(ref.getFullYear() + 1, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function ageOn(iso: string, at: Date) {
  const { y, m, d } = parseYmd(iso);
  let age = at.getFullYear() - y;
  const had = (at.getMonth() + 1 > m) || ((at.getMonth() + 1 === m) && at.getDate() >= d);
  return Math.max(0, had ? age : age - 1);
}

// ───────────────────────────────────────────────────────────────────────────────
// Tekstopbouw
function buildDailyBody(atDate: Date, persons: Person[], L: Locale): string | null {
  if (persons.length === 0) return null;
  const names = persons.map(p => {
    const emoji = p.type === 'birthday' ? '🎂' : p.type === 'anniversary' ? '💍' : '🎉';
    const yrs = ageOn(p.dateISO, atDate);
    const yrsText = L === 'nl' ? `${yrs} jaar` : `${yrs} years`;
    return `${p.name} ${emoji} ${yrsText}`;
  });
  if (names.length === 1) {
    return L === 'nl' ? `🎂 Feest vandaag! 🎂 ${names[0]}` : `🎂 Time to celebrate! 🎂: ${names[0]}`;
  }
  const last = names.pop();
  return L === 'nl'
    ? `Feliciteer vandaag: ${names.join(', ')} en ${last}`
    : `Send your best wishes to: ${names.join(', ')} and ${last}`;
}

function buildWeeklyBody(startDate: Date, people: Person[], L: Locale): string | null {
  if (people.length === 0) return null;
  const map: Record<string, Person[]> = {};
  people.forEach(p => {
    const { m, d } = parseYmd(p.dateISO);
    const day = new Date(startDate.getFullYear(), (m ?? 1)-1, d ?? 1);
    const key = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString();
    (map[key] ??= []).push(p);
  });
  const dayNames = L === 'nl' ? ['zo','ma','di','wo','do','vr','za'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const entries: string[] = [];
  Object.keys(map).sort().forEach(key => {
    const day = new Date(key);
    const dn = dayNames[day.getDay()];
    const month = L === 'nl'
      ? `${day.getDate()} ${day.toLocaleDateString('nl-NL', { month: 'short' })}`
      : `${day.toLocaleDateString('en-US', { month: 'short' })} ${day.getDate()}`;
    const txt = map[key].map(p => {
      const emoji = p.type === 'birthday' ? '🎂' : p.type === 'anniversary' ? '💍' : '🎉';
      const yrs = ageOn(p.dateISO, day);
      return `${p.name} (${emoji} ${yrs})`;
    }).join(', ');
    entries.push(`${dn} ${month}: ${txt}`);
  });
  return L === 'nl' ? `Deze week: ${entries.join('; ')}` : `This week: ${entries.join('; ')}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Veilig schedulen: voorkom 'immediate fire' door mis-parse/afronding in SDK 52
async function scheduleSafe(req: Notifications.NotificationRequestInput) {
  // NB: trigger mag een Date zijn of een schedulable trigger (DATE, DAILY, etc.)
  const trigger = req.trigger as Notifications.SchedulableNotificationTriggerInput | Date | number;

  // Probeer te achterhalen wat de native laag als "volgende tijd" ziet
  let next: number | null = null;
  try {
    next = await Notifications.getNextTriggerDateAsync(trigger as any);
  } catch {
    // Sommige vormen (Date/number) kunnen throwen op oudere clients; negeren
  }

  const targetMs =
    trigger instanceof Date ? trigger.getTime()
    : typeof trigger === 'number' ? trigger
    : next ?? 0;

  // 1s marge om "nu" (afrondingsfouten/klok drift) te ontwijken
  if (!targetMs || targetMs <= Date.now() + 1000) {
    // niets plannen; dit zou anders "fire now" kunnen geven
    return null;
  }

  return Notifications.scheduleNotificationAsync(req);
}

// ───────────────────────────────────────────────────────────────────────────────
// Kern: plannen dag / week

async function scheduleDaily(settings: Settings, people: Person[], L: Locale) {
  const horizonDays = Platform.OS === 'ios' ? 30 : 60;
  const now = new Date();

  for (let i = 0; i < horizonDays; i++) {
    const day = new Date();
    day.setDate(now.getDate() + i);
    const at = setTimeToDate(day, settings.sameDayHour, settings.sameDayMinute);
    if (at <= now) continue;

    const todays = people.filter(p => {
      const occ = nextOccurrence(p.dateISO, day);
      return occ.getMonth() === day.getMonth()
          && occ.getDate()  === day.getDate()
          && (p.sameDayReminder ?? true);
    });
    if (todays.length === 0) continue;

    const body = buildDailyBody(day, todays, L);
    if (!body) continue;

    await scheduleSafe({
      content: {
        title: L === 'nl' ? 'Vandaag' : 'Today',
        body,
        data: { type: 'daily-reminder', date: at.toISOString(), personIds: todays.map(p => p.id) },
        ...(Platform.OS === 'android' && { android: { channelId: 'daily-reminders' } }),
      },
      // Gebruik een echte Date als trigger (fix voor 'fire now' in SDK 52)
      trigger: at,
    });
  }
}

function nextAnchorForWeekday(weekdaySetting: number, hour: number, minute: number, now = new Date()) {
  // 1..7 (Mon..Sun) → JS 0..6 (Sun..Sat)
  const jsDow = (weekdaySetting % 7); // 0 = Sunday
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  // loop tot we op de gewenste weekday & toekomst zitten
  while (anchor.getDay() !== jsDow || anchor <= now) {
    anchor.setDate(anchor.getDate() + 1);
  }
  return anchor;
}

async function scheduleWeekly(settings: Settings, people: Person[], L: Locale) {
  if (!settings.weeklySummaryEnabled) return;

  const horizonWeeks = Platform.OS === 'ios' ? 8 : 12;
  const now = new Date();
  const first = nextAnchorForWeekday(
    settings.weeklySummaryWeekday,
    settings.weeklySummaryHour,
    settings.weeklySummaryMinute,
    now
  );

  for (let i = 0; i < horizonWeeks; i++) {
    const when = new Date(first.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    if (when <= now) continue;

    const weekStart = new Date(when);
    const weekEnd = new Date(when.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weekEvents = people.filter(p => {
      const { m, d } = parseYmd(p.dateISO);
      const day = new Date(when.getFullYear(), (m ?? 1)-1, d ?? 1, 12, 0, 0, 0);
      return day >= weekStart && day < weekEnd;
    });
    if (weekEvents.length === 0) continue;

    const body = buildWeeklyBody(weekStart, weekEvents, L);
    if (!body) continue;

    await scheduleSafe({
      content: {
        title: L === 'nl' ? 'Overzicht komende week' : 'This week',
        body,
        data: { type: 'weekly-summary', anchor: when.toISOString() },
        ...(Platform.OS === 'android' && { android: { channelId: 'weekly-summary' } }),
      },
      // Fix: Date als trigger (of expliciet type: DATE)
      trigger: when,
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Publieke API

export async function clearAllScheduled() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}

export async function rescheduleAllNotifications(settings: Settings, people: Person[], L: Locale) {
  const ok = await ensureNotifPerms();
  if (!ok) return;

  await ensureAndroidChannels();
  await clearAllScheduled();

  await scheduleWeekly(settings, people, L);
  await scheduleDaily(settings, people, L);
}

// Utility: signature voor idempotent rescheduling vanuit index.tsx
export function buildNotificationSignature(settings: Settings, people: Person[]) {
  const base =
    `${settings.weeklySummaryEnabled}|${settings.weeklySummaryWeekday}|${settings.weeklySummaryHour}|${settings.weeklySummaryMinute}|${settings.sameDayHour}|${settings.sameDayMinute}|${settings.locale}`;
  const ppl = people
    .map(p => `${p.id}|${p.name}|${p.type}|${p.dateISO}|${p.sameDayReminder ? 1 : 0}`)
    .sort()
    .join(';');
  return base + '||' + ppl;
}

// (Optioneel) debughulp
export async function debugScheduledNotifications() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  console.log('[notifications] scheduled count:', all.length);
  for (const n of all) {
    // probeer de volgende trigger te berekenen voor logging
    try {
      const next = await Notifications.getNextTriggerDateAsync(n.trigger as any);
      console.log(' • id:', (n as any).identifier, 'next:', next ? new Date(next).toISOString() : null);
    } catch {
      console.log(' • id:', (n as any).identifier, 'next: (unavailable)');
    }
  }
}
