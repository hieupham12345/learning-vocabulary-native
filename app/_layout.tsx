import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { GeminiWebView } from '@/components/webview-chat/GeminiWebView';
import { loadProgress, refreshProgress } from '@/scripts/progress-store';
import { initReminders } from '@/scripts/notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Đặt lịch nhắc học hằng ngày theo streak hiện tại
  useEffect(() => {
    loadProgress()
      .then((p) => initReminders(p.streak))
      .catch(() => {});
  }, []);

  // Tính lại streak/todayCount khi app quay lại foreground
  // (app nằm background qua nửa đêm → mở lại phải phản ánh ngày mới)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshProgress().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="GeminiLogin" options={{ presentation: 'modal', title: 'Sign in to Gemini', headerShown: false }} />
      </Stack>
      <GeminiWebView />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
