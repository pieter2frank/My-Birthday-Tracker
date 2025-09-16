import { FontAwesome, Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  isSameDay,
  isWithinInterval,
  startOfDay
} from 'date-fns';

import * as Application from 'expo-application';
import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme
} from 'react-native';
import {
  buildNotificationSignature,
  ensureAndroidChannels, // optioneel als je dit expliciet hier nog wilt aanroepen
  ensureNotifPerms,
  rescheduleAllNotifications
} from './notifications';
// ---- SAFE STORAGE LAYER (MMKV + fallback to AsyncStorage) ----
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';


// Splash auto-hide uitzetten: we verbergen handmatig als de UI klaar is
SplashScreen.preventAutoHideAsync().catch(() => {});

// ============== Types ==============
export type EventType = 'birthday' | 'anniversary' | 'other';
export type Person = {
  id: string;
  name: string;
  type: EventType;
  dateISO: string;       // YYYY-MM-DD
  label?: string;
  sameDayReminder?: boolean;
};
export type SortMode = 'next' | 'name';
export type FilterType = 'all' | EventType;
export type Locale = 'nl' | 'en';

export type Settings = {
  weeklySummaryEnabled: boolean;
  weeklySummaryWeekday: number; // 1=Mon..7=Sun
  weeklySummaryHour: number;
  weeklySummaryMinute: number;
  sameDayHour: number;
  sameDayMinute: number;
  locale: Locale;
  search: string;
  filterType: FilterType;
  sortMode: SortMode;
  themeMode: 'system' | 'dark' | 'light';
};

type UpcomingItem = {
  when: Date;
  person: Person;
};

type KV = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
};

let storage: KV;

try {
  // Probeer MMKV (snelste, beste optie)
  const mmkv = new MMKV();
  storage = {
    getString: (k) => mmkv.getString(k),
    set: (k, v) => mmkv.set(k, v),
    delete: (k) => mmkv.delete(k),
  };
  console.log('Storage: MMKV actief');
} catch (e) {
  // Fallback naar AsyncStorage
  console.log('MMKV init failed → fallback naar AsyncStorage', String(e));
  storage = {
    getString: (k) => {
      // AsyncStorage is async → maar we geven sync-achtige wrapper terug
      // => let op: initial load moet via getJSONAsync
      console.warn('Gebruik getJSONAsync voor AsyncStorage keys');
      return undefined;
    },
    set: (k, v) => { AsyncStorage.setItem(k, v); },
    delete: (k) => { AsyncStorage.removeItem(k); },
  };
}

// Synchronous helpers (werken goed met MMKV, limited met AsyncStorage)
export const getItem = (k: string) => storage.getString(k) ?? null;
export const setItem = (k: string, v: string) => storage.set(k, v);
export const removeItem = (k: string) => storage.delete(k);

// JSON helpers
export function getJSON<T>(k: string): T | null {
  const s = getItem(k);
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}
export function setJSON<T>(k: string, v: T) {
  setItem(k, JSON.stringify(v));
}

