// ============================================================
// 글감 데스크 — 글쓰기 파이프라인 앱
// 데이터: localStorage 기본 저장 + 선택적 Firebase Realtime DB 동기화
// AI 호출: /api/claude (텍스트 생성), /api/search (웹 검색 포함 생성)
// ============================================================

const STAGES = [
  { id: "idea",     label: "주제 발굴",   short: "발굴", accent: "#8A8780" },
  { id: "research", label: "검색·리서치", short: "검색", accent: "#1B2A4A" },
  { id: "verify",   label: "사실 검증",   short: "검증", accent: "#1B2A4A" },
  { id: "knowhow",  label: "나의 노하우", short: "노하우", accent: "#C73E1D" },
  { id: "draft",    label: "AI 초고",     short: "초고", accent: "#C73E1D" },
  { id: "edit",     label: "수정·보강",   short: "수정", accent: "#3D6B4F" },
  { id: "seo",      label: "SEO·구조",    short: "SEO", accent: "#3D6B4F" },
  { id: "publish",  label: "발행 준비",   short: "발행", accent: "#3D6B4F" },
  { id: "done",     label: "발행 완료",   short: "완료", accent: "#26262A" },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

function uid() {
  return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// 현재 사용자가 input/textarea에 포커스를 두고 타이핑 중인지 확인.
// 이 동안에는 Firebase 원격 동기화로 인한 전체 리렌더링을 막아
// 입력 중인 칸이 통째로 다시 그려지면서 입력이 끊기는 문제를 방지한다.
function isEditingActiveElement() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT";
}

function nowISO() {
  return new Date().toISOString();
}

function emptyPost() {
  return {
    id: uid(),
    title: "",
    stage: "idea",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    // 1. 주제 발굴
    ideaSeed: "",          // 사용자가 던지는 막연한 관심사/키워드
    ideaCandidates: [],    // [{id, text, score, note}] AI가 추천한 주제 후보
    ideaChosen: "",        // 최종 확정된 주제
    // 2. 검색·리서치
    researchQueries: [],   // [{id, query, result, sources:[{title,url}], createdAt}]
    researchNotes: "",     // 직접 정리한 리서치 메모
    // 3. 사실 검증
    verifyItems: [],       // [{id, claim, status: 'unchecked'|'ok'|'fail', note}]
    // 4. 나의 노하우
    knowhowNotes: "",      // 본인 경험/사례/1차 정보
    // 5. AI 초고
    draftPrompt: "",       // 사용자가 다듬은 최종 프롬프트
    draftOutput: "",       // AI가 생성한 초고
    draftHistory: [],      // 과거 생성본들 [{id, output, createdAt}]
    // 6. 수정·보강
    editedContent: "",     // 사람이 수정한 본문
    editNotes: "",         // 수정 시 참고한 점, 보강 아이디어
    // 7. SEO·구조
    seoTitle: "",
    seoDescription: "",
    seoKeywords: "",
    seoChecklist: [],       // [{id, text, checked}]
    // 8. 발행 준비
    publishChecklist: [],   // [{id, text, checked}]
    publishPlatform: "",    // 티스토리/네이버블로그 등
    publishUrl: "",
    // 9. 발행 완료
    publishedAt: "",
    notesAfter: "",         // 발행 후 성과/회고 메모
  };
}

function defaultSeoChecklist() {
  return [
    { id: uid(), text: "제목에 핵심 키워드 포함", checked: false },
    { id: uid(), text: "h2/h3 소제목 구조 정리", checked: false },
    { id: uid(), text: "메타 설명(요약) 작성", checked: false },
    { id: uid(), text: "이미지 alt 텍스트 작성", checked: false },
    { id: uid(), text: "내부/외부 링크 1개 이상 삽입", checked: false },
  ];
}

function defaultPublishChecklist() {
  return [
    { id: uid(), text: "표절·중복 검사 실행", checked: false },
    { id: uid(), text: "팩트체크 항목 전부 확인 완료", checked: false },
    { id: uid(), text: "내 경험/노하우 단락 포함 확인", checked: false },
    { id: uid(), text: "오탈자·맞춤법 검사", checked: false },
    { id: uid(), text: "썸네일/이미지 준비", checked: false },
  ];
}

// ============================================================
// Firebase Realtime DB는 빈 배열([])이나 빈 문자열("")을 저장하면
// 해당 키를 통째로 삭제하고, 다시 읽을 때 undefined를 반환한다.
// 그래서 항상 이 함수를 거쳐 배열·문자열 필드들이
// undefined가 되지 않도록 보정한다. 모든 곳에서 post를 가져올 때 이 함수를 통과시킨다.
// ============================================================
function normalizePost(raw) {
  const base = emptyPost();
  const post = { ...base, ...raw };
  const arrayFields = [
    "ideaCandidates", "researchQueries", "verifyItems",
    "draftHistory", "seoChecklist", "publishChecklist",
  ];
  arrayFields.forEach((key) => {
    if (!Array.isArray(post[key])) post[key] = [];
  });
  const stringFields = [
    "title", "ideaSeed", "ideaChosen", "researchNotes", "knowhowNotes",
    "draftPrompt", "draftOutput", "editedContent", "editNotes",
    "seoTitle", "seoDescription", "seoKeywords", "publishPlatform",
    "publishUrl", "publishedAt", "notesAfter",
  ];
  stringFields.forEach((key) => {
    if (typeof post[key] !== "string") post[key] = "";
  });
  return post;
}

// ============================================================
// 기본 Firebase 설정 (정을균 님의 writing-studio-jek 프로젝트)
// 별도 설정 없이 앱을 처음 열면 자동으로 이 설정으로 연결을 시도합니다.
// ============================================================
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBpoGZ7dsuN9VmUx2nWEXZO3WumLrJNb4I",
  authDomain: "writing-studio-jek.firebaseapp.com",
  projectId: "writing-studio-jek",
  storageBucket: "writing-studio-jek.firebasestorage.app",
  messagingSenderId: "335872656979",
  appId: "1:335872656979:web:abe793eb40e314e87e28a6",
  measurementId: "G-HJERZEMH49",
  databaseURL: "https://writing-studio-jek-default-rtdb.firebaseio.com",
};

