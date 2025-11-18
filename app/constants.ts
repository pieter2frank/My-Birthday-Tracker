import * as Application from 'expo-application';
import { Platform } from 'react-native';

// ============== Storage Keys ==============
export const K_PEOPLE = 'people.v5';
export const K_SETTINGS = 'settings.v5';
export const K_WEEKLY_ID = 'weekly_notif_id';
export const K_PERSON_IDS = 'person_notif_ids'; // map personId->notifId

// ====== Free tier & RevenueCat ======
export const FREE_LIMIT: number = 20;
export const ENTITLEMENT_ID = 'pro';
export const RC_API_KEY_IOS = 'appl_xxxxxxxxxxxxxxxxxxxxxxxx';
export const RC_API_KEY_ANDROID = 'goog_QxJqDyJvGIlTJAfIfrCxYMwAyjd';
export const RC_API_KEY = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;

export const appVersion = Application?.nativeApplicationVersion ?? '1.0.0';