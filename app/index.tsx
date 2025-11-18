// Externe imports
import { Feather, Ionicons } from '@expo/vector-icons';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  isSameDay,
  isWithinInterval,
  startOfDay
} from 'date-fns';
import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
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
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme
} from 'react-native';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import {
  buildNotificationSignature,
  ensureAndroidChannels,
  ensureNotifPerms,
  rescheduleAllNotifications
} from './notifications';

// locale imports
import { DatePickerField, PersonRow, Pill, TimePickerButton } from './components';
import { ENTITLEMENT_ID, FREE_LIMIT, K_PEOPLE, K_SETTINGS, RC_API_KEY, appVersion } from './constants';
import { useDebouncedEffect } from './hooks';
import { STR, WEEKDAY_ABBR, t } from './i18n';
import { getJSON, getJSONAsync, setJSON } from './storage';
import { THEME, createStyles, type ThemeColors } from './theme';
import type { Locale, Person, RcOfferings, Settings } from './types';
import { CSV_HEADER, nextOccurrence, parseCSV, toCSVRow, toISODateLocal, uuid } from './utils';
// ------------------------------------

// Splash auto-hide 
SplashScreen.preventAutoHideAsync().catch(() => { });

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
  const L: Locale = settings.locale;
  const scheme = useColorScheme();
  const effectiveTheme: 'light' | 'dark' = settings.themeMode === 'system' ? (scheme === 'light' ? 'light' : 'dark') : settings.themeMode;
  const C = useMemo<ThemeColors>(() => THEME[effectiveTheme] as ThemeColors, [effectiveTheme]);
  const styles = useMemo(() => createStyles(C), [C]);
  const nowDate = new Date();

  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [isPro, setIsPro] = useState(false);
  const [offerings, setOfferings] = useState<RcOfferings | null>(null);
  //const [paywallOpen, setPaywallOpen] = useState(false);

  // Force refresh at local midnight so "Today" / "This week" roll over automatically
  const [, forceTick] = React.useState(0);

  // ============== function for testing pro paywall
  async function switchToFreeForTesting() {
    try {
      // try to log out first
      await Purchases.logOut();
    } catch (e: any) {
      // if the error is not about anonymous user, ignore
      if (!String(e?.message || e).includes('current user is anonymous')) {
        /* no-op */
      }
    }

    try {
      // Log in with a unique test ID to get a fresh free user
      const testId = `test_free_${Date.now()}`;
      const { customerInfo } = await Purchases.logIn(testId);

      const active = !!customerInfo.entitlements?.active?.[ENTITLEMENT_ID];
      setIsPro(active);

      if (active) {
        Alert.alert(
          t(L, 'testStillProTitle'),
          t(L, 'testStillProBody')
        );
      } else {
        Alert.alert(
          t(L, 'testProDisabledTitle'),
          t(L, 'testProDisabledBody')
        );
        openPaywall();
      }
    } catch (e: any) {
      Alert.alert(
        t(L, 'couldNotSwitchTitle'),
        String(e?.message ?? e)
      );
    }
  }


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
        // ✅ ask notificatie-permissions + Android channels
        await ensureAndroidChannels(settings.locale);
        await ensureNotifPerms();
        

        const ps = getJSON<Person[]>(K_PEOPLE) || await getJSONAsync<Person[]>(K_PEOPLE);
        if (ps) setPeople(ps);

        const st = getJSON<Partial<Settings>>(K_SETTINGS) || await getJSONAsync<Partial<Settings>>(K_SETTINGS);
        if (st) setSettings(s => ({ ...s, ...st }));

        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        /* no-op */
      } finally {
        try { 
          await SplashScreen.hideAsync(); } catch {}
      }
     
    })();
  }, []);

  // Init useEffect RevenueCat 
  useEffect(() => {
    (async () => {
      try {
        // Configure RevenueCat
        await Purchases.configure({ apiKey: RC_API_KEY });

        // Get offerings + current entitlement status
        const offs = await Purchases.getOfferings();
        setOfferings(offs);

        const info = await Purchases.getCustomerInfo();
        const active = !!info.entitlements?.active?.[ENTITLEMENT_ID];
        setIsPro(active);

        // Listener for changes in customer info (e.g., after purchase)
        Purchases.addCustomerInfoUpdateListener(async (updatedInfo) => {
          const activeNow = !!updatedInfo.entitlements?.active?.[ENTITLEMENT_ID];
          setIsPro(activeNow);
          try { await rescheduleAllNotifications(settings, people, L); } catch {}
        });
      } catch (e) {
        /* no-op */
      }
    })();

    return () => {
      // nothing to cleanup
    };
  }, []);


  // Persist
  useDebouncedEffect(() => setJSON(K_PEOPLE, people), [people], 200);
  useDebouncedEffect(() => setJSON(K_SETTINGS, settings), [settings], 200);

  const notifSig = useMemo(
    () => buildNotificationSignature(settings, people),
    [settings, people]
  );

  // Reschedule notifications on relevant changes (after debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      rescheduleAllNotifications(settings, people, L).catch(() => {});
      // eventually: debugScheduledNotifications();
    }, 1500);
    return () => clearTimeout(t);
  }, [notifSig]);


  // Cache: first next occurrence timestamps for all people
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

  // Rolling week (next 7 days excluding today)
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
    if (!isPro && people.length >= FREE_LIMIT) {
      Alert.alert(t(L, 'limitReachedTitle'), t(L, 'limitReachedMsg', { limit: FREE_LIMIT }), [
        { text: t(L, 'upgradeCta'), onPress: openPaywall },
        { text: t(L, 'cancel'), style: 'cancel' }
      ]);
      return;
    }
    setEditingPerson({
      id: uuid(),
      name: '',
      type: 'birthday',
      dateISO: toISODateLocal(new Date()),
      sameDayReminder: true
    });
  }

  const startEdit = useCallback((p: Person) => {
    setEditingPerson({ ...p });
  }, []);

  function saveEditing() {
    if (!editingPerson || !editingPerson.name.trim()) return;

    setPeople(prev => {
      const i = prev.findIndex(p => p.id === editingPerson.id);
      const isNew = i < 0;

      if (isNew && !isPro && prev.length >= FREE_LIMIT) {
        Alert.alert(t(L, 'limitReachedTitle'), t(L, 'limitReachedMsg', { limit: FREE_LIMIT }), [
          { text: t(L, 'upgradeCta'), onPress: openPaywall },
          { text: t(L, 'cancel'), style: 'cancel' }
        ]);
        return prev;
      }

      const copy = prev.slice();
      if (i >= 0) copy[i] = editingPerson; else copy.push(editingPerson);
      return copy;
    });

    setEditingPerson(null);
  }

  const confirmDelete = useCallback((p: Person) => {
    Alert.alert(
      t(L, 'confirmDeleteTitle'),
      t(L, 'confirmDeleteMsg', { name: p.name }),
      [
        { text: t(L, 'cancel'), style: 'cancel' },
        {
          text: t(L, 'delete'),
          style: 'destructive',
          onPress: () => {
            // close edit modal if open for this person
            setEditingPerson(e => (e && e.id === p.id ? null : e));

            // wait till after modal close animation
            setTimeout(() => {
              setPeople(prev => {
                // Guard: if person not found, return prev
                if (!prev.some(x => x.id === p.id)) return prev;
                return prev.filter(x => x.id !== p.id);
              });
            }, 0);
          },
        },
      ]
    );
  }, [L]);

  // Paywall / purchase functions
  async function openPaywall() {
    try {
      const result = await RevenueCatUI.presentPaywall({
        requiredEntitlementIdentifier: ENTITLEMENT_ID,
      });
      
      if (result === PAYWALL_RESULT.PURCHASED) {
        // successful purchase
        const info = await Purchases.getCustomerInfo();
        setIsPro(!!info.entitlements?.active?.[ENTITLEMENT_ID]);
        Alert.alert(t(L, 'purchaseSuccess'));

      } else if (result === PAYWALL_RESULT.RESTORED) {
        // successful restore
        const info = await Purchases.getCustomerInfo();
        const active = !!info.entitlements?.active?.[ENTITLEMENT_ID];
        setIsPro(active);
        Alert.alert(active ? t(L, 'purchaseRestored') : t(L, 'purchaseCancelled'));
        
      } else if (result === PAYWALL_RESULT.ERROR) {
        // error occurred
        Alert.alert(t(L, 'purchaseErrorTitle'), t(L, 'purchaseDialogFailed'));
      
      }

      // reschedule notifications if purchased or restored
      if (
        result === PAYWALL_RESULT.PURCHASED ||
        (result === PAYWALL_RESULT.RESTORED && isPro)
      ) {
        try { await rescheduleAllNotifications(settings, people, L); } catch {}
      }

    } catch (e) {
      Alert.alert(t(L, 'purchaseErrorTitle'), t(L, 'purchaseDialogFailed'));
    }
  }

  // CSV actions
  // export birthdays to CSV and share
  async function onExport() {
    const csv = [CSV_HEADER, ...people.map(toCSVRow)].join('\n');
    const out = new File(Paths.cache, 'birthdays.csv');
    out.write(csv); 
    await Sharing.shareAsync(out.uri, {
      mimeType: 'text/csv',
      dialogTitle: t(L, 'csvExportDialog'),
    });
  }

  // import birthdays from CSV
  async function onImport() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/*', 'text/csv', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;

    const pickedUri = res.assets[0].uri;
    const file = new File(pickedUri);
    const text = file.textSync();

    const rows = parseCSV(text);

    try {
      // → Check would-be total (unique IDs)
      const currentIds = new Set(people.map(p => p.id));
      const newIds = new Set(rows.map(p => p.id));
      const wouldTotal = new Set([...currentIds, ...newIds]).size;

      if (!isPro && wouldTotal > FREE_LIMIT) {
        Alert.alert(
          t(L, 'importLimitTitle'),
          t(L, 'importLimitMsg', { wouldTotal, limit: FREE_LIMIT }),
          [
            { text: t(L, 'upgradeCta'), onPress: openPaywall },
            { text: t(L, 'cancel'), style: 'cancel' }
          ]
        );
        return;
      }

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

    // today
    d.push({ kind: 'title', key: 'title:today', text: t(L, 'today') });
    if (todayList.length === 0) {
      d.push({ kind: 'empty', key: 'empty:today', text: t(L, 'noneToday') });
    } else {
      todayList.forEach(p =>
        d.push({ kind: 'person', key: `p:today:${p.id}`, section: 'today', person: p })
      );
    }

    // this week
    d.push({ kind: 'title', key: 'title:week', text: t(L, 'thisWeek') });
    if (weekList.length === 0) {
      d.push({ kind: 'empty', key: 'empty:week', text: t(L, 'noneWeek') });
    } else {
      weekList.forEach(p =>
        d.push({ kind: 'person', key: `p:week:${p.id}`, section: 'week', person: p })
      );
    }

    // everyone
    d.push({
      kind: 'title',
      key: 'title:everyone',
      text: t(L, 'everyoneWithCount', { count: totalJubilea }),
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
        now={nowDate}
        styles={styles}
        showShareTodayBirthday={showShareTodayBirthday}
        onEdit={startEdit}
        onDelete={confirmDelete}
      />
    );
  }, [L, styles, startEdit, confirmDelete, nowDate]);

  // Helps FlashList optimize rendering by specifying item types
  const getItemType = useCallback((item: ListItem) => (
    item.kind === 'person' ? 'row' : item.kind
  ), []);
  
  const weekdayAbbr = Array.isArray(WEEKDAY_ABBR[L]) ? WEEKDAY_ABBR[L] : WEEKDAY_ABBR['en'];

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style={effectiveTheme === 'light' ? 'dark' : 'light'} />

      {/* Titel */}
      <View style={styles.topBar}>
        <View className="titleRow" style={styles.titleRow}>
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
        <View className="bottomActions" style={styles.bottomActions}>
          <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnAccent]} onPress={startAdd}>
            <Ionicons name="person-add" size={22} color={effectiveTheme === 'light' ? 'white' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={onExport}>
            <Feather name="download" size={20} color={effectiveTheme === 'light' ? '#16a34a' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={onImport}>
            <Feather name="upload" size={20} color={effectiveTheme === 'light' ? '#16a34a' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={() => setSettingsOpen(true)}>
            <Ionicons name="settings-outline" size={22} color={effectiveTheme === 'light' ? '#16a34a' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomBtn} onPress={() => setInfoOpen(true)}>
            <Ionicons name="information-circle-outline" size={22} color={effectiveTheme === 'light' ? '#16a34a' : 'white'} />
          </TouchableOpacity>
        </View>

        {/* small row with coffee-link */}
        {!isPro && (
          <Text
            style={styles.footerLink}
            onPress={openPaywall}
            accessibilityRole="link"
          >
            {t(L, 'limitBanner', { limit: FREE_LIMIT })} — {t(L, 'upgradeCta')}
          </Text>
        )}
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
                {weekdayAbbr.map((label: string, idx: number) => {
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
              <TimePickerButton hour={settings.weeklySummaryHour} minute={settings.weeklySummaryMinute} onChange={(h, m) => setSettings(s => ({ ...s, weeklySummaryHour: h, weeklySummaryMinute: m }))} 
                styles={styles}
                C={C}             
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t(L, 'daytime')}</Text>
              <TimePickerButton hour={settings.sameDayHour} minute={settings.sameDayMinute} onChange={(h, m) => setSettings(s => ({ ...s, sameDayHour: h, sameDayMinute: m }))} 
                styles={styles}
                C={C}               
              />
            </View>

            {/* Language */}
            <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={styles.settingLabel}>{t(L, 'language')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {(['nl', 'en', 'de', 'es', 'pt', 'fr', 'it'] as const).map(code => (
                  <Pill
                    key={code}
                    active={L === code}
                    onPress={() => setSettings(s => ({ ...s, locale: code }))}
                    styles={styles}
                  >
                    {t(L, code)}
                  </Pill>
                ))}
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
            {!isPro && (
              <Text style={{ color: C.text, marginBottom: 8 }}>
                {t(L, 'infoLimitBlurb', { limit: FREE_LIMIT })}
              </Text>
            )}
            {/* row 1: Get Pro (if not-pro) + Close */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {!isPro && (
                <TouchableOpacity
                  style={[styles.bottomBtn, styles.bottomBtnAccent, { flex: 1 }]}
                  onPress={openPaywall}
                  accessibilityRole="button"
                >
                  <Text style={[styles.bottomBtnText, { color: 'white' }]}>
                    {t(L, 'upgradeCta')}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.bottomBtn, { flex: 1 }]}
                onPress={() => setInfoOpen(false)}
                accessibilityRole="button"
              >
                <Text style={styles.bottomBtnText}>{t(L, 'close')}</Text>
              </TouchableOpacity>
            </View>

            {/* row 2: TEST-knop – altijd zichtbaar, volle breedte */}
            <View style={{ marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.bottomBtn, styles.bottomBtnAccent]}
                onPress={switchToFreeForTesting}
                accessibilityRole="button"
              >
                <Text style={[styles.bottomBtnText, { color: 'white' }]}>
                  {t(L, 'debugSwitchToFree')}
                </Text>
              </TouchableOpacity>
            </View>

          </View>
        </BlurView>
      </Modal>

    </SafeAreaView>
  );
}
