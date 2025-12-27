// Frontend-only Pomodoro (HTML+CSS+JS) with localStorage
// Features: tabs (focus/short/long), progress ring, start/pause/reset, sound, history, settings, theme.

const SETTINGS_KEY = "pomofocus_settings_v2";
const HISTORY_KEY = "pomofocus_history_v2";

const defaults = {
  theme: "dark",
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  goalSessions: 8,
  autoStart: false,
};

const QUOTES = [
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "It always seems impossible until it’s done.", author: "Nelson Mandela" },
  { text: "Focus is not saying yes to the thing you want, it’s saying no to everything else.", author: "Steve Jobs" }
];


const state = {
  mode: "focus",         // focus | short | long
  running: false,
  totalSec: 25 * 60,
  remainingSec: 25 * 60,
  lastPerf: null,
  interval: null,
  phaseStartISO: null,

  settings: loadSettings(),
  history: loadHistory(), // array newest-first
};

// ===== DOM
const el = {
  dateText: document.getElementById("dateText"),
  menuBtn: document.getElementById("menuBtn"),
  menu: document.getElementById("menu"),
  themeToggle: document.getElementById("themeToggle"),

  tabs: Array.from(document.querySelectorAll(".tab")),

  ringFg: document.getElementById("ringFg"),
  timeText: document.getElementById("timeText"),
  phaseText: document.getElementById("phaseText"),

  startPauseBtn: document.getElementById("startPauseBtn"),
  playIcon: document.getElementById("playIcon"),
  resetBtn: document.getElementById("resetBtn"),

  goalDone: document.getElementById("goalDone"),
  goalTotal: document.getElementById("goalTotal"),
  goalHint: document.getElementById("goalHint"),
  sessionProgressFill: document.getElementById("sessionProgressFill"),

  focusedMins: document.getElementById("focusedMins"),
  lastSessionText: document.getElementById("lastSessionText"),

  // Modals
  historyModal: document.getElementById("historyModal"),
  settingsModal: document.getElementById("settingsModal"),
  openHistory: document.getElementById("openHistory"),
  openSettings: document.getElementById("openSettings"),
  closeHistory: document.getElementById("closeHistory"),
  closeSettings: document.getElementById("closeSettings"),
  historyList: document.getElementById("historyList"),

  // Quotes
  quoteText: document.getElementById("quoteText"),
  quoteAuthor: document.getElementById("quoteAuthor"),


  // Settings inputs
  focusInput: document.getElementById("focusInput"),
  shortInput: document.getElementById("shortInput"),
  longInput: document.getElementById("longInput"),
  goalInput: document.getElementById("goalInput"),
  autoStartToggle: document.getElementById("autoStartToggle"),
  testSound: document.getElementById("testSound"),
  clearData: document.getElementById("clearData"),
};

// ===== Random Quote generator
function setRandomQuote(){
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  el.quoteText.textContent = `“${q.text}”`;
  el.quoteAuthor.textContent = `— ${q.author}`;
}


// ===== Helpers
function pad2(n){ return String(n).padStart(2, "0"); }
function fmtMMSS(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function todayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function setDateHeader(){
  const now = new Date();
  const opts = { weekday:"long", month:"long", day:"numeric" };
  el.dateText.textContent = now.toLocaleDateString(undefined, opts);
}

// ===== Storage
function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  }catch{
    return { ...defaults };
  }
}
function saveSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function loadHistory(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}
function saveHistory(){
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function clearAll(){
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(HISTORY_KEY);
}

// ===== Audio beep (no file)
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    o.stop(ctx.currentTime + 0.4);
    o.onended = () => ctx.close();
  }catch{}
}

// ===== Theme
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.settings.theme === "light" ? "light" : "dark");
}
function toggleTheme(){
  state.settings.theme = (state.settings.theme === "dark") ? "light" : "dark";
  saveSettings();
  applyTheme();
}

// ===== Ring math
const R = 120;
const CIRC = 2 * Math.PI * R;

function setRing(){
  const progress = 1 - (state.remainingSec / Math.max(1, state.totalSec)); // 0..1
  const offset = CIRC * (1 - progress);
  el.ringFg.style.strokeDasharray = String(CIRC);
  el.ringFg.style.strokeDashoffset = String(offset);
}

// ===== Mode durations
function modeToMinutes(mode){
  if(mode === "focus") return state.settings.focusMin;
  if(mode === "short") return state.settings.shortMin;
  return state.settings.longMin;
}