// ============================================================
// 저장소 레이어 (localStorage + 선택적 Firebase)
// ============================================================
const Store = {
  posts: {},
  firebaseApp: null,
  firebaseDb: null,
  firebaseEnabled: false,

  LOCAL_KEY: "blogpipeline_posts_v1",
  FIREBASE_CONFIG_KEY: "blogpipeline_firebase_config_v1",

  loadLocal() {
    try {
      const raw = localStorage.getItem(this.LOCAL_KEY);
      this.posts = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error("로컬 데이터 로드 실패", e);
      this.posts = {};
    }
  },

  saveLocal() {
    try {
      localStorage.setItem(this.LOCAL_KEY, JSON.stringify(this.posts));
    } catch (e) {
      console.error("로컬 데이터 저장 실패", e);
      showToast("로컬 저장에 실패했습니다. 저장 공간을 확인하세요.", "error");
    }
  },

  async tryInitFirebase() {
    const raw = localStorage.getItem(this.FIREBASE_CONFIG_KEY);
    const configStr = raw || JSON.stringify(DEFAULT_FIREBASE_CONFIG);
    if (!raw) {
      // 처음 실행이면 기본 설정을 저장해두고 사용
      localStorage.setItem(this.FIREBASE_CONFIG_KEY, configStr);
    }
    try {
      const config = JSON.parse(configStr);
      this.firebaseApp = firebase.initializeApp(config);
      this.firebaseDb = firebase.database();
      this.firebaseEnabled = true;
      this.listenFirebase();
      setFirebaseStatus(true);
    } catch (e) {
      console.error("Firebase 초기화 실패", e);
      setFirebaseStatus(false, e.message);
    }
  },

  // 내가 직접 Store.upsertPost()로 Firebase에 쓴 직후 들어오는 echo 콜백을
  // 구분하기 위한 타임스탬프. 이 값 이후 짧은 시간 안에 트리거된 'value' 콜백은
  // 화면을 다시 그리지 않고 데이터만 동기화한다.
  lastLocalWriteAt: 0,

  listenFirebase() {
    if (!this.firebaseDb) return;
    this.firebaseDb.ref("posts").on("value", (snap) => {
      const remote = snap.val() || {};
      const normalizedRemote = {};
      Object.keys(remote).forEach((id) => {
        normalizedRemote[id] = normalizePost(remote[id]);
      });
      this.posts = normalizedRemote;
      this.saveLocal();
      const isLikelyEcho = Date.now() - this.lastLocalWriteAt < 1500;
      // 입력칸에 포커스가 있는 동안(타이핑 중)이거나, 방금 내가 직접 쓴
      // 데이터의 echo로 추정될 때는 화면을 다시 그리지 않는다.
      // 그렇지 않으면 타이핑 중에 DOM이 교체되어 입력이 끊긴다.
      if (isEditingActiveElement() || isLikelyEcho) return;
      renderBoard();
      if (currentPostId && this.posts[currentPostId]) {
        renderPostView();
      }
    });
  },

  async connectFirebase(configStr) {
    try {
      const config = JSON.parse(configStr);
      localStorage.setItem(this.FIREBASE_CONFIG_KEY, configStr);
      if (this.firebaseApp) {
        await this.firebaseApp.delete();
      }
      this.firebaseApp = firebase.initializeApp(config);
      this.firebaseDb = firebase.database();
      this.firebaseEnabled = true;
      // 기존 로컬 데이터를 한 번 업로드(머지)
      const localPosts = this.posts;
      const snap = await this.firebaseDb.ref("posts").get();
      const remote = snap.val() || {};
      const merged = { ...remote, ...localPosts };
      await this.firebaseDb.ref("posts").set(merged);
      this.listenFirebase();
      setFirebaseStatus(true);
      showToast("Firebase에 연결되었습니다.", "success");
    } catch (e) {
      console.error(e);
      setFirebaseStatus(false, e.message);
      showToast("Firebase 연결 실패: " + e.message, "error");
    }
  },

  upsertPost(post) {
    post.updatedAt = nowISO();
    const normalized = normalizePost(post);
    this.posts[normalized.id] = normalized;
    this.saveLocal();
    if (this.firebaseEnabled && this.firebaseDb) {
      this.lastLocalWriteAt = Date.now();
      this.firebaseDb.ref("posts/" + normalized.id).set(normalized).catch((e) => {
        console.error("Firebase 저장 실패", e);
      });
    }
  },

  deletePost(id) {
    delete this.posts[id];
    this.saveLocal();
    if (this.firebaseEnabled && this.firebaseDb) {
      this.firebaseDb.ref("posts/" + id).remove().catch((e) => console.error(e));
    }
  },

  getPost(id) {
    const raw = this.posts[id];
    if (!raw) return undefined;
    return normalizePost(raw);
  },

  allPosts() {
    return Object.values(this.posts)
      .map((p) => normalizePost(p))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  },
};

function setFirebaseStatus(connected, errMsg) {
  const el = document.getElementById("firebase-status");
  const labelEl = document.getElementById("storage-mode-label");
  if (!el) return;
  if (connected) {
    el.textContent = "✓ Firebase에 연결되어 실시간 동기화 중";
    el.style.color = "var(--green-stamp)";
    if (labelEl) labelEl.textContent = "Firebase Realtime Database (동기화 중)";
  } else {
    el.textContent = errMsg
      ? "연결 실패: " + errMsg + " — Firebase 콘솔에서 Realtime Database를 생성/활성화했는지 확인하세요."
      : "연결되지 않음 — 로컬 저장소만 사용 중";
    el.style.color = "var(--grey)";
    if (labelEl) labelEl.textContent = "이 브라우저(로컬 저장소)";
  }
}

// ============================================================
// 토스트 알림
// ============================================================
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast" + (type !== "info" ? " " + type : "");
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ============================================================
// API 호출 헬퍼
// ============================================================
async function callClaude(messages, systemPrompt, maxTokens) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      max_tokens: maxTokens || 4096,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "AI 호출 실패");
  }
  const textBlocks = (data.content || []).filter((c) => c.type === "text").map((c) => c.text);
  return textBlocks.join("\n");
}

async function callSearch(query, instruction) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, instruction }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "검색 호출 실패");
  }
  const textBlocks = (data.content || []).filter((c) => c.type === "text").map((c) => c.text);
  // 출처 추출 (web_search_tool_result 안의 citations 등에서)
  const sources = [];
  (data.content || []).forEach((block) => {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      block.content.forEach((item) => {
        if (item.url) sources.push({ title: item.title || item.url, url: item.url });
      });
    }
  });
  return { text: textBlocks.join("\n"), sources };
}

// ============================================================
// 보드(칸반) 렌더링
// ============================================================
let currentPostId = null;
let boardSearchTerm = "";

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  const allPosts = Store.allPosts().filter((p) => {
    if (!boardSearchTerm) return true;
    const term = boardSearchTerm.toLowerCase();
    return (
      (p.title || "").toLowerCase().includes(term) ||
      (p.ideaChosen || "").toLowerCase().includes(term) ||
      (p.ideaSeed || "").toLowerCase().includes(term)
    );
  });

  STAGES.forEach((stage) => {
    const col = document.createElement("div");
    col.className = "board-column";
    col.style.setProperty("--col-accent", stage.accent);

    const postsInStage = allPosts.filter((p) => p.stage === stage.id);

    col.innerHTML = `
      <div class="board-column-head">
        <span class="board-column-title">${stage.label}</span>
        <span class="board-column-count">${postsInStage.length}</span>
      </div>
      <div class="board-column-body" id="col-body-${stage.id}"></div>
    `;
    board.appendChild(col);

    const body = col.querySelector(".board-column-body");
    if (postsInStage.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-column-hint";
      hint.textContent = "비어 있음";
      body.appendChild(hint);
    } else {
      postsInStage.forEach((post) => {
        const card = document.createElement("div");
        card.className = "post-card";
        card.style.setProperty("--col-accent", stage.accent);
        const titleText = post.title || post.ideaChosen || "(제목 없음)";
        const isUntitled = !post.title;
        card.innerHTML = `
          <div class="post-card-title ${isUntitled ? "untitled" : ""}">${escapeHtml(titleText)}</div>
          <div class="post-card-meta">
            <span>${formatDate(post.updatedAt)}</span>
          </div>
        `;
        card.addEventListener("click", () => openPost(post.id));
        body.appendChild(card);
      });
    }
  });

  document.getElementById("board-stats").textContent =
    `전체 ${allPosts.length}건 · 발행완료 ${allPosts.filter((p) => p.stage === "done").length}건`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ============================================================
