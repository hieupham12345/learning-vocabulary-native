/**
 * gemini-inject.ts
 * JS được bơm vào trang gemini.google.com trong WebView.
 *
 * ⚠️ ĐÂY LÀ PHẦN DỄ VỠ NHẤT. Gemini obfuscate class + đổi DOM thường xuyên,
 * và UI có thể ở tiếng Việt ("Gửi", "Dừng"...) tuỳ locale. Mọi selector gom
 * hết vào SELECTORS bên dưới để chỉ phải vá một chỗ khi web đổi giao diện.
 *
 * Kiểm chứng selector bằng cách mở gemini.google.com trên Chrome desktop →
 * DevTools → thử `document.querySelector(...)`.
 */

export const SELECTORS = {
  // Ô nhập prompt (Gemini dùng Quill contenteditable)
  editor: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ],
  // Nút gửi
  send: [
    'button.send-button',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[mattooltip*="Send" i]',
  ],
  // Nút dừng (hiển thị khi đang stream) — dùng để biết còn đang generate
  stop: [
    'button.send-button.stop',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Dừng" i]',
  ],
  // Container text của từng câu trả lời model
  response: [
    'message-content .model-response-text',
    'message-content .markdown',
    '.model-response-text',
  ],
  // Nút "cuộc trò chuyện mới"
  newChat: [
    '[data-test-id="new-chat-button"]',
    'button[aria-label*="New chat" i]',
    'button[aria-label*="cuộc trò chuyện mới" i]',
    'button[aria-label*="trò chuyện mới" i]',
    'button[aria-label*="New conversation" i]',
    '.new-chat-button',
  ],
};

const CANDS = JSON.stringify(SELECTORS);

/**
 * Chạy một lần mỗi khi trang load (injectedJavaScript).
 * Cài helper + báo trạng thái đăng nhập về native.
 */
export const BOOTSTRAP_JS = `
(function () {
  var S = ${CANDS};
  function q(c) { for (var i = 0; i < c.length; i++) { var e = document.querySelector(c[i]); if (e) return e; } return null; }
  function post(o) { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
  window.__geminiPost = post;
  var tries = 0;
  function check() {
    tries++;
    var loggedIn = !!q(S.editor);
    post({ type: 'loginStatus', loggedIn: loggedIn, url: location.href });
    if (!loggedIn && tries < 30) setTimeout(check, 1000);
  }
  check();
})();
true;
`;

/**
 * Script gửi một prompt và cào câu trả lời khi stream xong.
 * newChat=true → mở phiên chat mới trước khi gửi (đợi editor rỗng rồi mới gõ).
 * Kết quả trả về qua postMessage: { type:'result'|'error', requestId, ok, text|error }
 */
export function buildSendScript(
  requestId: string,
  prompt: string,
  newChat: boolean
): string {
  return `
(function () {
  var S = ${CANDS};
  var RID = ${JSON.stringify(requestId)};
  var PROMPT = ${JSON.stringify(prompt)};
  var NEW_CHAT = ${newChat ? "true" : "false"};
  function q(c) { for (var i = 0; i < c.length; i++) { var e = document.querySelector(c[i]); if (e) return e; } return null; }
  function qa(c) { for (var i = 0; i < c.length; i++) { var l = document.querySelectorAll(c[i]); if (l.length) return l; } return document.querySelectorAll('__none__'); }
  function post(o) { o.requestId = RID; try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }

  function typeAndSend() {
    var editor = q(S.editor);
    if (!editor) { post({ type: 'error', ok: false, error: 'no_editor' }); return; }

    // Đặt nội dung prompt vào ô nhập
    editor.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, PROMPT);
    } catch (e) {}
    if (!editor.innerText || editor.innerText.trim() === '') {
      editor.innerText = PROMPT;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    var before = qa(S.response).length;

    setTimeout(function () {
      var btn = q(S.send);
      if (!btn) { post({ type: 'error', ok: false, error: 'no_send' }); return; }
      btn.click();

      var lastText = '';
      var stable = 0;
      var start = Date.now();
      var iv = setInterval(function () {
        if (Date.now() - start > 90000) { clearInterval(iv); post({ type: 'error', ok: false, error: 'timeout' }); return; }
        var nodes = qa(S.response);
        if (nodes.length <= before) return;            // câu trả lời mới chưa xuất hiện
        var last = nodes[nodes.length - 1];
        var txt = (last && last.innerText) || '';
        var generating = !!q(S.stop);                  // còn nút Stop => vẫn đang generate
        if (txt === lastText && !generating && txt.trim() !== '') {
          stable++;
        } else {
          stable = 0;
          lastText = txt;
        }
        if (stable >= 4) { clearInterval(iv); post({ type: 'result', ok: true, text: txt }); }
      }, 400);
    }, 300);
  }

  if (NEW_CHAT) {
    var nc = q(S.newChat);
    if (nc) nc.click();
    // Chờ chat rỗng (response cũ biến mất) & editor sẵn sàng
    var t0 = Date.now();
    var wait = setInterval(function () {
      var ready = !!q(S.editor) && qa(S.response).length === 0;
      if (ready || Date.now() - t0 > 5000) { clearInterval(wait); typeAndSend(); }
    }, 200);
  } else {
    typeAndSend();
  }
})();
true;
`;
}