function modeLabel(mode){
  if(mode === "focus") return "FOCUS";
  if(mode === "short") return "SHORT BREAK";
  return "LONG BREAK";
}

function setMode(mode){
  state.mode = mode;
  // update tabs
  el.tabs.forEach(t => {
    const active = t.dataset.mode === mode;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });

  // different ring color per mode
  if(mode === "focus"){
    el.ringFg.style.stroke = "var(--accent)";
  }else{
    // break: slightly dimmer
    el.ringFg.style.stroke = "rgba(155,140,255,0.75)";
  }

  // reset timer to mode duration (only if not running)
  if(!state.running){
    resetTimer(true);
  }else{
    // if running, keep current countdown to avoid sudden changes
    el.phaseText.textContent = modeLabel(mode);
  }
}

// ===== Timer controls
function start(){
  if(state.running) return;
  state.running = true;
  el.playIcon.textContent = "❚❚";
  if(!state.phaseStartISO) state.phaseStartISO = new Date().toISOString();
  if(!state.interval) state.interval = setInterval(tick, 250);
}

function pause(){
  state.running = false;
  el.playIcon.textContent = "▶";
  if(state.interval){
    clearInterval(state.interval);
    state.interval = null;
  }
}

function resetTimer(keepMode){
  pause();
  state.lastPerf = null;
  state.phaseStartISO = null;

  if(!keepMode) state.mode = "focus";

  state.totalSec = modeToMinutes(state.mode) * 60;
  state.remainingSec = state.totalSec;

  el.timeText.textContent = fmtMMSS(state.remainingSec);
  el.phaseText.textContent = modeLabel(state.mode);
  setRing();
}

function tick(){
  if(!state.running) return;
  const now = performance.now();
  if(state.lastPerf == null) state.lastPerf = now;
  const dt = (now - state.lastPerf) / 1000;
  state.lastPerf = now;

  state.remainingSec -= dt;

  if(state.remainingSec <= 0){
    // session completed
    const endedISO = new Date().toISOString();
    const startedISO = state.phaseStartISO || new Date(Date.now() - state.totalSec*1000).toISOString();

    // log it
    state.history.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      day: todayKey(),
      mode: state.mode,          // focus/short/long
      duration: state.totalSec,
      startedAt: startedISO,
      endedAt: endedISO
    });
    if(state.history.length > 200) state.history.length = 200;
    saveHistory();

    beep();
    updateBottom();

    // after finishing: if focus -> go short break; if short -> focus; if long -> focus
    if(state.mode === "focus") setMode("short");
    else setMode("focus");

    // always reset to new mode duration
    state.totalSec = modeToMinutes(state.mode) * 60;
    state.remainingSec = state.totalSec;
    state.phaseStartISO = new Date().toISOString();
    state.lastPerf = null;
    el.timeText.textContent = fmtMMSS(state.remainingSec);
    el.phaseText.textContent = modeLabel(state.mode);
    setRing();

    if(!state.settings.autoStart){
      pause();
    }
  }else{
    el.timeText.textContent = fmtMMSS(state.remainingSec);
    setRing();
  }
}

