// ===== 데이터 (Firebase Firestore에 공유 저장) =====
// friends 컬렉션: { name, createdAt }
// quotes  컬렉션: { friend, text, date: "YYYY-MM-DD", createdAt }
const state = { friends: [], quotes: [] }; // friends: [{ id, name }], quotes: [{ id, friend, text, date }]

// ===== 요소 =====
const $ = (id) => document.getElementById(id);
const statusView = $("statusView");
const setupView = $("setupView");
const mainView = $("mainView");
const editFriendsBtn = $("editFriendsBtn");

function showStatus(msg) {
  $("statusText").innerHTML = msg;
  statusView.classList.remove("hidden");
  setupView.classList.add("hidden");
  mainView.classList.add("hidden");
}

// ===== 저장소 초기화 =====
// firebase-config.js가 채워져 있으면 Firebase(공유), 아니면 이 브라우저에만 저장하는 체험 모드
const cfg = window.FIREBASE_CONFIG;
const useFirebase = !!(cfg && cfg.apiKey && !cfg.apiKey.startsWith("YOUR_") && window.firebase);

// Firestore와 같은 사용법(add / doc().delete / orderBy().onSnapshot)을 흉내내는 로컬 컬렉션
function localCollection(name) {
  const key = "friend-quotes-" + name;
  const listeners = [];
  const read = () => JSON.parse(localStorage.getItem(key) || "[]");
  const snapshot = () => ({ docs: read().map((o) => ({ id: o.id, data: () => o.data })) });
  const notify = () => listeners.forEach((cb) => cb(snapshot()));
  const write = (arr) => { localStorage.setItem(key, JSON.stringify(arr)); notify(); };
  window.addEventListener("storage", (e) => e.key === key && notify()); // 다른 탭과 동기화
  return {
    add(data) {
      write([...read(), { id: Date.now().toString(36) + Math.random().toString(36).slice(2), data }]);
      return Promise.resolve();
    },
    doc(id) {
      return { delete: () => (write(read().filter((o) => o.id !== id)), Promise.resolve()) };
    },
    orderBy() { return this; },
    onSnapshot(cb) { listeners.push(cb); cb(snapshot()); },
  };
}

