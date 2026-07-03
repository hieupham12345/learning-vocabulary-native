/**
 * GeminiWebView.tsx
 * WebView Gemini ẩn, tồn tại suốt vòng đời app. Mount 1 lần ở root (_layout).
 * Không hiển thị nhưng vẫn render để JS chạy được. Là "engine" chạy prompt.
 */

import React, { useRef } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { BOOTSTRAP_JS } from "../../scripts/gemini-inject";
import { WebViewChatBridge } from "../../scripts/webview-chat-bridge";
import { useSettings } from "../../scripts/useSettings";

const GEMINI_URL = "https://gemini.google.com/app";

// UA Chrome Android thật — giảm rủi ro bị chặn so với UA WebView mặc định
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

export function GeminiWebView() {
  const ref = useRef<WebView>(null);
  const { settings } = useSettings();

  // WebView chạy trên native; trên web (iframe) sẽ bị X-Frame-Options chặn.
  if (Platform.OS === "web") return null;
  // Chế độ API không cần engine web → khỏi nạp Gemini ở nền.
  if (settings.chat_mode === "api") return null;

  const handleLoadEnd = () => {
    WebViewChatBridge.register(
      (js) => ref.current?.injectJavaScript(js),
      () => ref.current?.reload()
    );
  };

  const handleMessage = (e: WebViewMessageEvent) => {
    WebViewChatBridge.handleMessage(e.nativeEvent.data);
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ uri: GEMINI_URL }}
        userAgent={USER_AGENT}
        injectedJavaScript={BOOTSTRAP_JS}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        incognito={false}
        originWhitelist={["*"]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
  },
});
