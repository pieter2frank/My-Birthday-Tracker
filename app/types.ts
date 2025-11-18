import Purchases from 'react-native-purchases';

// RevenueCat Types
export type RcOfferings = Awaited<ReturnType<typeof Purchases.getOfferings>>;
export type RcPackage = Parameters<typeof Purchases.purchasePackage>[0];

// App Types
export type EventType = 'birthday' | 'anniversary' | 'other';
export type Person = {
  id: string;
  name: string;
  type: EventType;
  dateISO: string; // YYYY-MM-DD
  label?: string;
  sameDayReminder?: boolean;
};
export type SortMode = 'next' | 'name';
export type FilterType = 'all' | EventType;
export type Locale = 'nl' | 'en' | 'de' | 'es' | 'pt' | 'fr' | 'it';

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

export type UpcomingItem = {
  when: Date;
  person: Person;
};