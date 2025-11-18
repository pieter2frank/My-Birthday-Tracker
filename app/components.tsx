import { FontAwesome } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { isSameDay } from 'date-fns';
import React from 'react';
import {
  Linking,
  Platform,
  Pressable,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { t } from './i18n';
import type { ThemeColors } from './theme';
import { createStyles } from './theme';
import type { Locale, Person } from './types';
import {
  ageOn,
  agePhrase,
  formatDM_localized,
  nextOccurrence,
  toISODateLocal,
  ymdToLocalNoonDate,
} from './utils';

type Styles = ReturnType<typeof createStyles>;

// Props voor PersonRow
export type PersonRowProps = {
  p: Person;
  mode: 'upcoming' | 'current';
  showShareTodayBirthday?: boolean;
  onEdit: (p: Person) => void;
  onDelete: (p: Person) => void;
};

// Small inline control to open the native time picker and return the chosen hour/minute.
export function TimePickerButton({
  hour,
  minute,
  onChange,
  styles,
  C,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  styles: Styles;
  C: ThemeColors;
}) {
  const [open, setOpen] = React.useState(false);
  const value = new Date();
  value.setHours(hour, minute, 0, 0);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.timeBtn,
          { opacity: pressed ? 0.6 : 1, borderColor: C.inputBorder },
        ]}
      >
        <Text
          style={[
            styles.timeBtnText,
            { color: C.text },
          ]}
        >
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

// Inline date field that opens the native date picker and returns a new ISO date
export function DatePickerField({
  valueISO,
  onChange,
  styles,
}: {
  valueISO: string;
  onChange: (iso: string) => void;
  styles: Styles;
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

// Reusable “pill” button used for filters/toggles with active/disabled styling.
export function Pill({
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
  styles: Styles;
}) {
  return (
    <Pressable onPress={onPress} style={[small ? styles.pillSm : styles.pill, active && styles.pillActive]}>
      <Text style={[small ? styles.pillTextSm : styles.pillText, active && styles.pillTextActive]}>{children}</Text>
    </Pressable>
  );
}

// Renders a single person row with subtitle, share/edit/delete actions, and tap-to-edit.
export const PersonRow = React.memo(function PersonRow({
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
  styles: Styles;
}) {
  const when = mode === 'upcoming' ? nextOccurrence(p.dateISO, now) : now;
  const yrs = ageOn(p.dateISO, when);
  const phrase = agePhrase(L, yrs, mode, p.type);
  const typeText = p.type === 'other' ? (p.label?.trim() || t(L, 'other')) : t(L, p.type);
  const subtitle = `${formatDM_localized(p.dateISO, L)} • ${phrase} • ${typeText}`;
  const isToday = isSameDay(nextOccurrence(p.dateISO, now), now);

  // function to share today's birthday/anniversary via WhatsApp or generic share sheet
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
    } catch { }
    await Share.share({ message: msg });
  }

  return (
    <View style={[styles.personRow, isToday && styles.rowToday]}>
      <View style={styles.rowClip}>
        {isToday && <View style={styles.todayStripe} />}
        <Pressable style={{ flex: 1 }} onPress={() => onEdit(p)}>
          <Text style={[styles.personName, isToday && styles.rowNameToday]}>{p.name}</Text>
          <Text style={[styles.personSub, isToday && styles.rowSubtitleToday]}>{subtitle}</Text>
        </Pressable>

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