/* ═══════════════════════════════════════════════════════════════════════
   chat-bubble-loader.js — VirtualDentist.ai chat bubble for host page
   ───────────────────────────────────────────────────────────────────────
   Drop into Martindale Hamilton page via:
     <script async src="https://vd-dashboard-iota.vercel.app/chat-bubble-loader.js"></script>

   Creates a position-fixed bubble bottom-right. Clicking the bubble loads
   chat-widget.html in a hidden iframe and reveals it. The widget panel
   itself handles all chat logic; this loader is purely the host-page chrome.

   Communication with the widget iframe:
     - Inbound: { type: "vd-chat-close" }   → hide panel (widget close button)

   Single self-contained IIFE. No external dependencies. No cookies set
   here (widget handles its own session cookies on its own origin).

   Config: read from CONFIG_URL on load. Bubble appearance, position,
   pulse behavior all driven by config.ui block.
   ═══════════════════════════════════════════════════════════════════════ */
(function() {
  "use strict";

  // ── Hard-coded for Phase 0; templated when widget is reused ─────────
  var PRACTICE_ID = "martindale-jacksonsquare";
  var WIDGET_ORIGIN = "https://vd-dashboard-iota.vercel.app";
  var WIDGET_URL = WIDGET_ORIGIN + "/chat-widget.html";
  var CONFIG_URL = WIDGET_ORIGIN + "/" + PRACTICE_ID + "-config.json";
  var CONTAINER_ID = "vd-chat-mount";

  // Idempotency: if the script is loaded twice (e.g., via a CMS that
  // duplicates includes), don't mount a second bubble.
  if (document.getElementById(CONTAINER_ID)) return;

  // ── State ────────────────────────────────────────────────────────────
  var state = {
    config: null,
    open: false,
    iframeLoaded: false,
    pulseFired: false
  };

  // ── Style injection — scoped under #vd-chat-mount ────────────────────
  function injectStyles(brand, ui) {
    var primary = (brand && brand.primary) || "#1b4d2e";
    var accent = (brand && brand.accent) || "#71bb55";
    var bubbleSize = (ui && ui.bubble_size_px) || 56;
    var offset = (ui && ui.bubble_offset_px) || { bottom: 20, right: 20 };
    var panelW = (ui && ui.panel_size_desktop_px && ui.panel_size_desktop_px.width) || 380;
    var panelH = (ui && ui.panel_size_desktop_px && ui.panel_size_desktop_px.height) || 580;
    var mobileBp = (ui && ui.mobile_breakpoint_px) || 640;

    var css = [
      '#vd-chat-mount, #vd-chat-mount * { box-sizing: border-box; }',
      '#vd-chat-mount { font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif; }',

      // Bubble
      '#vd-chat-bubble {',
      '  position: fixed;',
      '  bottom: ' + offset.bottom + 'px;',
      '  right: ' + offset.right + 'px;',
      '  width: ' + bubbleSize + 'px;',
      '  height: ' + bubbleSize + 'px;',
      '  border-radius: 50%;',
      '  background: ' + primary + ';',
      '  color: #fff;',
      '  border: none;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);',
      '  z-index: 2147483646;',
      '  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;',
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '#vd-chat-bubble:hover { background: ' + accent + '; transform: scale(1.06); box-shadow: 0 10px 28px rgba(113, 187, 85, 0.35); }',
      '#vd-chat-bubble:active { transform: scale(0.98); }',
      '#vd-chat-bubble svg { width: 26px; height: 26px; pointer-events: none; }',

      // Pulse animation (decorative ring around bubble on first load)
      '#vd-chat-bubble.pulsing::before, #vd-chat-bubble.pulsing::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  border-radius: 50%;',
      '  border: 2px solid ' + accent + ';',
      '  opacity: 0;',
      '  animation: vdPulse 1.8s ease-out infinite;',
      '  pointer-events: none;',
      '}',
      '#vd-chat-bubble.pulsing::after { animation-delay: 0.9s; }',
      '@keyframes vdPulse {',
      '  0%   { transform: scale(1);   opacity: 0.7; }',
      '  100% { transform: scale(1.5); opacity: 0; }',
      '}',

      // Hide bubble when panel open (mobile only — on desktop the bubble
      // remains visible behind the panel for visual continuity)
      '#vd-chat-bubble.open-mobile { display: none; }',

      // Panel container (holds the iframe)
      '#vd-chat-panel {',
      '  position: fixed;',
      '  bottom: ' + (offset.bottom + bubbleSize + 10) + 'px;',
      '  right: ' + offset.right + 'px;',
      '  width: ' + panelW + 'px;',
      '  height: ' + panelH + 'px;',
      '  max-height: calc(100vh - ' + (offset.bottom + bubbleSize + 30) + 'px);',
      '  border-radius: 16px;',
      '  overflow: hidden;',
      '  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);',
      '  background: #fff;',
      '  z-index: 2147483647;',
      '  display: none;',
      '  transform-origin: bottom right;',
      '  animation: vdPanelIn 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.1);',
      '}',
      '#vd-chat-panel.show { display: block; }',
      '#vd-chat-panel iframe {',
      '  width: 100%;',
      '  height: 100%;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
      '@keyframes vdPanelIn {',
      '  from { opacity: 0; transform: scale(0.9) translateY(10px); }',
      '  to   { opacity: 1; transform: scale(1)   translateY(0); }',
      '}',

      // Mobile fullscreen overlay
      '@media (max-width: ' + mobileBp + 'px) {',
      '  #vd-chat-panel {',
      '    bottom: 0; right: 0; left: 0; top: 0;',
      '    width: 100vw; height: 100vh; max-height: 100vh;',
      '    border-radius: 0;',
      '  }',
      '}',

      // Reduced motion respect
      '@media (prefers-reduced-motion: reduce) {',
      '  #vd-chat-bubble, #vd-chat-bubble::before, #vd-chat-bubble::after, #vd-chat-panel { animation: none !important; transition: none !important; }',
      '}'
    ].join("\n");

    var style = document.createElement("style");
    style.id = "vd-chat-styles";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  // ── DOM construction ─────────────────────────────────────────────────
  function buildDom(label) {
    var mount = document.createElement("div");
    mount.id = CONTAINER_ID;

    var bubble = document.createElement("button");
    bubble.id = "vd-chat-bubble";
    bubble.type = "button";
    bubble.setAttribute("aria-label", label || "Chat with Sam");
    bubble.setAttribute("aria-expanded", "false");
    bubble.setAttribute("aria-controls", "vd-chat-panel");
    // Chat icon — minimal SVG, currentColor so it inherits white from CSS
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
      '</svg>';

    var panel = document.createElement("div");
    panel.id = "vd-chat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Chat panel");

    mount.appendChild(bubble);
    mount.appendChild(panel);
    document.body.appendChild(mount);

    return { mount: mount, bubble: bubble, panel: panel };
  }

  // ── Iframe lazy-load — first click creates iframe, subsequent toggles
  //    just show/hide it. Saves a network round-trip on page load.
  function ensureIframe(panel) {
    if (state.iframeLoaded) return;
    var iframe = document.createElement("iframe");
    iframe.src = WIDGET_URL;
    iframe.title = "Chat with Sam";
    iframe.setAttribute("allow", "clipboard-write");
    iframe.setAttribute("loading", "eager");
    panel.appendChild(iframe);
    state.iframeLoaded = true;
  }

  // ── Open / close ─────────────────────────────────────────────────────
  function openPanel(refs) {
    if (state.open) return;
    ensureIframe(refs.panel);
    refs.panel.classList.add("show");
    refs.bubble.setAttribute("aria-expanded", "true");
    // On mobile, hide bubble while panel is full-screen; on desktop keep it.
    if (window.innerWidth <= ((state.config && state.config.ui && state.config.ui.mobile_breakpoint_px) || 640)) {
      refs.bubble.classList.add("open-mobile");
    }
    refs.bubble.classList.remove("pulsing");
    state.open = true;
    state.pulseFired = true;
  }
  function closePanel(refs) {
    if (!state.open) return;
    refs.panel.classList.remove("show");
    refs.bubble.classList.remove("open-mobile");
    refs.bubble.setAttribute("aria-expanded", "false");
    state.open = false;
  }
  function togglePanel(refs) {
    state.open ? closePanel(refs) : openPanel(refs);
  }

  // ── Pulse — fires once shortly after page load if config flag set ────
  function maybePulse(bubble, ui) {
    if (!ui || !ui.pulse_on_first_load) return;
    if (state.pulseFired) return;
    // Don't pulse if user has visited recently (cookie indicates returning)
    if (document.cookie.indexOf("vd_chat_session=") !== -1) return;
    setTimeout(function() {
      if (state.open || state.pulseFired) return;
      bubble.classList.add("pulsing");
      var pulses = (ui.pulse_count || 2) * 1800; // 1800ms per pulse cycle
      setTimeout(function() { bubble.classList.remove("pulsing"); }, pulses);
    }, 2000);
  }

  // ── Postmessage from widget iframe ───────────────────────────────────
  function listenForWidgetEvents(refs) {
    window.addEventListener("message", function(e) {
      // Accept only from our widget origin
      if (e.origin !== WIDGET_ORIGIN) return;
      var data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "vd-chat-close") {
        closePanel(refs);
      }
      // Future: vd-chat-resize, vd-chat-notify, etc.
    }, false);
  }

  // ── Main init ────────────────────────────────────────────────────────
  async function init() {
    // Wait for body — script may run before <body> is parsed if non-async
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }

    // Load config (used for branding + UI dimensions). Soft-fail: if config
    // can't load, we still mount with sensible defaults so the bubble
    // appears regardless.
    try {
      var res = await fetch(CONFIG_URL, { cache: "default" });
      if (res.ok) state.config = await res.json();
    } catch (e) { /* fall through with defaults */ }

    var brand = (state.config && state.config.brand) || null;
    var ui = (state.config && state.config.ui) || null;
    var label = "Chat with " + (state.config && state.config.bot && state.config.bot.name ? state.config.bot.name : "Sam");

    injectStyles(brand, ui);
    var refs = buildDom(label);

    refs.bubble.addEventListener("click", function() { togglePanel(refs); });
    listenForWidgetEvents(refs);

    // ESC closes panel on desktop
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && state.open) closePanel(refs);
    });

    // Resize: if panel was opened on desktop and viewport drops below mobile
    // breakpoint, the responsive CSS handles it; nothing to do here. Just
    // make sure the open-mobile class state matches viewport.
    window.addEventListener("resize", function() {
      if (!state.open) return;
      var mobileBp = (state.config && state.config.ui && state.config.ui.mobile_breakpoint_px) || 640;
      if (window.innerWidth <= mobileBp) refs.bubble.classList.add("open-mobile");
      else refs.bubble.classList.remove("open-mobile");
    });

    maybePulse(refs.bubble, ui);
  }

  init();
})();
