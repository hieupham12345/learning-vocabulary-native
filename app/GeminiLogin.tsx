/**
 * GeminiLogin.tsx
 * Màn đăng nhập Gemini — WebView full-screen, tương tác được.
 * Bạn tự đăng nhập Google (+2FA/captcha) và chọn model mặc định tại đây.
 * Dùng chung cookie với WebView ẩn → sau khi login, engine tự có session.
 */

import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { BOOTSTRAP_JS } from "../scripts/gemini-inject";
import { WebViewChatBridge } from "../scripts/webview-chat-bridge";
import { saveSettings } from "../scripts/settings-store";
import { Palette } from "@/constants/palette";

const GEMINI_URL = "https://gemini.google.com/app";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

export default function GeminiLogin() {
  const router = useRouter();
  const ref = useRef<WebView>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "loginStatus") {
        setLoggedIn(!!msg.loggedIn);
        // đồng bộ luôn cho engine ẩn
        WebViewChatBridge.handleMessage(e.nativeEvent.data);
      }
    } catch {
      // ignore
    }
  };

  const handleDone = async () => {
    await saveSettings({ gemini_logged_in: loggedIn });
    WebViewChatBridge.reload(); // engine ẩn nạp lại cookie session mới
    router.back();
  };

  return (
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Text style={s.title}>Sign in to Gemini</Text>
        <View style={[s.badge, loggedIn ? s.badgeOn : s.badgeOff]}>
          <Text style={s.badgeText}>{loggedIn ? "✓ Signed in" : "Not signed in"}</Text>
        </View>
      </View>

      <Text style={s.hint}>
        Sign in with Google, then pick the model you want (Gemini remembers it as default). Tap “Done” when finished.
      </Text>

      <WebView
        ref={ref}
        style={s.web}
        source={{ uri: GEMINI_URL }}
        userAgent={USER_AGENT}
        injectedJavaScript={BOOTSTRAP_JS}
        onMessage={handleMessage}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        incognito={false}
        originWhitelist={["*"]}
        startInLoadingState
        renderLoading={() => (
          <View style={s.loader}>
            <ActivityIndicator color={Palette.brand} size="large" />
          </View>
        )}
      />

      <View style={s.footer}>
        <TouchableOpacity style={s.doneBtn} onPress={handleDone}>
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: Palette.accent, fontSize: 18, fontWeight: "bold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeOn: { backgroundColor: "#14532d" },
  badgeOff: { backgroundColor: "#4a1d1d" },
  badgeText: { color: Palette.textPrimary, fontSize: 12, fontWeight: "600" },
  hint: { color: Palette.textMuted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  web: { flex: 1 },
  loader: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Palette.bg },
  footer: { padding: 16 },
  doneBtn: {
    backgroundColor: Palette.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  doneText: { color: Palette.bg, fontWeight: "bold", fontSize: 16 },
});