// 화면 전환
// ============================================================
function showBoardView() {
  document.getElementById("board-view").classList.remove("hidden");
  document.getElementById("post-view").classList.add("hidden");
  currentPostId = null;
  renderBoard();
}

function openPost(id) {
  currentPostId = id;
  document.getElementById("board-view").classList.add("hidden");
  document.getElementById("post-view").classList.remove("hidden");
  renderPostView();
}

function createNewPost() {
  const post = emptyPost();
  post.seoChecklist = defaultSeoChecklist();
  post.publishChecklist = defaultPublishChecklist();
  Store.upsertPost(post);
  openPost(post.id);
}

// ============================================================
// 글 상세(워크스페이스) 뷰
// ============================================================
let activeStageTab = "idea";

function renderPostView() {
  const post = Store.getPost(currentPostId);
  if (!post) { showBoardView(); return; }

  document.getElementById("post-title-input").value = post.title || "";

  const stageSelect = document.getElementById("post-stage-select");
  stageSelect.innerHTML = STAGES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  stageSelect.value = post.stage;

  if (!STAGES.find((s) => s.id === activeStageTab)) activeStageTab = post.stage;
  renderStageTabs(post);
  renderStagePanels(post);
}

function renderStageTabs(post) {
  const tabsEl = document.getElementById("stage-tabs");
  const currentIdx = STAGE_INDEX[post.stage];
  tabsEl.innerHTML = STAGES.map((s, i) => {
    const isDone = i < currentIdx;
    const isActive = s.id === activeStageTab;
    return `
      <button class="stage-tab ${isActive ? "active" : ""} ${isDone ? "done" : ""}" data-stage="${s.id}">
        <span class="num">${isDone ? "✓" : i + 1}</span>
        <span>${s.short}</span>
      </button>
    `;
  }).join("");

  tabsEl.querySelectorAll(".stage-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeStageTab = btn.dataset.stage;
      renderStageTabs(post);
      renderStagePanels(post);
    });
  });
}

function renderStagePanels(post) {
  const panelsEl = document.getElementById("stage-panels");
  panelsEl.innerHTML = STAGES.map((s) => `<div class="stage-panel ${s.id === activeStageTab ? "active" : ""}" id="panel-${s.id}"></div>`).join("");

  const renderers = {
    idea: renderIdeaPanel,
    research: renderResearchPanel,
    verify: renderVerifyPanel,
    knowhow: renderKnowhowPanel,
    draft: renderDraftPanel,
    edit: renderEditPanel,
    seo: renderSeoPanel,
    publish: renderPublishPanel,
    done: renderDonePanel,
  };

  STAGES.forEach((s) => {
    const container = document.getElementById(`panel-${s.id}`);
    if (renderers[s.id]) renderers[s.id](container, post);
  });
}

function saveAndRefresh(post, skipFullRerender) {
  Store.upsertPost(post);
  if (!skipFullRerender) renderBoard();
}

// 텍스트 입력(input/textarea)처럼 타이핑마다 발생하는 변경은 매 키 입력마다
// Firebase에 쓰지 않고 일정 시간(디바운스) 후 한 번만 저장한다.
// 불필요한 네트워크 쓰기를 줄이고, 자신이 쓴 데이터의 echo가 타이핑 도중
// 돌아와 입력을 끊는 문제를 추가로 줄여준다.
const _debounceTimers = {};
function saveAndRefreshDebounced(post, delay = 500) {
  const key = post.id;
  if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(() => {
    delete _debounceTimers[key];
    Store.upsertPost(post);
  }, delay);
}

function advanceStage(post, nextStageId) {
  post.stage = nextStageId;
  saveAndRefresh(post);
  activeStageTab = nextStageId;
  renderPostView();
  showToast(`'${STAGES.find(s=>s.id===nextStageId).label}' 단계로 이동했습니다.`, "success");
}

function nextStageId(currentId) {
  const idx = STAGE_INDEX[currentId];
  return STAGES[Math.min(idx + 1, STAGES.length - 1)].id;
}

