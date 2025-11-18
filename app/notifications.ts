// notifications.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t, WEEKDAY_ABBR } from './i18n';
import type { Locale, Person, Settings } from './types';

// ───────────────────────────────────────────────────────────────────────────────
// Notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // NB: shouldShowAlert is the main one to show the notification
    shouldPlaySound: true,
    shouldSetBadge: false,

    // these are iOS-specific options
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ───────────────────────────────────────────────────────────────────────────────
// Permissions + Android channels
export async function ensureNotifPerms(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      return req.status === 'granted';
    }
    return true;
  } catch (e) {
    return false;
  }
}

// export Android notification channels
export async function ensureAndroidChannels(L: Locale) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('daily-reminders', {
      name: t(L, 'channelDailyReminders'), // i18n
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('weekly-summary', {
      name: t(L, 'channelWeeklySummary'), // i18n
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
    });
  } catch (e) {
    // swallow
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Date helpers
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

function sanitizeData(obj: any): any {
  if (obj == null) return undefined;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(sanitizeData).filter(v => v !== undefined);
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
      const v = sanitizeData(obj[k]);
      if (v !== undefined) out[k] = v; // skip undefined
    }
    return out;
  }
  if (typeof obj === 'function') return undefined;
  return obj; // string/number/boolean ok
}

// TZ-veilige lokale dag-sleutel (ipv toISOString)
function keyOfLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Inline time field that opens the native time picker and returns new hour/minute
function buildDailyBody(atDate: Date, persons: Person[], L: Locale): string | null {
  if (persons.length === 0) return null;

  const lines = persons.map(p => {
    const emoji = p.type === 'birthday' ? '🎂' : p.type === 'anniversary' ? '💍' : '🎉';
    const yrs = ageOn(p.dateISO, atDate);
    const yrsText = t(L, 'ageYears', { count: yrs }); // i18n met parameter
    return `‣ ${p.name} (${yrsText}) ${emoji}`;
  });
  return `\n${lines.join('\n')}`;
}