// --- Extra: async versie voor als fallback AsyncStorage actief is ---
export async function getJSONAsync<T>(k: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// ============== i18n ==============
const STR: Record<Locale, Record<string, any>> = {
  nl: {
    title: 'My Birthday Tracker',
    addPerson: 'Voeg persoon toe',
    csvExport: 'Export',
    csvImport: 'Import',
    openSettings: 'Settings',
    info: 'Info',
    today: 'Vandaag',
    thisWeek: 'Deze week',
    everyone: 'Iedereen',
    noneToday: 'Geen verjaardagen of gebeurtenissen vandaag.',
    noneWeek: 'Geen verjaardagen/gebeurtenissen deze week.',
    noneAll: 'Nog niemand toegevoegd. Tik op + Persoon om te beginnen.',
    search: 'Zoek…',
    all: 'Alle',
    birthday: 'Verjaardag',
    anniversary: 'Huwelijk',
    other: 'Overig',
    sortBy: 'Sorteren:',
    next: 'Eerstvolgende',
    nameSort: 'Naam',
    settings: 'Instellingen',
    weeklySummary: 'Wekelijkse samenvatting',
    weekday: 'Weekdag',
    time: 'Tijd weekmelding',
    daytime: 'Tijd dagmelding',
    language: 'Taal',
    nl: 'NL',
    en: 'EN',
    nameLabel: 'Naam',
    typeLabel: 'Type',
    labelLabel: 'Label (overig)',
    dateLabel: 'Datum',
    sameDay: 'Melding op de dag zelf',
    save: 'Opslaan',
    cancel: 'Annuleren',
    close: 'Sluiten',
    edit: 'Bewerken',
    delete: 'Verwijderen',
    share: 'Deel',
    confirmDeleteTitle: 'Verwijderen',
    confirmDeleteMsg: (name: string) => `Weet je zeker dat je ${name} wilt verwijderen?`,
    aboutApp: 'Over deze app',
    aboutAppText:
      'My Birthday Tracker: Always remember every special day.\n\nDeze app helpt je bij het bijhouden van verjaardagen, huwelijksjubilea en andere speciale momenten. Je kan direct vanuit de app een WhatsApp aanmaken. De app is simpel en basic zonder overbodige functionaliteiten en doet precies wat hij moet doen: jou herinneren aan die ene speciale dag van een ander.\n\nGoed om te weten: jouw data staan lokaal op jouw telefoon, dus we kunnen ze nooit met andere delen. Dat willen we niet eens!\n\nTips: zet notificaties aan, maak regelmatig een backup (export).',
    website: 'Website',
    websiteUrl: 'https://mybirthdaytracker.app',
    version: 'Versie',
    coffee:
      'Ben je tevreden over deze app, steun mij met een kleine donatie voor een kop koffie (of een flat white 😍)',
    coffeeWebsite: 'https://buymeacoffee.com/mybirthdaytracker',
    theme: 'Thema',
    themeSystem: 'Systeem',
    themeDark: 'Donker',
    themeLight: 'Licht',
    everyoneWithCount: "Iedereen (van de {count} jubilea in de app)",
    coffeeFooter: 'Ben je blij met deze app, trakteer me op een koffie ☕',
    coffeeTitle: '☕ Trakteer op koffie',
    csvExportDialog: 'CSV exporteren',
    csvImported: 'CSV geïmporteerd',
    csvHeaderInvalid: 'CSV-header ongeldig',
    shareBirthdayToday: 'Van harte gefeliciteerd met je verjaardag🎂🥳🎈!!',
    shareAnniversaryToday: (yrs: number) => `Van harte met jullie ${yrs} jarig huwelijk🎂🥳🎈!!`,
    weeklyTitle: 'Overzicht jubilea komende week 🎈',
    whatsappSend: 'WhatsApp-bericht sturen',
  },
  en: {
    title: 'My Birthday Tracker',
    addPerson: 'Add Person',
    csvExport: 'Export',
    csvImport: 'Import',
    openSettings: 'Settings',
    info: 'Info',
    today: 'Today',
    thisWeek: 'This week',
    everyone: 'All',
    noneToday: 'No birthdays or events today.',
    noneWeek: 'No birthdays/events this week.',
    noneAll: 'No one added yet. Tap + Person to start.',
    search: 'Search…',
    all: 'All',
    birthday: 'Birthday',
    anniversary: 'Anniversary',
    other: 'Other',
    sortBy: 'Sort by:',
    next: 'Next up',
    nameSort: 'Name',
    settings: 'Settings',
    weeklySummary: 'Weekly summary',
    weekday: 'Weekday',
    time: 'Time weekly summary',
    daytime: 'Time daily notification',
    language: 'Language',
    nl: 'NL',
    en: 'EN',
    nameLabel: 'Name',
    typeLabel: 'Type',
    labelLabel: 'Label (other)',
    dateLabel: 'Date',
    sameDay: 'Same-day reminder',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    delete: 'Delete',
    share: 'Share',
    confirmDeleteTitle: 'Delete',
    confirmDeleteMsg: (name: string) => `Are you sure you want to delete ${name}?`,
    aboutApp: 'About this app',
    aboutAppText:
      'My Birthday Tracker: Always remember every special day.\n\nThis app helps you track birthdays, anniversaries and other special events. You can instantly create a WhatsApp message from the app. The app is simple and basic without unnecessary features and does exactly what it should: remind you of that one special day of someone else.\n\nNo worries—your data never leaves your phone 📱. It stays local, private, and just for you. We couldn’t share it with anyone else—even if we wanted to (and we don’t)!\n\nTips: enable notifications, make regular backups (export).',
    website: 'Website',
    websiteUrl: 'https://mybirthdaytracker.app',
    version: 'Version',
    coffee:
      'Are you happy with this app? Support me with a small donation for a cup of coffee (or a flat white 😍)',
    coffeeWebsite: 'https://buymeacoffee.com/mybirthdaytracker',
    theme: 'Theme',
    themeSystem: 'System',
    themeDark: 'Dark',
    themeLight: 'Light',
    everyoneWithCount: "Everyone (of the {count} anniversaries in the app)",
    coffeeFooter: 'Are you happy with this app, buy me a coffee ☕',
    coffeeTitle: '☕ Buy me a coffee',
    csvExportDialog: 'Export CSV',
    csvImported: 'CSV imported',
    csvHeaderInvalid: 'CSV header invalid',
    shareBirthdayToday: 'Happy birthday🎂🥳🎈!!',
    shareAnniversaryToday: (yrs: number) => `Congrats on your ${yrs}-year wedding anniversary🎂🥳🎈!!`,
    weeklyTitle: 'Celebrations for this week 🎈',
    whatsappSend: 'Send WhatsApp message',
  },
};
const t = (L: Locale, k: string, ...a: any[]) =>
  (typeof STR[L][k] === 'function' ? STR[L][k](...a) : STR[L][k]) ?? k;

const WEEKDAY_ABBR: Record<Locale, string[]> = {
  nl: ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

// ============== Storage Keys ==============
const K_PEOPLE = 'people.v5';
const K_SETTINGS = 'settings.v5';
const K_WEEKLY_ID = 'weekly_notif_id';
const K_PERSON_IDS = 'person_notif_ids'; // map personId->notifId

const appVersion = Application?.nativeApplicationVersion ?? '1.0.0';

// ============== Theme Palette ==============
const THEME = {
  dark: {
    bg: '#0f172a',
    cardBg: 'rgba(255,255,255,0.04)',
    cardBorder: 'rgba(255,255,255,0.10)',
    text: 'white',
    textDim: '#cbd5e1',
    textMuted: '#9ca3af',
    pillBg: 'rgba(255,255,255,0.04)',
    pillBorder: 'rgba(255,255,255,0.18)',
    pillActiveBg: 'rgba(34,197,94,0.12)',
    pillActiveBorder: 'rgba(34,197,94,0.45)',
    inputBg: 'rgba(255,255,255,0.08)',
    inputBorder: 'rgba(255,255,255,0.14)',
    filterBg: 'rgba(255,255,255,0.06)',
    filterBorder: 'rgba(255,255,255,0.08)',
    bottomBarBg: 'rgba(15,23,42,0.96)',
    bottomBarBorder: 'rgba(255,255,255,0.08)',
    btnBg: 'rgba(255,255,255,0.06)',
    btnBorder: 'rgba(255,255,255,0.16)',
    link: '#25D366',
    accent: '#22c55e',
    modalBg: '#0b1224',
    modalBorder: 'rgba(255,255,255,0.10)',
    placeholder: '#94a3b8',
    highlightTodayBg: 'rgba(37,211,102,0.08)',
    highlightTodayBorder: 'rgba(37,211,102,0.35)',
    switchTrackOff: 'rgba(255,255,255,0.15)',
    switchTrackOn: 'rgba(34,197,94,0.55)',
    switchDot: '#FFFFFF',
    switchDotBorder: 'rgba(255,255,255,0.28)',
  },
  light: {
    bg: '#f8fafc',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    text: '#0f172a',
    textDim: '#334155',
    textMuted: '#64748b',
    pillBg: '#f1f5f9',
    pillBorder: '#e2e8f0',
    pillActiveBg: 'rgba(34,197,94,0.14)',
    pillActiveBorder: 'rgba(34,197,94,0.55)',
    inputBg: '#ffffff',
    inputBorder: '#e2e8f0',
    filterBg: '#ffffff',
    filterBorder: '#e2e8f0',
    bottomBarBg: 'rgba(255,255,255,0.96)',
    bottomBarBorder: '#e2e8f0',
    btnBg: '#ffffff',
    btnBorder: '#e2e8f0',
    link: '#16a34a',
    accent: '#22c55e',
    modalBg: '#ffffff',
    modalBorder: '#e2e8f0',
    placeholder: '#94a3b8',
    highlightTodayBg: 'rgba(34,197,94,0.10)',
    highlightTodayBorder: 'rgba(34,197,94,0.40)',
    switchTrackOff: '#e5e7eb',
    switchTrackOn: '#22c55e',
    switchDot: '#FFFFFF',
    switchDotBorder: 'rgba(0,0,0,0.15)'
  },
} as const;

type ThemeColors = typeof THEME.dark;

type PersonRowProps = {
  p: Person;
  mode: 'upcoming' | 'current';
  showShareTodayBirthday?: boolean;
  onEdit: (p: Person) => void;   // ← was () => void
  onDelete: (p: Person) => void; // ← was () => void
};


// ============== Helpers ==============
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const ymdToDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

// Parse zonder Date (voorkomt pre-1970 verschuivingen)
function parseYmd(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

// Voor pickers: lokale datum op 12:00 om DST-midnight issues te vermijden
function ymdToLocalNoonDate(iso: string) {
  const { y, m, d } = parseYmd(iso);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function ageOn(iso: string, at: Date) {
  const { y, m, d } = parseYmd(iso);
  let age = at.getFullYear() - y;
  const hadBirthday =
    (at.getMonth() + 1 > m) || ((at.getMonth() + 1 === m) && (at.getDate() >= d));
  if (!hadBirthday) age--;
  return Math.max(0, age);
}

function nextOccurrence(iso: string, ref = new Date()) {
  const { m, d } = parseYmd(iso);
  const thisYear = new Date(ref.getFullYear(), (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
  return thisYear >= startOfDay(ref)
    ? thisYear
    : new Date(ref.getFullYear() + 1, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function agePhrase(L: Locale, yrs: number, mode: 'upcoming'|'current', type: EventType) {
  if (type === 'birthday') {
    if (L === 'nl') return mode === 'upcoming' ? `wordt ${yrs} jaar` : `is ${yrs} jaar`;
    return mode === 'upcoming' ? `turns ${yrs}` : `is ${yrs} years`;
  }
  if (L === 'nl') return `${yrs} jaar`;
  return `${yrs} years`;
}

// "25 augustus" / "August 25"
export function formatDM_localized(iso: string, L: Locale) {
  const { m, d } = parseYmd(iso);
  const locale = L === 'nl' ? 'nl-NL' : 'en-US';
  const fake = new Date(Date.UTC(2000, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(fake);
}

// "25 augustus 1961" / "August 25, 1961"
export function formatDMY_localized(iso: string, L: Locale) {
  const { y, m, d } = parseYmd(iso);
  const locale = L === 'nl' ? 'nl-NL' : 'en-US';
  const fake = new Date(Date.UTC(2000, (m ?? 1) - 1, d ?? 1));
  const month = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(fake);
  return L === 'nl' ? `${d} ${month} ${y}` : `${month} ${d}, ${y}`;
}

function formatDM(iso: string, L: Locale) {
  return formatDM_localized(iso, L);
}

function firstFutureFireFor(iso: string, hour: number, minute: number, now = new Date()) {
  const { y, m, d } = parseYmd(iso);
  // Neem dit jaar dezelfde maand/dag om HH:MM
  let fire = new Date(now.getFullYear(), (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0);
  // Als dat moment al voorbij is (incl. exact gelijke tijd → verplaats naar volgend jaar)
  if (fire <= now) {
    fire = new Date(now.getFullYear() + 1, (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0);
  }
  return fire;
}

// ============== Debugger function ==============

async function debugScheduledNotifications() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    console.log('[DEBUG] Aantal geplande notificaties:', scheduled.length);
    
    scheduled.forEach((notif, index) => {
      const triggerDate = (notif.trigger && 'date' in notif.trigger) 
        ? new Date(notif.trigger.date as number) 
        : null;
      console.log(`[DEBUG] Notificatie ${index + 1}:`, {
        title: notif.content.title,
        body: notif.content.body,
        triggerDate: triggerDate?.toLocaleString('nl-NL'),
        isFuture: triggerDate ? triggerDate > new Date() : false
      });
    });
  } catch (error) {
    console.error('Error debugging notifications:', error);
  }
}

// ============== CSV ==============
const CSV_HEADER = 'id,name,type,dateISO,label,sameDayReminder';
const csvEsc = (s?: string) =>
  `"${(s ?? '').toString().replace(/"/g, '""')}"`;
function toCSVRow(p: Person) {
  return [p.id, csvEsc(p.name), p.type, p.dateISO, csvEsc(p.label), p.sameDayReminder ? 'true' : 'false'].join(',');
}
function parseCSV(text: string): Person[] {
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

// ============== Dynamic Styles ==============
function createStyles(C: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg },
    topBar: { paddingHorizontal: 16, paddingTop: 34, paddingBottom: 8 },
    h1: { color: C.text, fontSize: 24, fontWeight: '800' },
    h2: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 16, marginHorizontal: 16, marginBottom: 8 },
    h3: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },

    filterBar: {
      backgroundColor: C.filterBg,
      borderRadius: 16,
      padding: 12,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.filterBorder,
    },
    searchInput: {
      backgroundColor: C.inputBg,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: C.text,
      borderWidth: 1,
      borderColor: C.inputBorder,
      flex: 1,
      paddingRight: 30, // ruimte voor het kruisje
    },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' },
    filterLabel: { color: C.textDim },

    pill: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      borderWidth: 1, borderColor: C.pillBorder, backgroundColor: C.pillBg,
    },
    pillSm: {
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
      borderWidth: 1, borderColor: C.pillBorder, backgroundColor: C.pillBg,
    },
    pillActive: { borderColor: C.pillActiveBorder, backgroundColor: C.pillActiveBg },
    pillText: { color: C.textDim, fontWeight: '600' },
    pillTextSm: { color: C.textDim },
    pillTextActive: { color: C.text },

    personRow: {
      marginHorizontal: 16,
      marginBottom: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.cardBorder,
      backgroundColor: C.cardBg,
      // let op: géén overflow hier
      padding: 0, // padding verhuist naar rowClip
    },

    rowClip: {
      borderRadius: 14,
      overflow: 'hidden',     // => clip aan afgeronde hoeken
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      position: 'relative',
    },
    personName: { color: C.text, fontSize: 16, fontWeight: '700' },
    personSub: { color: C.textDim },

    rowToday: {
      backgroundColor: C.highlightTodayBg,
      borderColor: C.highlightTodayBorder,
    },
    todayStripe: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 6,
      backgroundColor: '#25D366',
    },
    rowNameToday: { fontWeight: '700' },
    rowSubtitleToday: { opacity: 0.95 },

    rowActions: { flexDirection: 'row', alignItems: 'center' },
    iconBtn: {
      width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
      borderRadius: 10, marginLeft: 8, backgroundColor: C.btnBg,
      borderWidth: 1, borderColor: C.btnBorder,
    },
    rowBtn: {
      borderWidth: 1, borderColor: C.btnBorder, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10,
      backgroundColor: C.btnBg,
    },
    rowBtnText: { color: C.text, fontWeight: '700' },
    empty: { color: C.textMuted, marginHorizontal: 16, marginBottom: 6 },

    settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
    settingLabel: { color: C.text, fontWeight: '700' },
    numInput: {
      width: 56, paddingVertical: 8, paddingHorizontal: 10,
      borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder,
      color: C.text, backgroundColor: C.inputBg, textAlign: 'center'
    },
    timeBtn: {
      backgroundColor: C.inputBg,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: C.inputBorder,
    },
    timeBtnText: { color: C.text, fontWeight: '600' },

    switchBtn: {
      width: 52,
      height: 30,
      borderRadius: 999,
      padding: 3,
      justifyContent: 'center',
      backgroundColor: C.switchTrackOff,  // ← off track
      borderWidth: 1,
      borderColor: C.btnBorder,           // subtiele rand in beide thema’s
    },
    switchOn: {
      backgroundColor: C.switchTrackOn,   // ← on track
      borderColor: 'transparent',
    },
    switchDot: {
      width: 24,
      height: 24,
      borderRadius: 999,
      backgroundColor: C.switchDot,       // witte dot
      borderWidth: 1,
      borderColor: C.switchDotBorder,     // dun randje voor zichtbaarheid in light
      transform: [{ translateX: 0 }],
      // optioneel: subtiele schaduw zodat de dot loskomt:
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    switchDotOn: { transform: [{ translateX: 22 }] },

    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.bottomBarBg, borderTopWidth: 1, borderTopColor: C.bottomBarBorder },
    bottomActions: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    bottomBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.btnBorder, backgroundColor: C.btnBg },
    bottomBtnAccent: { backgroundColor: C.accent, borderColor: C.accent },
    bottomBtnText: { color: C.text, fontWeight: '700', textAlign: 'center' },

    modalBackdrop: {
      ...StyleSheet.absoluteFillObject, // ← vult hele scherm, ook achter statusbar
      justifyContent: 'center',
      padding: 16,
      backgroundColor: 'rgba(0,0,0,0.35)', // extra dim bovenop blur
    },
    modalCard: {
      borderRadius: 18,
      backgroundColor: C.modalBg,
      borderWidth: 1,
      borderColor: C.modalBorder,
      padding: 16,
    },

    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    titleIcon: { height: 24, width: 24 },

    modalCloseBtn: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.btnBg, borderWidth: 1, borderColor: C.btnBorder, flexGrow: 0, flexShrink: 0 },
    modalCloseText: { color: C.text, fontWeight: '700', textAlign: 'center' },

    inputLabel: {
    color: C.text,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: C.inputBg,
    borderColor: C.inputBorder,
    color: C.text,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  weekdaySection: { marginTop: 10},
  weekdayRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',   // 1 regel
    gap: 8,               // tussenruimte (RN 0.71+)
    alignItems: 'center',
    marginTop: 10
  },
  weekdayCell: {
    flex: 1,              // ← verdeel gelijk over 7
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,          // laat flex mogen krimpen
  },
  weekdayCellText: { fontWeight: '600', fontSize: 16 },

  footerLink: {
    textAlign: 'center',
    fontSize: 12,
    color: C.link,
    marginTop: 8,
    textDecorationLine: 'none',
    marginBottom: 10,
  }

  });
}

function toISODateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Debounced effect utility
function useDebouncedEffect(effect: () => void, deps: any[], delay = 200) {
  React.useEffect(() => {
    const t = setTimeout(effect, delay);
    return () => clearTimeout(t);
  }, deps);
}

// TimePickerButton (moved out)
function TimePickerButton({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const value = new Date();
  value.setHours(hour, minute, 0, 0);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>
          {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
        </Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={value}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(ev, date) => {
            setOpen(false);
            if (!date) return;
            onChange(date.getHours(), date.getMinutes());
          }}
        />
      )}
    </View>
  );
}