// 계정 없이 공유되는 저장소 (textdb.dev). 전체 데이터를 JSON 하나로 저장하고 몇 초마다 새로고침.
function sharedStore(url) {
  const subs = { friends: [], quotes: [] };
  let data = { friends: [], quotes: [] };
  let lastText = null;
  let loaded = false;

  const parse = (t) => {
    try {
      const d = JSON.parse(t);
      return {
        friends: Array.isArray(d && d.friends) ? d.friends : [],
        quotes: Array.isArray(d && d.quotes) ? d.quotes : [],
      };
    } catch (e) {
      return { friends: [], quotes: [] };
    }
  };
  const fetchText = async () => {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("서버 응답 " + r.status);
    return r.text();
  };
  const emit = () => {
    for (const name in subs) {
      const snap = { docs: data[name].map((o) => ({ id: o.id, data: () => o })) };
      subs[name].forEach((s) => s.cb(snap));
    }
  };
  // 한글 등은 \uXXXX로 바꿔 ASCII로만 전송 (서버 인코딩 문제 방지)
  const toAscii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

  async function refresh() {
    const t = await fetchText();
    if (t !== lastText || !loaded) {
      lastText = t;
      data = parse(t);
      loaded = true;
      emit();
    }
  }

  // 쓰기는 항상 최신 데이터를 받아서 수정 후 저장 (다른 친구 글 덮어쓰기 방지)
  let queue = Promise.resolve();
  function mutate(fn) {
    const job = queue.catch(() => {}).then(async () => {
      const latest = parse(await fetchText());
      fn(latest);
      const body = toAscii(JSON.stringify(latest));
      const r = await fetch(url, { method: "POST", body: new Blob([body], { type: "text/plain" }) });
      if (!r.ok) throw new Error("저장 실패 (" + r.status + ")");
      lastText = body;
      data = latest;
      emit();
    });
    queue = job;
    return job;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

  // 첫 로드 + 체험 모드에서 쓴 데이터가 있으면 한 번 옮겨주기
  const ready = refresh().then(async () => {
    const localF = JSON.parse(localStorage.getItem("friend-quotes-friends") || "[]");
    const localQ = JSON.parse(localStorage.getItem("friend-quotes-quotes") || "[]");
    if (!data.friends.length && !data.quotes.length && (localF.length || localQ.length)) {
      await mutate((d) => {
        d.friends = localF.map((o) => ({ id: o.id, ...o.data }));
        d.quotes = localQ.map((o) => ({ id: o.id, ...o.data }));
      });
      localStorage.removeItem("friend-quotes-friends");
      localStorage.removeItem("friend-quotes-quotes");
    }
    setInterval(() => refresh().catch(console.error), 4000);
  });

  const collection = (name) => ({
    add: (obj) => mutate((d) => d[name].push({ id: uid(), ...obj })),
    doc: (id) => ({ delete: () => mutate((d) => (d[name] = d[name].filter((o) => o.id !== id))) }),
    orderBy() { return this; },
    onSnapshot(cb, errCb) {
      subs[name].push({ cb });
      ready.catch((err) => errCb && errCb(err));
    },
  });
  return { collection };
}

const sharedId = window.SHARED_DB_ID;
let friendsCol, quotesCol, now;
function addBadge(text, title) {
  const badge = document.createElement("span");
  badge.className = "mode-badge";
  badge.textContent = text;
  badge.title = title;
  document.querySelector(".top h1").after(badge);
}

if (useFirebase) {
  firebase.initializeApp(cfg);
  const db = firebase.firestore();
  friendsCol = db.collection("friends");
  quotesCol = db.collection("quotes");
  now = () => firebase.firestore.FieldValue.serverTimestamp();
} else if (sharedId) {
  const store = sharedStore("https://textdb.dev/api/data/" + encodeURIComponent(sharedId));
  friendsCol = store.collection("friends");
  quotesCol = store.collection("quotes");
  now = () => Date.now();
  addBadge("🌐 모두와 공유 중", "이 사이트를 여는 모든 친구가 같은 어록을 봐요");
} else {
  friendsCol = localCollection("friends");
  quotesCol = localCollection("quotes");
  now = () => Date.now();
  addBadge("체험 모드 · 이 브라우저에만 저장", "firebase-config.js에 SHARED_DB_ID를 넣으면 친구들과 공유돼요");
}

function onError(err) {
  console.error(err);
  alert("저장/불러오기 중 오류가 발생했어요: " + err.message);
}

// ===== 날짜 유틸 =====
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDate = toKey(today);

function formatKorean(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dow = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}

// ===== 화면 전환 =====
let currentView = null; // "setup" | "main"

function showSetup() {
  currentView = "setup";
  statusView.classList.add("hidden");
  mainView.classList.add("hidden");
  editFriendsBtn.classList.add("hidden");
  setupView.classList.remove("hidden");
  renderFriends();
  $("friendInput").focus();
}

function showMain() {
  currentView = "main";
  statusView.classList.add("hidden");
  setupView.classList.add("hidden");
  mainView.classList.remove("hidden");
  editFriendsBtn.classList.remove("hidden");
  renderAll();
}

function renderAll() {
  if (currentView === "setup") renderFriends();
  if (currentView === "main") {
    renderFriendSelect();
    renderCalendar();
    renderDay();
  }
}

// ===== 1. 이름 설정 =====
function renderFriends() {
  const list = $("friendList");
  list.innerHTML = "";
  state.friends.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f.name;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = "삭제";
    btn.onclick = () => {
      if (!confirm(`'${f.name}'을(를) 친구 목록에서 삭제할까요? (기존 어록은 유지돼요)`)) return;
      friendsCol.doc(f.id).delete().catch(onError);
    };
    li.appendChild(btn);
    list.appendChild(li);
  });
  $("doneSetupBtn").disabled = state.friends.length === 0;
}

