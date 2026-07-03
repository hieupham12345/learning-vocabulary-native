/**
 * webview-chat-bridge.ts
 * Cầu nối singleton giữa app và WebView Gemini.
 *
 * - GeminiWebView (component) đăng ký hàm inject + báo message vào đây.
 * - Mọi callChatbot() gọi bridge.send(prompt) → xếp hàng TUẦN TỰ (một khung
 *   chat, chạy từng prompt một) → inject JS → chờ postMessage kết quả.
 */

import { buildSendScript } from "./gemini-inject";

type Job = {
  requestId: string;
  prompt: string;
  forceNew: boolean; // learnWord → luôn mở phiên mới
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const JOB_TIMEOUT_MS = 100_000; // backstop native (JS-side đã timeout 90s)
const ROTATE_EVERY = 5; // sau 5 lần gửi (thao tác thường) → tự mở phiên chat mới

class Bridge {
  private inject: ((js: string) => void) | null = null;
  private reloadFn: (() => void) | null = null;
  private queue: Job[] = [];
  private active: Job | null = null;
  private loggedIn = false;
  private seq = 0;
  // Số lần đã gửi trong phiên chat hiện tại. Khởi tạo = ROTATE_EVERY để lần
  // gửi ĐẦU TIÊN (và sau mỗi lần trang load lại) luôn mở phiên mới sạch,
  // tránh đổ prompt vào phiên cũ Gemini còn nhớ.
  private sentInChat = ROTATE_EVERY;
  private listeners = new Set<(loggedIn: boolean) => void>();

  // ── Component đăng ký ──────────────────────────────────
  register(inject: (js: string) => void, reload: () => void) {
    this.inject = inject;
    this.reloadFn = reload;
    this.pump();
  }

  unregister() {
    this.inject = null;
    this.reloadFn = null;
  }

  reload() {
    this.reloadFn?.();
  }

  // ── Trạng thái đăng nhập ───────────────────────────────
  get isLoggedIn() {
    return this.loggedIn;
  }

  subscribe(fn: (loggedIn: boolean) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setLoggedIn(v: boolean) {
    // Mỗi lần trang (re)load báo đã đăng nhập → ép phiên mới ở lần gửi kế tiếp.
    if (v) this.sentInChat = ROTATE_EVERY;
    if (this.loggedIn === v) return;
    this.loggedIn = v;
    this.listeners.forEach((fn) => fn(v));
    if (v) this.pump(); // vừa đăng nhập xong → chạy job đang chờ
  }

  // ── API chính ──────────────────────────────────────────
  // opts.newChat: ép mở phiên chat mới (dùng cho learnWord — 1 từ = 1 phiên).
  send(prompt: string, opts?: { newChat?: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.seq}`;
      this.queue.push({
        requestId,
        prompt,
        forceNew: !!opts?.newChat,
        resolve,
        reject,
        timer: null,
      });
      this.pump();
    });
  }

  // ── Message từ WebView (component gọi) ─────────────────
  handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "loginStatus") {
      this.setLoggedIn(!!msg.loggedIn);
      return;
    }

    if (msg.type === "result" || msg.type === "error") {
      const job = this.active;
      if (!job || job.requestId !== msg.requestId) return;
      if (job.timer) clearTimeout(job.timer);
      this.active = null;
      if (msg.ok && typeof msg.text === "string") {
        job.resolve(msg.text);
      } else {
        job.reject(new Error(`Gemini web error: ${msg.error ?? "unknown"}`));
      }
      this.pump();
    }
  }

  // ── Chạy job kế tiếp nếu rảnh ──────────────────────────
  private pump() {
    if (this.active || this.queue.length === 0) return;
    if (!this.inject) return; // WebView chưa sẵn sàng
    if (!this.loggedIn) {
      // Chưa đăng nhập → fail nhanh toàn bộ hàng đợi để caller báo lỗi rõ ràng
      const pending = this.queue.splice(0);
      pending.forEach((j) =>
        j.reject(new Error("Not signed in to Gemini. Open Settings to sign in."))
      );
      return;
    }

    const job = this.queue.shift()!;
    this.active = job;

    // Quyết định có mở phiên chat mới không:
    //  - learnWord (forceNew) → luôn mới
    //  - thao tác thường → mới khi đã gửi đủ ROTATE_EVERY lần trong phiên
    const rotate = job.forceNew || this.sentInChat >= ROTATE_EVERY;
    if (job.forceNew) {
      // Phiên này dành RIÊNG cho 1 từ vựng → thao tác kế tiếp mở phiên khác
      this.sentInChat = ROTATE_EVERY;
    } else {
      this.sentInChat = rotate ? 1 : this.sentInChat + 1;
    }

    job.timer = setTimeout(() => {
      if (this.active === job) {
        this.active = null;
        job.reject(new Error("Gemini web timeout"));
        this.pump();
      }
    }, JOB_TIMEOUT_MS);

    this.inject(buildSendScript(job.requestId, job.prompt, rotate));
  }
}

export const WebViewChatBridge = new Bridge();