// DatePickerField (moved out)
function DatePickerField({
  valueISO,
  onChange,
  styles,
}: {
  valueISO: string;
  onChange: (iso: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const [open, setOpen] = React.useState(false);
  const d = ymdToLocalNoonDate(valueISO);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.timeBtn, { opacity: pressed ? 0.6 : 1 }]}>
        <Text style={styles.timeBtnText}>{toISODateLocal(d)}</Text>
      </Pressable>

      {open && (
        <DateTimePicker
          value={d}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(ev, date) => {
            setOpen(false);
            if (!date) return;
            onChange(toISODateLocal(date));
          }}
        />
      )}
    </View>
  );
}

// Pill (moved out)
function Pill({
  active,
  children,
  onPress,
  small = false,
  styles,
}: {
  active: boolean;
  children: React.ReactNode;
  onPress: () => void;
  small?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={[small ? styles.pillSm : styles.pill, active && styles.pillActive]}>
      <Text style={[small ? styles.pillTextSm : styles.pillText, active && styles.pillTextActive]}>{children}</Text>
    </Pressable>
  );
}

// PersonRow (moved out + explicit props)
const PersonRow = React.memo(function PersonRow({
  p,
  mode,
  showShareTodayBirthday,
  onEdit,
  onDelete,
  L,
  now,
  styles,
}: PersonRowProps & {
  L: Locale;
  now: Date;
  styles: ReturnType<typeof createStyles>;
}) {
  const when = mode === 'upcoming' ? nextOccurrence(p.dateISO, now) : now;
  const yrs = ageOn(p.dateISO, when);
  const phrase = agePhrase(L, yrs, mode, p.type);
  const typeText = p.type === 'other' ? (p.label?.trim() || t(L, 'other')) : t(L, p.type);
  const subtitle = `${formatDM_localized(p.dateISO, L)} • ${phrase} • ${typeText}`;
  const isToday = isSameDay(nextOccurrence(p.dateISO, now), now);

  async function share() {
    let msg: string;
    if (isToday && p.type === 'birthday') {
      msg = t(L, 'shareBirthdayToday');
    } else if (isToday && p.type === 'anniversary') {
      const yrsToday = ageOn(p.dateISO, now);
      msg = t(L, 'shareAnniversaryToday', yrsToday);
    } else {
      msg = `${p.name} — ${subtitle}`;
    }
    try {
      const wa = `whatsapp://send?text=${encodeURIComponent(msg)}`;
      if (await Linking.canOpenURL(wa)) {
        await Linking.openURL(wa);
        return;
      }
    } catch {}
    await Share.share({ message: msg });
  }

  return (
    <View style={[styles.personRow, isToday && styles.rowToday]}>
      <View style={styles.rowClip}>
        {isToday && <View style={styles.todayStripe} />}
        <View style={{ flex: 1 }}>
          <Text style={[styles.personName, isToday && styles.rowNameToday]}>{p.name}</Text>
          <Text style={[styles.personSub, isToday && styles.rowSubtitleToday]}>{subtitle}</Text>
        </View>
        <View style={styles.rowActions}>
          {showShareTodayBirthday && (p.type === 'birthday' || p.type === 'anniversary') && (
            <TouchableOpacity style={styles.rowBtn} onPress={share} accessibilityLabel={t(L, 'whatsappSend')}>
              <FontAwesome name="whatsapp" size={20} color="#25D366" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={() => onEdit(p)}>
            <FontAwesome name="pencil" size={20} color="#FFAD2A" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => onDelete(p)}>
            <FontAwesome name="trash" size={20} color="#cc0000" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// ============== Main ==============
export default function Index() {
  const [people, setPeople] = useState<Person[]>([]);
  const [settings, setSettings] = useState<Settings>({
    weeklySummaryEnabled: true,
    weeklySummaryWeekday: 1,
    weeklySummaryHour: 9,
    weeklySummaryMinute: 0,
    sameDayHour: 9,
    sameDayMinute: 0,
    locale: 'en',
    search: '',
    filterType: 'all',
    sortMode: 'next',
    themeMode: 'system',
  });
  const L = settings.locale;
  const scheme = useColorScheme();
  const effectiveTheme: 'light' | 'dark' = settings.themeMode === 'system' ? (scheme === 'light' ? 'light' : 'dark') : settings.themeMode;
  const C = useMemo<ThemeColors>(() => THEME[effectiveTheme] as ThemeColors, [effectiveTheme]);
  const styles = useMemo(() => createStyles(C), [C]);
  const nowDate = new Date();

  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Force refresh at local midnight so "Today" / "This week" roll over automatically
  const [, forceTick] = React.useState(0);
  React.useEffect(() => {
    const now = new Date();
    const msToMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime() - now.getTime();
    const t = setTimeout(() => {
      forceTick((x) => x + 1);
      const i = setInterval(() => forceTick((x) => x + 1), 24 * 60 * 60 * 1000);
      // @ts-ignore
      t._interval = i;
    }, msToMidnight);
    return () => {
      // @ts-ignore
      if (t._interval) clearInterval(t._interval);
      clearTimeout(t);
    };
  }, []);  

  useEffect(() => {
    (async () => {
      try {
        // ✅ Notificatie-permissies vragen & Android-kanalen
        await ensureNotifPerms();
        await ensureAndroidChannels();

        const ps = getJSON<Person[]>(K_PEOPLE) || await getJSONAsync<Person[]>(K_PEOPLE);
        if (ps) setPeople(ps);

        const st = getJSON<Partial<Settings>>(K_SETTINGS) || await getJSONAsync<Partial<Settings>>(K_SETTINGS);
        if (st) setSettings(s => ({ ...s, ...st }));

        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.error('Fout bij init', e);
      } finally {
        try { 
          await SplashScreen.hideAsync(); } catch {}
      }
      debugScheduledNotifications()
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      console.log('[startup audit] scheduled:', all.map(n => ({
        id: (n as any).identifier,
        trigger: n.trigger,
        title: n.content?.title,
        body: n.content?.body
      })));
    })();
  }, []);


  // Persist
  useDebouncedEffect(() => setJSON(K_PEOPLE, people), [people], 200);
  useDebouncedEffect(() => setJSON(K_SETTINGS, settings), [settings], 200);

  const notifSig = useMemo(
    () => buildNotificationSignature(settings, people),
    [settings, people]
  );

  // Herplan alles bij relevante wijzigingen (kleine debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      rescheduleAllNotifications(settings, people, L).catch(e =>
        console.error('rescheduleAllNotifications error', e)
      );
      // eventueel: debugScheduledNotifications();
    }, 1500);
    return () => clearTimeout(t);
  }, [notifSig]);


  // Cache: eerstvolgende occurrence (epoch ms) per persoon voor deze render
  const nextMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people) {
      m.set(p.id, nextOccurrence(p.dateISO, nowDate).getTime());
    }
    return m;
  }, [people, nowDate]);

  // Derived lists
  const filtered = React.useMemo(() => {
    let arr = people.slice();
    if (settings.search.trim()) {
      const q = settings.search.toLowerCase();
      arr = arr.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (settings.filterType !== 'all') {
      arr = arr.filter((p) => p.type === settings.filterType);
    }
    if (settings.sortMode === 'name') {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      arr.sort((a, b) => {
        const na = nextMap.get(a.id) ?? Number.POSITIVE_INFINITY;
        const nb = nextMap.get(b.id) ?? Number.POSITIVE_INFINITY;
        return na - nb;
      });
    }
    return arr;
  }, [people, settings.search, settings.filterType, settings.sortMode, nextMap]);

  const todayList = filtered.filter((p) => {
    const t = nextMap.get(p.id);
    if (t === undefined) return false;
    const d = new Date(t);
    return isSameDay(d, nowDate);
  });

  // Rollend venster: komende 7 dagen (exclusief vandaag)
  const next7Start = startOfDay(nowDate);
  const next7End = new Date(next7Start);
  next7End.setDate(next7End.getDate() + 7);

  const weekList = filtered.filter((p) => {
    const t = nextMap.get(p.id);
    if (t === undefined) return false;
    const d = new Date(t);
    return isWithinInterval(d, { start: next7Start, end: next7End }) && !isSameDay(d, nowDate);
  });

  function startAdd() {
    setEditingPerson({ id: uuid(), name: '', type: 'birthday', dateISO: toISODateLocal(new Date()), sameDayReminder: true });
  }
  const startEdit = useCallback((p: Person) => {
      // Gebruik hier de state van Stap 1 (editingPerson) voor de beste code
      setEditingPerson({ ...p });
    }, []); // Lege dependency array: deze functie verandert nooit

  function saveEditing() {
    if (!editingPerson || !editingPerson.name.trim()) { /*...*/ return; }
    // ... validatie ...
    setPeople(prev => {
      const i = prev.findIndex(p => p.id === editingPerson.id);
      const copy = prev.slice();
      if (i >= 0) copy[i] = editingPerson; else copy.push(editingPerson);
      return copy;
    });
    setEditingPerson(null); // Dit sluit de modal
  }

  const confirmDelete = useCallback((p: Person) => {
    Alert.alert(
      t(L, 'confirmDeleteTitle'),
      t(L, 'confirmDeleteMsg', p.name),
      [
        { text: t(L, 'cancel'), style: 'cancel' },
        { text: t(L, 'delete'), style: 'destructive', onPress: () => setPeople(prev => prev.filter(x => x.id !== p.id)) },
      ]
    );
  }, [L]); 

  // CSV actions
  async function onExport() {
    const csv = [CSV_HEADER, ...people.map(toCSVRow)].join('\n');
    const uri = FileSystem.cacheDirectory! + 'birthdays.csv';
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: t(L, 'csvExportDialog') });
  }
  async function onImport() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'text/csv', 'application/vnd.ms-excel'] });
    if (res.canceled) return;
    const file = res.assets[0];
    const text = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
    try {
      const rows = parseCSV(text);
      setPeople(prev => {
        const map = new Map<string, Person>();
        prev.forEach(p => map.set(p.id, p));
        rows.forEach(p => map.set(p.id, p));
        return Array.from(map.values());
      });
      Alert.alert(t(L, 'csvImported'));
    } catch (e: any) {
      Alert.alert(e?.message === 'BAD_HEADER' ? t(L, 'csvHeaderInvalid') : String(e));
    }
  }

  type SectionKey = 'today' | 'week' | 'everyone';
  type ListItem =
    | { kind: 'title'; key: string; text: string }
    | { kind: 'empty'; key: string; text: string }
    | { kind: 'person'; key: string; section: SectionKey; person: Person };

  const totalJubilea = people.length;

  const listData: ListItem[] = useMemo(() => {
    const d: ListItem[] = [];

    // Vandaag
    d.push({ kind: 'title', key: 'title:today', text: t(L, 'today') });
    if (todayList.length === 0) {
      d.push({ kind: 'empty', key: 'empty:today', text: t(L, 'noneToday') });
    } else {
      todayList.forEach(p =>
        d.push({ kind: 'person', key: `p:today:${p.id}`, section: 'today', person: p })
      );
    }

    // Deze week
    d.push({ kind: 'title', key: 'title:week', text: t(L, 'thisWeek') });
    if (weekList.length === 0) {
      d.push({ kind: 'empty', key: 'empty:week', text: t(L, 'noneWeek') });
    } else {
      weekList.forEach(p =>
        d.push({ kind: 'person', key: `p:week:${p.id}`, section: 'week', person: p })
      );
    }

    // Iedereen (met teller)
    d.push({
      kind: 'title',
      key: 'title:everyone',
      text: STR[L].everyoneWithCount.replace('{count}', totalJubilea.toString()),
    });
    if (filtered.length === 0) {
      d.push({ kind: 'empty', key: 'empty:everyone', text: t(L, 'noneAll') });
    } else {
      filtered.forEach(p =>
        d.push({ kind: 'person', key: `p:all:${p.id}`, section: 'everyone', person: p })
      );
    }

    return d;
  }, [L, todayList, weekList, filtered, totalJubilea]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ListItem>) => {
    if (item.kind === 'title') return <Text style={styles.h2}>{item.text}</Text>;
    if (item.kind === 'empty') return <Text style={styles.empty}>{item.text}</Text>;

    // person
    const p = item.person;
    const showShareTodayBirthday =
      item.section === 'today' && (p.type === 'birthday' || p.type === 'anniversary');

    return (
      <PersonRow
        p={p}
        mode={item.section === 'today' ? 'current' : 'upcoming'}
        L={L}
        now={nowDate /* of jouw 'nu' variabele */}
        styles={styles}
        showShareTodayBirthday={showShareTodayBirthday}
        onEdit={startEdit}
        onDelete={confirmDelete}
      />
    );
  }, [L, styles, startEdit, confirmDelete, nowDate]);

  // Helpt FlashList betere recycling te doen
  const getItemType = useCallback((item: ListItem) => (
    item.kind === 'person' ? 'row' : item.kind
  ), []);

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style={effectiveTheme === 'light' ? 'dark' : 'light'} />

      {/* Titel */}
      <View style={styles.topBar}>
        <View style={styles.titleRow}>
          <Image source={require('../assets/images/icon-birthday.png')} style={styles.titleIcon} resizeMode="contain" />
          <Text style={styles.h1}>{t(L, 'title')}</Text>
        </View>
      </View>

      {/* Build list with Flashlist for speed in app */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlashList<ListItem>
          data={listData}
          renderItem={renderItem}
          keyExtractor={(it) => it.key}
          getItemType={getItemType}
          estimatedItemSize={84}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListHeaderComponent={
            <View style={styles.filterBar}>
              {/* Zoekbalk met kruisje rechts erin */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.inputBg,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: C.inputBorder,
                }}
              >
                <TextInput
                  placeholder={t(L, 'search')}
                  placeholderTextColor={C.placeholder}
                  value={settings.search}
                  onChangeText={(v) => setSettings((s) => ({ ...s, search: v }))}
                  style={{
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: C.text,
                  }}
                />
                {settings.search.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSettings((s) => ({ ...s, search: '' }))}
                    style={{ paddingHorizontal: 8 }}
                  >
                    <Ionicons name="close-circle" size={20} color={C.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Filter pills */}
              <View style={styles.filterRow}>
                {(['all', 'birthday', 'anniversary', 'other'] as const).map((ft) => (
                  <Pill
                    key={ft}
                    active={settings.filterType === ft}
                    onPress={() => setSettings((s) => ({ ...s, filterType: ft }))}
                    styles={styles}
                  >
                    {ft === 'all' ? t(L, 'all') : t(L, ft)}
                  </Pill>
                ))}
              </View>

              {/* Sort pills */}
              <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>{t(L, 'sortBy')}</Text>
                {(['next', 'name'] as const).map((sm) => (
                  <Pill
                    key={sm}
                    small
                    active={settings.sortMode === sm}
                    onPress={() => setSettings((s) => ({ ...s, sortMode: sm }))}
                    styles={styles}
                  >
                    {sm === 'next' ? t(L, 'next') : t(L, 'nameSort')}
                  </Pill>
                ))}
              </View>
            </View>
          }
        />
      </KeyboardAvoidingView>

      {/* Bottombar buttons */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomActions}>
          <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnAccent]} onPress={startAdd}>
            <Ionicons name="person-add" size={22} color={effectiveTheme === 'light' ? 'white' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={onExport}>
            <Text style={styles.bottomBtnText}>{t(L, 'csvExport')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={onImport}>
            <Text style={styles.bottomBtnText}>{t(L, 'csvImport')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={() => setSettingsOpen(true)}>
            <Text style={styles.bottomBtnText}>{t(L, 'openSettings')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={() => setInfoOpen(true)}>
            <Text style={styles.bottomBtnText}>{t(L, 'info')}</Text>
          </TouchableOpacity>
        </View>

        {/* small row with coffee-link */}
        <Text
          style={styles.footerLink}
          onPress={() => Linking.openURL('https://buymeacoffee.com/mybirthdaytracker')}
          accessibilityRole="link"
        >
          {t(L, 'coffeeFooter')}
        </Text>
      </View>

      {/* Add/Edit Modal */}
      <Modal visible={editingPerson !== null} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setEditingPerson(null)}>
        <BlurView intensity={90} tint={effectiveTheme === 'light' ? 'light' : 'dark'} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.h3}>{t(L, editingPerson && people.find(p => p.id === editingPerson.id) ? 'edit' : 'addPerson')}</Text>

            <Text style={styles.inputLabel}>{t(L, 'nameLabel')}</Text>
            <TextInput value={editingPerson?.name} onChangeText={v => setEditingPerson(e => e ? { ...e, name: v } : e)} style={styles.input} />

            <Text style={styles.inputLabel}>{t(L, 'typeLabel')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {(['birthday', 'anniversary', 'other'] as const).map(tp => (
                <Pill
                  key={tp}
                  active={editingPerson?.type === tp}
                  onPress={() => setEditingPerson(e => e ? { ...e, type: tp } : e)}
                  styles={styles}
                >
                  {t(L, tp)}
                </Pill>
              ))}
            </View>

            {editingPerson?.type === 'other' && (
              <>
                <Text style={styles.inputLabel}>{t(L, 'labelLabel')}</Text>
                <TextInput value={editingPerson?.label} onChangeText={v => setEditingPerson(e => e ? { ...e, label: v } : e)} style={styles.input} />
              </>
            )}

            <Text style={styles.inputLabel}>{t(L, 'dateLabel')}</Text>
            <DatePickerField valueISO={editingPerson?.dateISO ?? toISODateLocal(new Date())} onChange={iso => setEditingPerson(e => e ? { ...e, dateISO: iso } : e)} styles={styles}/>

            <View style={[styles.settingRow, { marginTop: 12 }]}>
              <Text style={styles.settingLabel}>{t(L, 'sameDay')}</Text>
              <Pressable onPress={() => setEditingPerson(e => e ? { ...e, sameDayReminder: !e.sameDayReminder } : e)} style={[styles.switchBtn, editingPerson?.sameDayReminder && styles.switchOn]}>
                <View style={[styles.switchDot, editingPerson?.sameDayReminder && styles.switchDotOn]} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity style={[styles.bottomBtn, { flex: 1 }]} onPress={() => setEditingPerson(null)}>
                <Text style={styles.bottomBtnText}>{t(L, 'cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bottomBtn, { flex: 1, backgroundColor: C.accent, borderColor: C.accent }]} onPress={saveEditing}>
                <Text style={[styles.bottomBtnText, { fontWeight: '800', color: 'white' }]}>{t(L, 'save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={settingsOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setSettingsOpen(false)}>
        <BlurView intensity={90} tint={effectiveTheme === 'light' ? 'light' : 'dark'} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.h3}>{t(L, 'settings')}</Text>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'weeklySummary')}</Text>
              <Pressable onPress={() => setSettings(s => ({ ...s, weeklySummaryEnabled: !s.weeklySummaryEnabled }))} style={[styles.switchBtn, settings.weeklySummaryEnabled && styles.switchOn]}>
                <View style={[styles.switchDot, settings.weeklySummaryEnabled && styles.switchDotOn]} />
              </Pressable>
            </View>

            <View style={styles.weekdaySection}>
              <Text style={styles.settingLabel}>{t(L, 'weekday')}</Text>

              <View style={styles.weekdayRow}>
                {WEEKDAY_ABBR[L].map((label, idx) => {
                  const dayValue = idx + 1;
                  const active = settings.weeklySummaryWeekday === dayValue;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => setSettings(s => ({ ...s, weeklySummaryWeekday: dayValue }))}
                      style={[
                        styles.weekdayCell,
                        {
                          borderColor: active ? C.pillActiveBorder : C.pillBorder,
                          backgroundColor: active ? C.pillActiveBg : C.pillBg,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${t(L, 'weekday')} ${label}`}
                    >
                      <Text
                        style={[
                          styles.weekdayCellText,
                          { color: active ? C.text : C.textDim },
                        ]}
                        numberOfLines={1}
                        allowFontScaling={false}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'time')}</Text>
              <TimePickerButton hour={settings.weeklySummaryHour} minute={settings.weeklySummaryMinute} onChange={(h, m) => setSettings(s => ({ ...s, weeklySummaryHour: h, weeklySummaryMinute: m }))} />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'daytime')}</Text>
              <TimePickerButton hour={settings.sameDayHour} minute={settings.sameDayMinute} onChange={(h, m) => setSettings(s => ({ ...s, sameDayHour: h, sameDayMinute: m }))} />
            </View>

            {/* Language */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'language')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pill active={L === 'nl'} onPress={() => setSettings(s => ({ ...s, locale: 'nl' }))} styles={styles}>{t(L, 'nl')}</Pill>
                <Pill active={L === 'en'} onPress={() => setSettings(s => ({ ...s, locale: 'en' }))} styles={styles}>{t(L, 'en')}</Pill>
              </View>
            </View>

            {/* Theme */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'theme')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pill active={settings.themeMode === 'system'} onPress={() => setSettings(s => ({ ...s, themeMode: 'system' }))} styles={styles}>{t(L, 'themeSystem')}</Pill>
                <Pill active={settings.themeMode === 'dark'} onPress={() => setSettings(s => ({ ...s, themeMode: 'dark' }))} styles={styles}>{t(L, 'themeDark')}</Pill>
                <Pill active={settings.themeMode === 'light'} onPress={() => setSettings(s => ({ ...s, themeMode: 'light' }))} styles={styles}>{t(L, 'themeLight')}</Pill>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity style={[styles.bottomBtn, { flex: 1 }]} onPress={() => setSettingsOpen(false)}>
                <Text style={styles.bottomBtnText}>{t(L, 'close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      {/* Info Modal */}
      <Modal visible={infoOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setInfoOpen(false)}>
        <BlurView intensity={90} tint={effectiveTheme === 'light' ? 'light' : 'dark'} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.h3}>{t(L, 'aboutApp')}</Text>
            <Text style={{ color: C.text, marginBottom: 8 }}>{t(L, 'aboutAppText')}</Text>
            <Pressable onPress={() => Linking.openURL(STR[L].websiteUrl)}>
              <Text style={{ color: C.link, marginBottom: 8 }}>{t(L, 'website')}: {STR[L].websiteUrl}</Text>
            </Pressable>
            <Text style={{ color: C.link, marginBottom: 16 }}>{t(L, 'version')}: {appVersion}</Text>
            <Text style={styles.h3}>{t(L, 'coffeeTitle')}</Text>
            <Text style={{ color: C.text, flexShrink: 1 }}>{t(L, 'coffee')}</Text>
            <Pressable onPress={() => Linking.openURL(STR[L].coffeeWebsite)}>
              <Text style={{ color: C.link, marginBottom: 8 }}>{STR[L].coffeeWebsite}</Text>
            </Pressable>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setInfoOpen(false)} accessibilityRole="button">
              <Text style={styles.modalCloseText}>{t(L, 'close') || (L === 'nl' ? 'Sluiten' : 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Modal>

    </SafeAreaView>
  );
}