// ============================================================
// 1단계: 주제 발굴
// ============================================================
function renderIdeaPanel(container, post) {
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">막연한 관심사를 던져보세요</h3>
          <p class="panel-desc">전문 분야, 최근 겪은 일, 자주 받는 질문 등 키워드나 한두 문장이면 충분합니다.</p>
        </div>
      </div>
      <div class="field-group">
        <textarea id="idea-seed" class="field" placeholder="예: 개별주택가격 이의신청 절차가 민원인들에게 헷갈리는 부분이 많다">${escapeHtml(post.ideaSeed)}</textarea>
      </div>
      <div class="panel-tools">
        <button id="btn-suggest-ideas" class="btn btn-primary">AI에게 주제 추천받기</button>
      </div>
      <div id="idea-ai-output" class="ai-output hidden" style="margin-top:14px;"></div>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">주제 후보</h3>
          <p class="panel-desc">마음에 드는 후보를 선택하면 최종 주제로 확정됩니다.</p>
        </div>
      </div>
      <div class="idea-list" id="idea-candidates-list"></div>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">확정된 주제</h3>
        </div>
      </div>
      <input id="idea-chosen" class="field" placeholder="후보에서 선택하거나 직접 입력하세요" value="${escapeHtml(post.ideaChosen)}" />
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-idea-next" class="btn btn-primary" ${!post.ideaChosen ? "disabled" : ""}>주제 확정 → 검색·리서치로 이동</button>
      </div>
    </div>
  `;

  container.querySelector("#idea-seed").addEventListener("input", (e) => {
    post.ideaSeed = e.target.value;
    saveAndRefreshDebounced(post);
  });

  container.querySelector("#idea-chosen").addEventListener("input", (e) => {
    post.ideaChosen = e.target.value;
    if (!post.title) post.title = e.target.value;
    saveAndRefreshDebounced(post);
    container.querySelector("#btn-idea-next").disabled = !post.ideaChosen;
  });

  container.querySelector("#btn-suggest-ideas").addEventListener("click", async () => {
    if (!post.ideaSeed.trim()) {
      showToast("관심사나 키워드를 먼저 입력해주세요.", "error");
      return;
    }
    const outputEl = container.querySelector("#idea-ai-output");
    outputEl.classList.remove("hidden");
    outputEl.classList.add("loading");
    outputEl.textContent = "주제를 구상하는 중…";
    const btn = container.querySelector("#btn-suggest-ideas");
    btn.disabled = true;
    try {
      const system = `너는 블로그 콘텐츠 기획 전문가다. 사용자는 한국의 공공기관 실무자이자 코칭 전문가로, 주택가격평가/세무행정/코칭심리학 등 전문 분야를 갖고 있다. 사용자가 던진 관심사를 바탕으로, 검색 수요가 있으면서도 경쟁이 적은 블로그 주제 5개를 추천하라. 각 주제는 "제목 후보"와 "이 주제가 좋은 이유(1줄)"를 함께 제시하라. 반드시 아래 JSON 배열 형식으로만 응답하라. 다른 설명, 코드블록 표시 없이 순수 JSON만 출력하라.
형식: [{"title": "제목 후보", "reason": "이 주제가 좋은 이유"}, ...]`;
      const userMsg = `관심사/키워드: ${post.ideaSeed}`;
      const raw = await callClaude([{ role: "user", content: userMsg }], system, 1500);
      let parsed;
      try {
        const cleaned = raw.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        outputEl.classList.remove("loading");
        outputEl.textContent = raw;
        showToast("AI 응답을 목록으로 변환하지 못해 원문으로 표시했습니다.", "error");
        return;
      }
      post.ideaCandidates = parsed.map((p) => ({ id: uid(), text: p.title, score: p.reason, note: "" }));
      outputEl.classList.add("hidden");
      saveAndRefresh(post, true);
      renderIdeaPanel(container, post);
      showToast("주제 후보 " + parsed.length + "개를 받았습니다.", "success");
    } catch (e) {
      outputEl.classList.remove("loading");
      outputEl.textContent = "오류: " + e.message;
      showToast("주제 추천 중 오류가 발생했습니다: " + e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  const listEl = container.querySelector("#idea-candidates-list");
  if (post.ideaCandidates.length === 0) {
    listEl.innerHTML = `<div class="empty-column-hint">아직 추천받은 주제가 없습니다.</div>`;
  } else {
    listEl.innerHTML = post.ideaCandidates.map((c) => `
      <div class="idea-item ${post.ideaChosen === c.text ? "picked" : ""}" data-id="${c.id}">
        <div class="idea-item-text">
          <div>${escapeHtml(c.text)}</div>
          <div class="hint">${escapeHtml(c.score || "")}</div>
        </div>
        <button class="btn btn-small btn-secondary pick-idea-btn" data-text="${escapeHtml(c.text)}">이 주제로</button>
      </div>
    `).join("");
    listEl.querySelectorAll(".pick-idea-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        post.ideaChosen = btn.dataset.text;
        if (!post.title) post.title = post.ideaChosen;
        saveAndRefresh(post, true);
        renderIdeaPanel(container, post);
      });
    });
  }

  container.querySelector("#btn-idea-next").addEventListener("click", () => {
    advanceStage(post, "research");
  });
}

// ============================================================
// 2단계: 검색·리서치
// ============================================================
function renderResearchPanel(container, post) {
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">주제: ${escapeHtml(post.ideaChosen || "(미확정)")}</h3>
          <p class="panel-desc">검색하고 싶은 질문이나 키워드를 입력하면 AI가 웹을 검색해 출처와 함께 정리해줍니다.</p>
        </div>
      </div>
      <div class="field-group" style="display:flex; gap:8px;">
        <input id="research-query-input" class="field" placeholder="예: 개별주택가격 이의신청 처리 기한 법적 근거" />
        <button id="btn-run-research" class="btn btn-primary" style="flex-shrink:0;">검색 실행</button>
      </div>
      <div id="research-ai-output" class="ai-output hidden"></div>
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">리서치 기록</h3></div>
      <div id="research-history-list"></div>
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">직접 정리한 메모</h3></div>
      <textarea id="research-notes" class="field" placeholder="검색 결과 중 중요한 부분, 추가로 확인해야 할 점 등을 직접 정리하세요">${escapeHtml(post.researchNotes)}</textarea>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-research-next" class="btn btn-primary">리서치 완료 → 사실 검증으로 이동</button>
      </div>
    </div>
  `;

  container.querySelector("#research-notes").addEventListener("input", (e) => {
    post.researchNotes = e.target.value;
    saveAndRefreshDebounced(post);
  });

  container.querySelector("#btn-run-research").addEventListener("click", async () => {
    const queryInput = container.querySelector("#research-query-input");
    const query = queryInput.value.trim();
    if (!query) { showToast("검색할 질문이나 키워드를 입력하세요.", "error"); return; }
    const outputEl = container.querySelector("#research-ai-output");
    outputEl.classList.remove("hidden");
    outputEl.classList.add("loading");
    outputEl.textContent = "웹을 검색하는 중…";
    const btn = container.querySelector("#btn-run-research");
    btn.disabled = true;
    try {
      const instruction = `다음 질문에 대해 웹에서 최신 정보를 검색하고, 한국어로 핵심 사실을 정리해줘. 출처가 불분명한 내용은 추측하지 말고, 검색으로 확인된 사실만 정리해줘. 질문: ${query}`;
      const result = await callSearch(query, instruction);
      outputEl.classList.remove("loading");
      outputEl.textContent = result.text;
      const entry = {
        id: uid(),
        query,
        result: result.text,
        sources: result.sources || [],
        createdAt: nowISO(),
      };
      post.researchQueries.push(entry);
      saveAndRefresh(post, true);
      renderResearchPanel(container, post);
      queryInput.value = "";
      showToast("검색 결과를 기록했습니다.", "success");
    } catch (e) {
      outputEl.classList.remove("loading");
      outputEl.textContent = "오류: " + e.message;
      showToast("검색 중 오류: " + e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  const historyEl = container.querySelector("#research-history-list");
  if (post.researchQueries.length === 0) {
    historyEl.innerHTML = `<div class="empty-column-hint">아직 검색 기록이 없습니다.</div>`;
  } else {
    historyEl.innerHTML = post.researchQueries.slice().reverse().map((entry) => `
      <div class="source-card">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px;">${escapeHtml(entry.query)}</div>
        <div class="source-card-note" style="white-space:pre-wrap;">${escapeHtml(entry.result)}</div>
        ${(entry.sources || []).length > 0 ? `
          <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
            ${entry.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px;">↗ ${escapeHtml(s.title)}</a>`).join("")}
          </div>
        ` : ""}
        <div class="hint" style="margin-top:6px;">${formatDate(entry.createdAt)}</div>
        <button class="btn btn-small btn-danger-ghost remove-research-btn" data-id="${entry.id}" style="margin-top:8px;">기록 삭제</button>
      </div>
    `).join("");
    historyEl.querySelectorAll(".remove-research-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        post.researchQueries = post.researchQueries.filter((q) => q.id !== btn.dataset.id);
        saveAndRefresh(post, true);
        renderResearchPanel(container, post);
      });
    });
  }

  container.querySelector("#btn-research-next").addEventListener("click", () => {
    advanceStage(post, "verify");
  });
}

// ============================================================
// 3단계: 사실 검증
// ============================================================
function renderVerifyPanel(container, post) {
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">검증할 핵심 주장 정리</h3>
          <p class="panel-desc">리서치에서 나온 핵심 사실/수치/법령을 항목으로 등록하고, 직접 재확인한 뒤 결과를 표시하세요.</p>
        </div>
        <div class="panel-tools">
          <button id="btn-ai-extract-claims" class="btn btn-secondary btn-small">AI로 주장 목록 추출</button>
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:14px;">
        <input id="verify-new-claim" class="field" placeholder="검증할 주장을 입력 (예: 이의신청 기한은 결정고지일로부터 30일이다)" />
        <button id="btn-add-claim" class="btn btn-primary" style="flex-shrink:0;">추가</button>
      </div>
      <div id="verify-list"></div>
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">검증 진행 현황</h3></div>
      <div id="verify-progress" class="hint"></div>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-verify-next" class="btn btn-primary">검증 완료 → 나의 노하우 입력으로 이동</button>
      </div>
    </div>
  `;

  function renderList() {
    const listEl = container.querySelector("#verify-list");
    if (post.verifyItems.length === 0) {
      listEl.innerHTML = `<div class="empty-column-hint">검증할 항목을 추가하세요.</div>`;
      return;
    }
    listEl.innerHTML = post.verifyItems.map((item) => `
      <div class="verify-row">
        <div>
          <div style="font-size:13.5px; margin-bottom:6px;">${escapeHtml(item.claim)}</div>
          <input class="field verify-note-input" data-id="${item.id}" placeholder="확인 메모 (출처, 근거 등)" value="${escapeHtml(item.note || "")}" style="font-size:12px; padding:6px 10px;" />
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <select class="verify-status ${item.status}" data-id="${item.id}">
            <option value="unchecked" ${item.status === "unchecked" ? "selected" : ""}>미확인</option>
            <option value="ok" ${item.status === "ok" ? "selected" : ""}>✓ 확인됨</option>
            <option value="fail" ${item.status === "fail" ? "selected" : ""}>✗ 오류발견</option>
          </select>
          <button class="btn btn-small btn-danger-ghost remove-claim-btn" data-id="${item.id}">삭제</button>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".verify-status").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const item = post.verifyItems.find((i) => i.id === sel.dataset.id);
        item.status = e.target.value;
        sel.className = "verify-status " + item.status;
        saveAndRefresh(post, true);
        updateProgress();
      });
    });
    listEl.querySelectorAll(".verify-note-input").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const item = post.verifyItems.find((i) => i.id === inp.dataset.id);
        item.note = e.target.value;
        saveAndRefreshDebounced(post);
      });
    });
    listEl.querySelectorAll(".remove-claim-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        post.verifyItems = post.verifyItems.filter((i) => i.id !== btn.dataset.id);
        saveAndRefresh(post, true);
        renderList();
        updateProgress();
      });
    });
  }

  function updateProgress() {
    const total = post.verifyItems.length;
    const ok = post.verifyItems.filter((i) => i.status === "ok").length;
    const fail = post.verifyItems.filter((i) => i.status === "fail").length;
    container.querySelector("#verify-progress").textContent =
      total === 0 ? "검증 항목이 없습니다." : `전체 ${total}건 중 확인됨 ${ok}건, 오류발견 ${fail}건, 미확인 ${total - ok - fail}건`;
  }

  container.querySelector("#btn-add-claim").addEventListener("click", () => {
    const input = container.querySelector("#verify-new-claim");
    const text = input.value.trim();
    if (!text) return;
    post.verifyItems.push({ id: uid(), claim: text, status: "unchecked", note: "" });
    saveAndRefresh(post, true);
    input.value = "";
    renderList();
    updateProgress();
  });

  container.querySelector("#btn-ai-extract-claims").addEventListener("click", async () => {
    const combinedResearch = post.researchQueries.map((q) => `[${q.query}]\n${q.result}`).join("\n\n");
    if (!combinedResearch.trim() && !post.researchNotes.trim()) {
      showToast("먼저 검색·리서치 단계에서 자료를 모아주세요.", "error");
      return;
    }
    const btn = container.querySelector("#btn-ai-extract-claims");
    btn.disabled = true;
    btn.textContent = "추출 중…";
    try {
      const system = `너는 팩트체커다. 주어진 리서치 자료에서 독자에게 영향을 줄 수 있는 핵심 사실, 수치, 법령, 절차를 담은 "검증이 필요한 주장" 목록을 뽑아라. 각 주장은 한 문장으로 간결하게 써라. 반드시 JSON 배열로만 응답하라: ["주장1", "주장2", ...]`;
      const userMsg = `리서치 자료:\n${combinedResearch}\n\n메모:\n${post.researchNotes}`;
      const raw = await callClaude([{ role: "user", content: userMsg }], system, 1200);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const claims = JSON.parse(cleaned);
      claims.forEach((c) => post.verifyItems.push({ id: uid(), claim: c, status: "unchecked", note: "" }));
      saveAndRefresh(post, true);
      renderList();
      updateProgress();
      showToast(claims.length + "개의 검증 항목을 추출했습니다.", "success");
    } catch (e) {
      showToast("추출 중 오류: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "AI로 주장 목록 추출";
    }
  });

  container.querySelector("#btn-verify-next").addEventListener("click", () => {
    advanceStage(post, "knowhow");
  });

  renderList();
  updateProgress();
}