$("friendForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("friendInput");
  const name = input.value.trim();
  if (!name) return;
  if (state.friends.some((f) => f.name === name)) {
    alert("이미 등록된 이름이에요.");
    return;
  }
  friendsCol.add({ name, createdAt: now() }).catch(onError);
  input.value = "";
  input.focus();
});

$("doneSetupBtn").addEventListener("click", showMain);
editFriendsBtn.addEventListener("click", showSetup);

// ===== 2. 달력 =====
function renderCalendar() {
  $("monthLabel").textContent = `${viewYear}년 ${viewMonth + 1}월`;
  const grid = $("calGrid");
  grid.innerHTML = "";

  const counts = {};
  state.quotes.forEach((q) => (counts[q.date] = (counts[q.date] || 0) + 1));

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const days = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty";
    grid.appendChild(empty);
  }
  for (let d = 1; d <= days; d++) {
    const date = new Date(viewYear, viewMonth, d);
    const key = toKey(date);
    const cell = document.createElement("button");
    cell.className = "day-cell";
    if (date.getDay() === 0) cell.classList.add("sun");
    if (date.getDay() === 6) cell.classList.add("sat");
    if (key === toKey(today)) cell.classList.add("today");
    if (key === selectedDate) cell.classList.add("selected");
    cell.innerHTML = `<span>${d}</span>`;
    if (counts[key]) cell.innerHTML += `<span class="badge">${counts[key]}</span>`;
    cell.onclick = () => selectDate(key);
    grid.appendChild(cell);
  }
}

function selectDate(key) {
  selectedDate = key;
  const [y, m] = key.split("-").map(Number);
  viewYear = y;
  viewMonth = m - 1;
  renderCalendar();
  renderDay();
}

$("prevMonth").onclick = () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
};
$("nextMonth").onclick = () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
};
$("todayBtn").onclick = () => selectDate(toKey(today));

// ===== 3. 어록 작성 / 목록 =====
function renderFriendSelect() {
  const sel = $("friendSelect");
  const prev = sel.value;
  sel.innerHTML = "";
  state.friends.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if (state.friends.some((f) => f.name === prev)) sel.value = prev;
}

function renderDay() {
  $("selectedLabel").textContent = `📅 ${formatKorean(selectedDate)}`;
  $("dateInput").value = selectedDate;

  const list = $("quoteList");
  list.innerHTML = "";
  const items = state.quotes.filter((q) => q.date === selectedDate);

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "이 날의 어록이 아직 없어요.";
    list.appendChild(li);
    return;
  }

  items.forEach((q) => {
    const li = document.createElement("li");
    const text = document.createElement("p");
    text.className = "text";
    text.textContent = `“${q.text}”`;
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = `— ${q.friend}`;
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "삭제";
    del.onclick = () => {
      if (!confirm("이 어록을 삭제할까요?")) return;
      quotesCol.doc(q.id).delete().catch(onError);
    };
    li.append(text, who, del);
    list.appendChild(li);
  });
}

$("quoteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("quoteInput").value.trim();
  const friend = $("friendSelect").value;
  const date = $("dateInput").value || selectedDate;
  if (!friend) return alert("친구를 먼저 등록해 주세요.");
  if (!text) return alert("어록 내용을 입력해 주세요.");

  quotesCol.add({ friend, text, date, createdAt: now() }).catch(onError);
  $("quoteInput").value = "";
  selectDate(date);
});

// ===== 실시간 동기화 (친구들이 추가하면 바로 반영) =====
let friendsLoaded = false;

friendsCol.orderBy("createdAt").onSnapshot(
  (snap) => {
    state.friends = snap.docs.map((d) => ({ id: d.id, name: d.data().name }));
    if (!friendsLoaded) {
      friendsLoaded = true;
      if (state.friends.length === 0) showSetup();
      else showMain();
    } else {
      renderAll();
    }
  },
  (err) => showStatus("⚠️ 데이터를 불러오지 못했어요: " + err.message + "<br>Firestore 보안 규칙을 확인해 주세요.")
);

quotesCol.orderBy("createdAt").onSnapshot(
  (snap) => {
    state.quotes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  },
  onError
);
