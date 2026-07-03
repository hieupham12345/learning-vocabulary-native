import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { GeminiWebView } from '@/components/webview-chat/GeminiWebView';
import { loadProgress } from '@/scripts/progress-store';
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