// ============================================================
// 4단계: 나의 노하우
// ============================================================
function renderKnowhowPanel(container, post) {
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">이 글만의 차별점</h3>
          <p class="panel-desc">AI가 절대 쓸 수 없는 부분입니다. 실제로 처리한 사례, 현장에서 자주 받는 질문, 본인만의 의견이나 노하우를 적어주세요. 이 내용이 풍부할수록 "AI가 쓴 글"이 아니라 "전문가가 AI로 효율을 높인 글"이 됩니다.</p>
        </div>
      </div>
      <textarea id="knowhow-notes" class="field" style="min-height:220px;" placeholder="예: 실제로 이의신청을 처리하면서 민원인들이 가장 많이 오해하는 부분은...">${escapeHtml(post.knowhowNotes)}</textarea>
      <div class="hint" id="knowhow-charcount"></div>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-knowhow-next" class="btn btn-primary">노하우 정리 완료 → AI 초고 작성으로 이동</button>
      </div>
    </div>
  `;

  const textarea = container.querySelector("#knowhow-notes");
  function updateCount() {
    container.querySelector("#knowhow-charcount").textContent = `${textarea.value.length}자 입력됨`;
  }
  updateCount();
  textarea.addEventListener("input", (e) => {
    post.knowhowNotes = e.target.value;
    saveAndRefreshDebounced(post);
    updateCount();
  });

  container.querySelector("#btn-knowhow-next").addEventListener("click", () => {
    if (post.knowhowNotes.trim().length < 30) {
      showToast("노하우/경험 내용이 너무 짧습니다. 조금 더 보강하는 것을 권장합니다.", "error");
    }
    advanceStage(post, "draft");
  });
}

// ============================================================
// 5단계: AI 초고
// ============================================================
function buildDefaultDraftPrompt(post) {
  const research = post.researchQueries.map((q) => `- ${q.query}: ${q.result}`).join("\n");
  const verified = post.verifyItems.filter((i) => i.status === "ok").map((i) => `- ${i.claim} (${i.note || "확인됨"})`).join("\n");
  return `다음 정보를 바탕으로 블로그 글 초고를 작성해줘.

[주제]
${post.ideaChosen}

[검증된 사실/자료]
${verified || "(없음)"}

[리서치 참고자료]
${research || "(없음)"}

[글쓴이의 실제 경험/노하우 — 반드시 본문에 자연스럽게 녹여서 포함할 것]
${post.knowhowNotes}

[작성 지침]
- 독자가 실제로 검색해서 들어왔을 때 원하는 답을 빠르게 찾을 수 있도록 h2/h3 소제목 구조로 작성
- 글쓴이의 실제 경험/노하우 부분은 일반론이 아니라 구체적인 사례처럼 자연스럽게 통합
- 검증되지 않은 사실은 단정적으로 쓰지 말 것
- 표나 체크리스트를 활용해 정보를 구조화
- 분량은 1500~2500자 내외
- 마크다운 형식으로 작성 (h2는 ##, h3는 ###)`;
}

function renderDraftPanel(container, post) {
  if (!post.draftPrompt) {
    post.draftPrompt = buildDefaultDraftPrompt(post);
  }
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">AI에게 보낼 프롬프트</h3>
          <p class="panel-desc">앞 단계의 내용을 모아 자동으로 채웠습니다. 자유롭게 수정한 뒤 초고를 생성하세요.</p>
        </div>
        <div class="panel-tools">
          <button id="btn-reset-prompt" class="btn btn-secondary btn-small">자동 채움으로 초기화</button>
        </div>
      </div>
      <textarea id="draft-prompt" class="field" style="min-height:260px; font-family:var(--mono); font-size:12.5px;">${escapeHtml(post.draftPrompt)}</textarea>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-generate-draft" class="btn btn-primary">초고 생성</button>
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <h3 class="panel-title">생성된 초고</h3>
      </div>
      <div id="draft-output" class="ai-output ${post.draftOutput ? "" : "hidden"}">${escapeHtml(post.draftOutput)}</div>
      <div class="meta-bar" id="draft-meta"></div>
    </div>

    ${post.draftHistory.length > 0 ? `
    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">이전 생성 기록 (${post.draftHistory.length}개)</h3></div>
      <div id="draft-history-list"></div>
    </div>
    ` : ""}

    <div class="panel-card">
      <div class="panel-tools">
        <button id="btn-draft-next" class="btn btn-primary" ${!post.draftOutput ? "disabled" : ""}>이 초고로 수정·보강 단계로 이동</button>
      </div>
    </div>
  `;

  container.querySelector("#draft-prompt").addEventListener("input", (e) => {
    post.draftPrompt = e.target.value;
    saveAndRefreshDebounced(post);
  });

  container.querySelector("#btn-reset-prompt").addEventListener("click", () => {
    post.draftPrompt = buildDefaultDraftPrompt(post);
    saveAndRefresh(post, true);
    renderDraftPanel(container, post);
  });

  function updateDraftMeta() {
    const metaEl = container.querySelector("#draft-meta");
    if (metaEl && post.draftOutput) {
      metaEl.textContent = `글자수: ${post.draftOutput.length}자 · 생성 기록 ${post.draftHistory.length}건`;
    }
  }
  updateDraftMeta();

  container.querySelector("#btn-generate-draft").addEventListener("click", async () => {
    const outputEl = container.querySelector("#draft-output");
    outputEl.classList.remove("hidden");
    outputEl.classList.add("loading");
    outputEl.textContent = "초고를 작성하는 중… (보통 10~30초 걸립니다)";
    const btn = container.querySelector("#btn-generate-draft");
    btn.disabled = true;
    try {
      const system = "너는 한국어 블로그 콘텐츠 전문 작가다. 사실에 근거하여 정확하고, 독자에게 실질적으로 도움이 되는 글을 쓴다. 과장하거나 확인되지 않은 정보를 단정적으로 쓰지 않는다.";
      const output = await callClaude([{ role: "user", content: post.draftPrompt }], system, 4096);
      outputEl.classList.remove("loading");
      outputEl.textContent = output;
      if (post.draftOutput) {
        post.draftHistory.push({ id: uid(), output: post.draftOutput, createdAt: nowISO() });
      }
      post.draftOutput = output;
      if (!post.editedContent) post.editedContent = output;
      saveAndRefresh(post, true);
      renderDraftPanel(container, post);
      showToast("초고가 생성되었습니다.", "success");
    } catch (e) {
      outputEl.classList.remove("loading");
      outputEl.textContent = "오류: " + e.message;
      showToast("초고 생성 중 오류: " + e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  const historyListEl = container.querySelector("#draft-history-list");
  if (historyListEl) {
    historyListEl.innerHTML = post.draftHistory.slice().reverse().map((h) => `
      <div class="source-card">
        <div class="hint">${formatDate(h.createdAt)}</div>
        <div class="source-card-note" style="white-space:pre-wrap; max-height:120px; overflow-y:auto;">${escapeHtml(h.output.slice(0, 300))}${h.output.length > 300 ? "…" : ""}</div>
        <button class="btn btn-small btn-secondary restore-draft-btn" data-id="${h.id}" style="margin-top:8px;">이 버전으로 복원</button>
      </div>
    `).join("");
    historyListEl.querySelectorAll(".restore-draft-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hist = post.draftHistory.find((h) => h.id === btn.dataset.id);
        post.draftHistory.push({ id: uid(), output: post.draftOutput, createdAt: nowISO() });
        post.draftOutput = hist.output;
        saveAndRefresh(post, true);
        renderDraftPanel(container, post);
        showToast("이전 버전으로 복원했습니다.", "success");
      });
    });
  }

  container.querySelector("#btn-draft-next").addEventListener("click", () => {
    advanceStage(post, "edit");
  });
}

// ============================================================
// 6단계: 수정·보강
// ============================================================
function renderEditPanel(container, post) {
  if (!post.editedContent && post.draftOutput) post.editedContent = post.draftOutput;
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">본문 직접 수정</h3>
          <p class="panel-desc">AI 초고를 자유롭게 고치세요. 문장을 다듬고, 어색한 부분을 손보고, 빠진 정보를 채워주세요.</p>
        </div>
        <div class="panel-tools">
          <button id="btn-ai-improve" class="btn btn-secondary btn-small">AI에게 다듬어달라고 요청</button>
        </div>
      </div>
      <textarea id="edited-content" class="field" style="min-height:420px; font-size:13.5px; line-height:1.8;">${escapeHtml(post.editedContent)}</textarea>
      <div class="meta-bar"><span id="edit-charcount"></span></div>
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">수정 메모</h3></div>
      <textarea id="edit-notes" class="field" placeholder="이번 수정에서 보강한 점, 다음에 더 손볼 부분 등">${escapeHtml(post.editNotes)}</textarea>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-edit-next" class="btn btn-primary">수정 완료 → SEO·구조 점검으로 이동</button>
      </div>
    </div>
  `;

  const textarea = container.querySelector("#edited-content");
  function updateCount() {
    container.querySelector("#edit-charcount").textContent = `${textarea.value.length}자`;
  }
  updateCount();
  textarea.addEventListener("input", (e) => {
    post.editedContent = e.target.value;
    saveAndRefreshDebounced(post);
    updateCount();
  });

  container.querySelector("#edit-notes").addEventListener("input", (e) => {
    post.editNotes = e.target.value;
    saveAndRefreshDebounced(post);
  });

  container.querySelector("#btn-ai-improve").addEventListener("click", async () => {
    const instruction = prompt("AI에게 어떤 식으로 다듬어달라고 요청할까요? (예: 도입부를 더 흥미롭게, 문장을 더 간결하게)");
    if (!instruction) return;
    const btn = container.querySelector("#btn-ai-improve");
    btn.disabled = true;
    btn.textContent = "다듬는 중…";
    try {
      const system = "너는 한국어 글쓰기 편집자다. 사용자가 제공한 본문을 요청한 방향으로만 수정하고, 의미나 사실을 바꾸지 않는다. 결과는 수정된 본문 전체만 출력한다.";
      const userMsg = `요청: ${instruction}\n\n[원문]\n${post.editedContent}`;
      const improved = await callClaude([{ role: "user", content: userMsg }], system, 4096);
      post.editedContent = improved;
      saveAndRefresh(post, true);
      renderEditPanel(container, post);
      showToast("AI가 본문을 다듬었습니다. 결과를 확인하세요.", "success");
    } catch (e) {
      showToast("오류: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "AI에게 다듬어달라고 요청";
    }
  });

  container.querySelector("#btn-edit-next").addEventListener("click", () => {
    advanceStage(post, "seo");
  });
}

// ============================================================
// 7단계: SEO·구조
// ============================================================
function renderSeoPanel(container, post) {
  if (post.seoChecklist.length === 0) post.seoChecklist = defaultSeoChecklist();
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">검색 노출용 메타 정보</h3>
        </div>
        <div class="panel-tools">
          <button id="btn-ai-seo" class="btn btn-secondary btn-small">AI로 메타 정보 생성</button>
        </div>
      </div>
      <div class="field-group">
        <div class="field-label">SEO 제목</div>
        <input id="seo-title" class="field" value="${escapeHtml(post.seoTitle)}" placeholder="검색에 노출될 제목 (핵심 키워드 포함)" />
      </div>
      <div class="field-group">
        <div class="field-label">메타 설명</div>
        <textarea id="seo-desc" class="field" style="min-height:80px;" placeholder="검색 결과에 보일 1~2문장 요약">${escapeHtml(post.seoDescription)}</textarea>
      </div>
      <div class="field-group">
        <div class="field-label">핵심 키워드</div>
        <input id="seo-keywords" class="field" value="${escapeHtml(post.seoKeywords)}" placeholder="쉼표로 구분, 예: 개별주택가격, 이의신청, 용산구" />
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">구조 점검 체크리스트</h3></div>
      <div id="seo-checklist"></div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <input id="seo-new-item" class="field" placeholder="체크 항목 추가" />
        <button id="btn-add-seo-item" class="btn btn-secondary" style="flex-shrink:0;">추가</button>
      </div>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-seo-next" class="btn btn-primary">점검 완료 → 발행 준비로 이동</button>
      </div>
    </div>
  `;

  container.querySelector("#seo-title").addEventListener("input", (e) => { post.seoTitle = e.target.value; saveAndRefreshDebounced(post); });
  container.querySelector("#seo-desc").addEventListener("input", (e) => { post.seoDescription = e.target.value; saveAndRefreshDebounced(post); });
  container.querySelector("#seo-keywords").addEventListener("input", (e) => { post.seoKeywords = e.target.value; saveAndRefreshDebounced(post); });

  container.querySelector("#btn-ai-seo").addEventListener("click", async () => {
    const btn = container.querySelector("#btn-ai-seo");
    btn.disabled = true;
    btn.textContent = "생성 중…";
    try {
      const system = `다음 블로그 본문을 보고 SEO 제목(30자 내외), 메타 설명(80자 내외), 핵심 키워드(5개, 쉼표구분)를 만들어라. 반드시 JSON으로만 응답: {"title": "...", "description": "...", "keywords": "..."}`;
      const raw = await callClaude([{ role: "user", content: post.editedContent || post.draftOutput }], system, 600);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      post.seoTitle = parsed.title || post.seoTitle;
      post.seoDescription = parsed.description || post.seoDescription;
      post.seoKeywords = parsed.keywords || post.seoKeywords;
      saveAndRefresh(post, true);
      renderSeoPanel(container, post);
      showToast("SEO 메타 정보를 생성했습니다.", "success");
    } catch (e) {
      showToast("오류: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "AI로 메타 정보 생성";
    }
  });

  function renderChecklist() {
    const el = container.querySelector("#seo-checklist");
    el.innerHTML = post.seoChecklist.map((item) => `
      <div class="checklist-item ${item.checked ? "checked" : ""}">
        <input type="checkbox" data-id="${item.id}" ${item.checked ? "checked" : ""} />
        <span class="checklist-text">${escapeHtml(item.text)}</span>
        <button class="checklist-remove" data-id="${item.id}">✕</button>
      </div>
    `).join("");
    el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const item = post.seoChecklist.find((i) => i.id === cb.dataset.id);
        item.checked = e.target.checked;
        saveAndRefresh(post, true);
        renderChecklist();
      });
    });
    el.querySelectorAll(".checklist-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        post.seoChecklist = post.seoChecklist.filter((i) => i.id !== btn.dataset.id);
        saveAndRefresh(post, true);
        renderChecklist();
      });
    });
  }
  renderChecklist();

  container.querySelector("#btn-add-seo-item").addEventListener("click", () => {
    const input = container.querySelector("#seo-new-item");
    if (!input.value.trim()) return;
    post.seoChecklist.push({ id: uid(), text: input.value.trim(), checked: false });
    saveAndRefresh(post, true);
    input.value = "";
    renderChecklist();
  });

  container.querySelector("#btn-seo-next").addEventListener("click", () => {
    advanceStage(post, "publish");
  });
}

// ============================================================
// 8단계: 발행 준비
// ============================================================
function renderPublishPanel(container, post) {
  if (post.publishChecklist.length === 0) post.publishChecklist = defaultPublishChecklist();
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">최종 점검 체크리스트</h3></div>
      <div id="publish-checklist" class="publish-box"></div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <input id="publish-new-item" class="field" placeholder="체크 항목 추가" />
        <button id="btn-add-publish-item" class="btn btn-secondary" style="flex-shrink:0;">추가</button>
      </div>
    </div>

    <div class="panel-card">
      <div class="field-group">
        <div class="field-label">발행 플랫폼</div>
        <input id="publish-platform" class="field" value="${escapeHtml(post.publishPlatform)}" placeholder="예: 티스토리, 네이버블로그" />
      </div>
      <div class="field-group">
        <div class="field-label">발행 URL (발행 후 입력)</div>
        <input id="publish-url" class="field" value="${escapeHtml(post.publishUrl)}" placeholder="https://..." />
      </div>
      <div class="field-group">
        <div class="field-label">최종 본문 (복사해서 플랫폼에 붙여넣기)</div>
        <textarea id="publish-final-content" class="field" style="min-height:300px;">${escapeHtml(post.editedContent)}</textarea>
        <button id="btn-copy-content" class="btn btn-secondary btn-small" style="margin-top:8px;">본문 클립보드로 복사</button>
      </div>
      <div class="panel-tools" style="margin-top:14px;">
        <button id="btn-publish-next" class="btn btn-primary">발행 완료 처리</button>
      </div>
    </div>
  `;

  function renderChecklist() {
    const el = container.querySelector("#publish-checklist");
    el.innerHTML = post.publishChecklist.map((item) => `
      <div class="checklist-item ${item.checked ? "checked" : ""}">
        <input type="checkbox" data-id="${item.id}" ${item.checked ? "checked" : ""} />
        <span class="checklist-text">${escapeHtml(item.text)}</span>
        <button class="checklist-remove" data-id="${item.id}">✕</button>
      </div>
    `).join("");
    el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const item = post.publishChecklist.find((i) => i.id === cb.dataset.id);
        item.checked = e.target.checked;
        saveAndRefresh(post, true);
        renderChecklist();
      });
    });
    el.querySelectorAll(".checklist-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        post.publishChecklist = post.publishChecklist.filter((i) => i.id !== btn.dataset.id);
        saveAndRefresh(post, true);
        renderChecklist();
      });
    });
  }
  renderChecklist();

  container.querySelector("#btn-add-publish-item").addEventListener("click", () => {
    const input = container.querySelector("#publish-new-item");
    if (!input.value.trim()) return;
    post.publishChecklist.push({ id: uid(), text: input.value.trim(), checked: false });
    saveAndRefresh(post, true);
    input.value = "";
    renderChecklist();
  });

  container.querySelector("#publish-platform").addEventListener("input", (e) => { post.publishPlatform = e.target.value; saveAndRefreshDebounced(post); });
  container.querySelector("#publish-url").addEventListener("input", (e) => { post.publishUrl = e.target.value; saveAndRefreshDebounced(post); });
  container.querySelector("#publish-final-content").addEventListener("input", (e) => { post.editedContent = e.target.value; saveAndRefreshDebounced(post); });

  container.querySelector("#btn-copy-content").addEventListener("click", () => {
    navigator.clipboard.writeText(post.editedContent).then(() => showToast("본문을 클립보드에 복사했습니다.", "success"));
  });

  container.querySelector("#btn-publish-next").addEventListener("click", () => {
    post.publishedAt = nowISO();
    advanceStage(post, "done");
  });
}