// ===== Bottom cards (match screenshot)
function updateBottom(){
  const t = todayKey();
  let focusSessions = 0;
  let focusSeconds = 0;
  let lastFocus = null;

  for(const item of state.history){
    if(item.day !== t) continue;

    if(item.mode === "focus"){
      focusSessions += 1;
      focusSeconds += item.duration;
      if(!lastFocus) lastFocus = item;
    }
  }

  const mins = Math.floor(focusSeconds / 60);

  el.goalTotal.textContent = String(state.settings.goalSessions);
  el.goalDone.textContent = String(focusSessions);

  const pct = Math.max(0, Math.min(100, (focusSessions / Math.max(1, state.settings.goalSessions)) * 100));
  el.sessionProgressFill.style.width = pct + "%";

  const remaining = Math.max(0, state.settings.goalSessions - focusSessions);
  el.goalHint.textContent = `${remaining} more to reach your goal`;

  el.focusedMins.textContent = String(mins);

  if(lastFocus){
    const when = new Date(lastFocus.startedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    el.lastSessionText.textContent = `Last session: ${when}`;
  }else{
    el.lastSessionText.textContent = "Last session: None yet";
  }
}

// ===== History modal
function openModal(m){
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");
}
function closeModal(m){
  m.classList.remove("show");
  m.setAttribute("aria-hidden","true");
}

function renderHistory(){
  if(state.history.length === 0){
    el.historyList.innerHTML = `<div class="muted small">No sessions yet.</div>`;
    return;
  }

  const items = state.history.slice(0, 60);
  el.historyList.innerHTML = items.map(it => {
    const when = new Date(it.startedAt).toLocaleString();
    const mins = Math.round(it.duration / 60);
    return `
      <div class="historyItem">
        <div>
          <div class="t">${when}</div>
          <div class="s">${mins} min • ${it.mode}</div>
        </div>
        <div class="tag">${it.mode.toUpperCase()}</div>
      </div>
    `;
  }).join("");
}

// ===== Menu behavior
function toggleMenu(){
  el.menu.classList.toggle("show");
}
function closeMenu(){
  el.menu.classList.remove("show");
}

// ===== Settings UI
function syncSettingsUI(){
  el.focusInput.value = state.settings.focusMin;
  el.shortInput.value = state.settings.shortMin;
  el.longInput.value = state.settings.longMin;
  el.goalInput.value = state.settings.goalSessions;
  el.autoStartToggle.checked = !!state.settings.autoStart;
}

function applySettingsFromUI(){
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  state.settings.focusMin = clamp(Number(el.focusInput.value || 25), 1, 120);
  state.settings.shortMin = clamp(Number(el.shortInput.value || 5), 1, 60);
  state.settings.longMin = clamp(Number(el.longInput.value || 15), 1, 90);
  state.settings.goalSessions = clamp(Number(el.goalInput.value || 8), 1, 30);
  state.settings.autoStart = !!el.autoStartToggle.checked;

  saveSettings();
  updateBottom();
  // reset timer to reflect current mode duration
  if(!state.running){
    resetTimer(true);
  }
}

// ===== Events
el.menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});

document.addEventListener("click", (e) => {
  // close menu if click outside
  if(!el.menu.contains(e.target) && e.target !== el.menuBtn){
    closeMenu();
  }
});

el.themeToggle.addEventListener("click", () => {
  toggleTheme();
  closeMenu();
});

el.openHistory.addEventListener("click", () => {
  closeMenu();
  renderHistory();
  openModal(el.historyModal);
});

el.openSettings.addEventListener("click", () => {
  closeMenu();
  syncSettingsUI();
  openModal(el.settingsModal);
});

el.closeHistory.addEventListener("click", () => closeModal(el.historyModal));
el.closeSettings.addEventListener("click", () => {
  applySettingsFromUI();
  closeModal(el.settingsModal);
});

// close modal by clicking backdrop
el.historyModal.addEventListener("click", (e) => { if(e.target === el.historyModal) closeModal(el.historyModal); });
el.settingsModal.addEventListener("click", (e) => { if(e.target === el.settingsModal) closeModal(el.settingsModal); });

// Tabs
el.tabs.forEach(t => {
  t.addEventListener("click", () => {
    const mode = t.dataset.mode;
    setMode(mode);
  });
});

// Start/pause
el.startPauseBtn.addEventListener("click", () => {
  if(state.running) pause();
  else start();
});

// Reset
el.resetBtn.addEventListener("click", () => resetTimer(true));

el.testSound.addEventListener("click", () => beep());

el.clearData.addEventListener("click", () => {
  if(!confirm("Clear history and settings stored in this browser?")) return;
  clearAll();
  state.settings = { ...defaults };
  state.history = [];
  saveSettings();
  saveHistory();
  applyTheme();
  setMode("focus");
  resetTimer(false);
  updateBottom();
  closeModal(el.settingsModal);
});

// Live-apply when inputs change (optional but nice)
["focusInput","shortInput","longInput","goalInput","autoStartToggle"].forEach(id => {
  el[id].addEventListener("change", () => applySettingsFromUI());
});

// ===== Init
function init(){
  // theme + header
  applyTheme();
  setDateHeader();
  setInterval(setDateHeader, 60_000);

  // ring init
  el.ringFg.style.strokeDasharray = String(CIRC);
  el.ringFg.style.strokeDashoffset = String(0);

  // apply initial mode and timer
  setMode("focus");
  resetTimer(true);

  // bottom stats
  updateBottom();

  // quote
  setRandomQuote();

}

init();