function buildWeeklyBody(startDate: Date, people: Person[], L: Locale): string | null {
  if (people.length === 0) return null;

  const byDay: Record<string, Person[]> = {};
  for (const p of people) {
    const { m, d } = parseYmd(p.dateISO);
    const day = new Date(startDate.getFullYear(), (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0); // middernacht
    const key = keyOfLocalDay(day); // ✅ lokale key
    (byDay[key] ??= []).push(p);
  }

  const dayAbbr = WEEKDAY_ABBR[L];

  const lines: string[] = [];
  Object.keys(byDay).sort().forEach(key => {
    const [yy, mm, dd] = key.split('-').map(Number);
    const day = new Date(yy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0, 0);
    const dn = dayAbbr[day.getDay()]; // 0..6 (JS)

    const shortMonth = (day.toLocaleDateString(L === 'nl' ? 'nl-NL' : L === 'de' ? 'de-DE' : 'en-US', { month: 'short' }) || '')
      .replace(/\.$/, '');

    const monthPart = L === 'nl' ? `${day.getDate()} ${shortMonth}` : `${shortMonth} ${day.getDate()}`;

    const peopleTxt = byDay[key].map(p => {
      const emoji = p.type === 'birthday' ? '🎂' : p.type === 'anniversary' ? '💍' : '🎉';
      const yrs = ageOn(p.dateISO, day);
      const yrsText = t(L, 'ageYears', { count: yrs });
      return `‣ ${p.name} (${yrsText}) ${emoji}`;
    }).join(', ');

    lines.push(`${dn} ${monthPart}: ${peopleTxt}`);
  });

  return `\n${lines.join('\n')}`;
}


// ───────────────────────────────────────────────────────────────────────────────
// safe schedule wrapper (for Android trigger normalization)
async function scheduleSafe(req: Notifications.NotificationRequestInput) {
  const orig = req.trigger as Notifications.SchedulableNotificationTriggerInput | Date | number | any;

  // calculate millis
  let millis: number | null = null;
  if (orig instanceof Date) millis = orig.getTime();
  else if (typeof orig === 'number') millis = orig;
  else if (orig && typeof orig === 'object' && 'date' in orig) {
    const d = (orig as any).date;
    millis = d instanceof Date ? d.getTime() : (typeof d === 'number' ? d : null);
  }

  // channel hint   
  const hintedChannel =
    (req.content as any)?.android?.channelId ??
    (req as any)?.android?.channelId ??
    undefined;

  // trigger normalization
  let normalizedTrigger: Notifications.SchedulableNotificationTriggerInput | Date | number = orig;
  if (Platform.OS === 'android') {
    if (typeof millis === 'number' && Number.isFinite(millis)) {
      const origObj = (orig && typeof orig === 'object') ? orig as any : {};
      normalizedTrigger = {
        // keep other properties
        ...origObj,
        // force type = DATE
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        // force date = millis
        date: Math.floor(millis),
        // if no channelId yet, use hintedChannel (indirect via content or req)
        ...(origObj.channelId ? {} :
          (hintedChannel ? { channelId: hintedChannel } : {})),
      } as Notifications.DateTriggerInput;
    } else {
      return null;
    }
  } else {
    normalizedTrigger = (typeof millis === 'number' ? new Date(millis) : orig);
  }

  // clean content (remove channelId from content)
  const cleanedContent: Notifications.NotificationContentInput = (() => {
    const c: any = { ...req.content };
    if (c?.android?.channelId) {
      c.android = { ...c.android };
      delete c.android.channelId; 
    }
    if ('data' in c) c.data = sanitizeData(c.data);
    return c;
  })();

  try {
    const id = await Notifications.scheduleNotificationAsync({
      ...req,
      content: cleanedContent,
      trigger: normalizedTrigger,
    });
    return id;
  } catch (e) {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Planning routines
async function scheduleDaily(settings: Settings, people: Person[], L: Locale) {
  const horizonDays = Platform.OS === 'ios' ? 30 : 60;
  const now = new Date();

  for (let i = 0; i < horizonDays; i++) {
    const day = new Date();
    day.setDate(now.getDate() + i);
    const at = setTimeToDate(day, settings.sameDayHour, settings.sameDayMinute);
    if (at <= now) {
      continue;
    }

    const todays = people.filter(p => {
      const occ = nextOccurrence(p.dateISO, day);
      return occ.getMonth() === day.getMonth()
          && occ.getDate()  === day.getDate()
          && (p.sameDayReminder ?? true);
    });

    if (todays.length === 0) continue;

    const body = buildDailyBody(day, todays, L);
    if (!body) {
      continue;
    }

    const id = await scheduleSafe({
      content: {
        title: t(L, 'notifDailyTitle'),
        body,
      },
      trigger: Platform.OS === 'android'
        ? ({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: at.getTime(),
            channelId: 'daily-reminders',
          } as Notifications.DateTriggerInput)
        : at,
    });

    if (!id) {
      // swallow
    }
  }
}

function settingsWeekdayToMon0(settingsWeekday: number): number {
  // change sun=1, mon=2, ... sat=7 om naar Mon0: mon=0..sun=6
  // Formulas : (1 + 5) % 7 = 6 (sun)
  // (2 + 5) % 7 = 0 (mon)
  // (3 + 5) % 7 = 1 (tue)
  // ...
  return (settingsWeekday + 5) % 7;
}

function nextAnchorForWeekdayMon0(
  weekdayMon0: number,  // 0=ma..6=zo
  hour: number,
  minute: number,
  now = new Date()
) {
  // Mon0 → JS getDay() (0=zo..6=za)
  const targetJs = (weekdayMon0 + 1) % 7;

  const todayJs = now.getDay();

  const todayAt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );

  // How many days ahead is the target weekday?
  let daysAhead = (targetJs - todayJs + 7) % 7;

  // if today is the day, but time has passed, go to next week
  if (daysAhead === 0 && todayAt <= now) {
    daysAhead = 7;
  }

  const anchor = new Date(todayAt);
  anchor.setDate(anchor.getDate() + daysAhead);
  return anchor;
}

async function scheduleWeekly(settings: Settings, people: Person[], L: Locale) {
  const horizonWeeks = Platform.OS === 'ios' ? 8 : 12;
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const weekdayMon0 = settingsWeekdayToMon0(settings.weeklySummaryWeekday);

  const first = nextAnchorForWeekdayMon0(
    weekdayMon0,
    settings.weeklySummaryHour,
    settings.weeklySummaryMinute,
    now
  );

  for (let i = 0; i < horizonWeeks; i++) {
    const when = new Date(first.getTime() + i * DAY * 7);
    if (when <= now) continue;

    // days in the week starting from 'when'
    const weekStart = new Date(
      when.getFullYear(),
      when.getMonth(),
      when.getDate() + 1,
      0,
      0,
      0,
      0
    );
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY);

    const weekEvents = people.filter((p) => {
      const { m, d } = parseYmd(p.dateISO);
      const dayLocalMidnight = new Date(
        when.getFullYear(),
        (m ?? 1) - 1,
        d ?? 1,
        0,
        0,
        0,
        0
      );
      return dayLocalMidnight >= weekStart && dayLocalMidnight < weekEnd;
    });

    if (weekEvents.length === 0) continue;

    const body = buildWeeklyBody(weekStart, weekEvents, L);
    if (!body) continue;

    // Simple debug per ingeplande weekly
    //console.log(
    //  `-TRIGGER: weekdaySetting=${settings.weeklySummaryWeekday} weekdayMon0=${weekdayMon0} hour=${settings.weeklySummaryHour} min=${settings.weeklySummaryMinute} now=${now.toISOString()} first=${first.toISOString()} when=${when.toISOString()} body=${body}`
    //);

    const id = await scheduleSafe({
      content: { title: t(L, 'notifWeeklyTitle'), body },
      trigger:
        Platform.OS === 'android'
          ? ({
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: when,
              channelId: 'weekly-summary',
            } as Notifications.DateTriggerInput)
          : when,
    });

    if (!id) {
      /* swallow */
    }
  }
}

// Public routines
export async function clearAllScheduled() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    // swallow
  }
}

export async function rescheduleAllNotifications(settings: Settings, people: Person[], L: Locale) {
  const ok = await ensureNotifPerms();
  if (!ok) {
    return;
  }

  await ensureAndroidChannels(settings.locale);

  await clearAllScheduled();

  try {
    await scheduleWeekly(settings, people, L);
    await scheduleDaily(settings, people, L);
  } catch (e: unknown) {
    // swallow
  }
}

// Utility: signature for current notification setup
export function buildNotificationSignature(settings: Settings, people: Person[]) {
  const base =
    `${settings.weeklySummaryEnabled}|${settings.weeklySummaryWeekday}|${settings.weeklySummaryHour}|${settings.weeklySummaryMinute}|${settings.sameDayHour}|${settings.sameDayMinute}|${settings.locale}`;
  const ppl = people
    .map(p => `${p.id}|${p.name}|${p.type}|${p.dateISO}|${p.sameDayReminder ? 1 : 0}`)
    .sort()
    .join(';');
  return base + '||' + ppl;
}