// ============================================================
// 9단계: 발행 완료
// ============================================================
function renderDonePanel(container, post) {
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">🎉 발행 완료</h3>
          <p class="panel-desc">발행일: ${formatDate(post.publishedAt) || "기록 없음"} · 플랫폼: ${escapeHtml(post.publishPlatform) || "미기록"}</p>
        </div>
      </div>
      ${post.publishUrl ? `<a href="${escapeHtml(post.publishUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">발행된 글 보기 ↗</a>` : ""}
    </div>

    <div class="panel-card">
      <div class="panel-head"><h3 class="panel-title">발행 후 회고 / 성과 메모</h3></div>
      <textarea id="notes-after" class="field" placeholder="조회수, 댓글 반응, 다음에 개선할 점 등을 자유롭게 기록하세요">${escapeHtml(post.notesAfter)}</textarea>
    </div>
  `;
  container.querySelector("#notes-after").addEventListener("input", (e) => {
    post.notesAfter = e.target.value;
    saveAndRefreshDebounced(post);
  });
}

// ============================================================
// 전역 이벤트 바인딩 & 초기화
// ============================================================
function initApp() {
  Store.loadLocal();
  Store.tryInitFirebase();

  document.getElementById("btn-new-post").addEventListener("click", createNewPost);
  document.getElementById("btn-back").addEventListener("click", showBoardView);

  document.getElementById("post-title-input").addEventListener("input", (e) => {
    const post = Store.getPost(currentPostId);
    if (!post) return;
    post.title = e.target.value;
    saveAndRefreshDebounced(post);
  });

  document.getElementById("post-stage-select").addEventListener("change", (e) => {
    const post = Store.getPost(currentPostId);
    if (!post) return;
    post.stage = e.target.value;
    activeStageTab = e.target.value;
    saveAndRefresh(post);
    renderPostView();
  });

  document.getElementById("btn-delete-post").addEventListener("click", () => {
    if (!currentPostId) return;
    if (confirm("이 글의 모든 작업 내역이 삭제됩니다. 계속하시겠습니까?")) {
      Store.deletePost(currentPostId);
      showBoardView();
      showToast("글을 삭제했습니다.", "success");
    }
  });

  document.getElementById("search-box").addEventListener("input", (e) => {
    boardSearchTerm = e.target.value;
    renderBoard();
  });

  // 설정 모달
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("hidden");
  });
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });
  document.getElementById("settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") e.target.classList.add("hidden");
  });

  document.getElementById("btn-save-firebase").addEventListener("click", () => {
    const raw = document.getElementById("firebase-config-input").value.trim();
    if (!raw) { showToast("Firebase 설정 JSON을 입력하세요.", "error"); return; }
    Store.connectFirebase(raw);
  });

  document.getElementById("btn-export-data").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(Store.posts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blog-pipeline-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import-data").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        Store.posts = { ...Store.posts, ...imported };
        Store.saveLocal();
        renderBoard();
        showToast("데이터를 가져왔습니다.", "success");
      } catch (err) {
        showToast("파일을 읽는 중 오류가 발생했습니다.", "error");
      }
    };
    reader.readAsText(file);
  });

  // 기존 Firebase 설정이 있다면 입력창에 표시
  const existingConfig = localStorage.getItem(Store.FIREBASE_CONFIG_KEY);
  if (existingConfig) {
    document.getElementById("firebase-config-input").value = existingConfig;
  }

  renderBoard();
}

document.addEventListener("DOMContentLoaded", initApp);
