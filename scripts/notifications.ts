/**
 * notifications.ts
 * Nhắc học hằng ngày (local notification) — giọng khịa nhẹ cho vui.
 * Không cần server: dùng lịch daily của expo-notifications.
 *
 * Luồng: initReminders() gọi 1 lần lúc app mở → xin quyền → đặt lại lịch
 * (huỷ hết rồi đặt mới, kèm message xoay theo ngày + streak hiện tại).
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const ANDROID_CHANNEL = "daily-reminder";

// Cheeky tone — noon & evening. %s = current streak (if any).
const NOON_LINES = [
  "It's noon — feeding your brain some words, or just feeding your face? 🍚",
  "Go learn a few words, they won't crawl into your head by themselves 🧠",
  "5 min of vocab < one pointless story scroll. Choose wisely 👀",
  "Hey, your vocab list is sulking from being ignored 😤",
];

const EVENING_LINES = [
  "Your %s-day streak is about to die — how could you? 🔥💔",
  "Haven't studied today? The Duo owl is already on its way 🦉",
  "Sleeping is easy, fluency isn't. Learn a few words first 😴📚",
  "Today's goal isn't done yet. Don't let tomorrow-you regret it 😏",
];

const NO_STREAK_EVENING = [
  "Start a new streak today — better late than never 🔥",
  "Streak's at 0. Do one session and get it moving 💪",
  "Nothing learned today — fix that before the day's over 🌙",
];

function pick(arr: string[], seed: number): string {
  return arr[seed % arr.length];
}

/** Cài handler + kênh Android. Gọi 1 lần sớm. */
export async function configureNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: "Daily study reminder",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

async function ensurePermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

/**
 * Đặt lại toàn bộ nhắc nhở hằng ngày (trưa 12:30 & tối 20:30).
 * @param streak streak hiện tại (để chèn vào lời khịa buổi tối)
 */
export async function scheduleDailyReminders(streak: number): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  // seed xoay theo ngày để message đổi mỗi ngày
  const seed = new Date().getDate();

  const eveningBody =
    streak > 0
      ? pick(EVENING_LINES, seed).replace("%s", String(streak))
      : pick(NO_STREAK_EVENING, seed);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "📚 Time to learn some words",
      body: pick(NOON_LINES, seed),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 12,
      minute: 30,
      channelId: ANDROID_CHANNEL,
    },
  });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: streak > 0 ? `🔥 Keep your ${streak}-day streak` : "🔥 Start a streak",
      body: eveningBody,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 20,
      minute: 30,
      channelId: ANDROID_CHANNEL,
    },
  });
}

/** Gọi lúc app mở: cấu hình + đặt lịch theo streak hiện tại. */
export async function initReminders(streak: number): Promise<void> {
  try {
    await configureNotifications();
    await scheduleDailyReminders(streak);
  } catch (e) {
    console.warn("[notifications] init failed", e);
  }
}
