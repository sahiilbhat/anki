const STORAGE_BUCKET = "card-assets";
const APP_URL = "https://sahiilbhat.github.io/anki/";
const { createClient } = window.supabase || {};

if (!createClient) {
  throw new Error("Supabase client failed to load.");
}

const supabaseClient = createClient(
  window.ANKI_SUPABASE_URL,
  window.ANKI_SUPABASE_PUBLISHABLE_KEY
);

const DEFAULT_DECKS = [
  "JavaScript",
  "React",
  "System Design",
  "Backend",
  "Behavioral"
];

const DEFAULT_CARDS = [
  {
    deckName: "JavaScript",
    question: "What is a closure in JavaScript?",
    answer: "A closure is created when a function retains access to variables from its lexical scope even after the outer function has finished executing.",
    tags: ["javascript", "scope", "closure"]
  },
  {
    deckName: "React",
    question: "Why can stale closures happen in React?",
    answer: "A callback can capture state or props from the render in which it was created. If that callback runs later, it may read an older snapshot unless dependencies, functional updates, refs, or another suitable pattern are used.",
    tags: ["react", "closures", "state"]
  },
  {
    deckName: "System Design",
    question: "Why can Canvas outperform thousands of DOM nodes for dense visualizations?",
    answer: "Canvas draws many visual primitives into one DOM element, avoiding the layout, style calculation and memory overhead of thousands of individual DOM elements. The tradeoff is that interaction and accessibility must be implemented manually.",
    tags: ["canvas", "performance", "frontend-system-design"]
  },
  {
    deckName: "Backend",
    question: "What problem does an event-driven architecture solve?",
    answer: "It decouples producers from consumers. A producer publishes an event and independent consumers react to it asynchronously, which improves extensibility and can help scale workloads independently.",
    tags: ["backend", "events", "architecture"]
  },
  {
    deckName: "Behavioral",
    question: "How should you structure a behavioral interview answer?",
    answer: "Use STAR: Situation, Task, Action and Result. Keep the context short, make your personal actions explicit, and quantify the result when possible.",
    tags: ["behavioral", "star"]
  }
];

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SCHEDULER = {
  learningSteps: [1 * MINUTE, 10 * MINUTE],
  relearningSteps: [10 * MINUTE],
  graduatingInterval: 1,
  easyInterval: 4,
  hardMultiplier: 1.2,
  newIntervalMultiplier: 0
};

let session = null;
let state = { decks: [], cards: [], reviews: [] };
let currentView = "dashboard";
let reviewQueue = [];
let reviewIndex = 0;
let reviewedInSession = 0;
let reviewTimer = null;
let recognition = null;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingCard = null;
let isRecording = false;
let latestTranscript = "";
let authMode = "signin";

const els = {
  appShell: document.querySelector("#appShell"),
  authGate: document.querySelector("#authGate"),
  authTitle: document.querySelector("#authTitle"),
  authSubtitle: document.querySelector("#authSubtitle"),
  authForm: document.querySelector("#authForm"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  authSubmit: document.querySelector("#authSubmit"),
  authStatus: document.querySelector("#authStatus"),
  authToggle: document.querySelector("#authToggle"),
  userEmail: document.querySelector("#userEmail"),
  signOutBtn: document.querySelector("#signOutBtn"),
  syncStatus: document.querySelector("#syncStatus"),
  views: {
    dashboard: document.querySelector("#dashboardView"),
    review: document.querySelector("#reviewView"),
    cards: document.querySelector("#cardsView")
  },
  pageTitle: document.querySelector("#pageTitle"),
  navItems: [...document.querySelectorAll(".nav-item")],
  sidebarToggle: document.querySelector("#sidebarToggle"),
  deckList: document.querySelector("#deckList"),
  deckOverview: document.querySelector("#deckOverview"),
  dueCount: document.querySelector("#dueCount"),
  totalCards: document.querySelector("#totalCards"),
  reviewedToday: document.querySelector("#reviewedToday"),
  retentionValue: document.querySelector("#retentionValue"),
  streakValue: document.querySelector("#streakValue"),
  heroDueText: document.querySelector("#heroDueText"),
  startReviewBtn: document.querySelector("#startReviewBtn"),
  addCardBtn: document.querySelector("#addCardBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFileInput: document.querySelector("#importFileInput"),
  addDeckBtn: document.querySelector("#addDeckBtn"),
  searchInput: document.querySelector("#searchInput"),
  deckFilter: document.querySelector("#deckFilter"),
  cardsTable: document.querySelector("#cardsTable"),
  reviewDeckBadge: document.querySelector("#reviewDeckBadge"),
  reviewPosition: document.querySelector("#reviewPosition"),
  reviewTotal: document.querySelector("#reviewTotal"),
  reviewProgressBar: document.querySelector("#reviewProgressBar"),
  questionText: document.querySelector("#questionText"),
  answerArea: document.querySelector("#answerArea"),
  answerText: document.querySelector("#answerText"),
  answerConcepts: document.querySelector("#answerConcepts"),
  cardAudio: document.querySelector("#cardAudio"),
  recordingAudio: document.querySelector("#recordingAudio"),
  cardAttachments: document.querySelector("#cardAttachments"),
  showAnswerBtn: document.querySelector("#showAnswerBtn"),
  ratingActions: document.querySelector("#ratingActions"),
  recordBtn: document.querySelector("#recordBtn"),
  voiceStatus: document.querySelector("#voiceStatus"),
  transcriptBox: document.querySelector("#transcriptBox"),
  cardDialog: document.querySelector("#cardDialog"),
  cardForm: document.querySelector("#cardForm"),
  cardDialogTitle: document.querySelector("#cardDialogTitle"),
  cardId: document.querySelector("#cardId"),
  cardDeck: document.querySelector("#cardDeck"),
  cardQuestion: document.querySelector("#cardQuestion"),
  cardAnswer: document.querySelector("#cardAnswer"),
  cardTags: document.querySelector("#cardTags"),
  cardAudioFile: document.querySelector("#cardAudioFile"),
  cardAttachmentsInput: document.querySelector("#cardAttachmentsInput"),
  closeCardDialog: document.querySelector("#closeCardDialog"),
  cancelCardBtn: document.querySelector("#cancelCardBtn"),
  deckDialog: document.querySelector("#deckDialog"),
  deckForm: document.querySelector("#deckForm"),
  deckName: document.querySelector("#deckName"),
  closeDeckDialog: document.querySelector("#closeDeckDialog"),
  cancelDeckBtn: document.querySelector("#cancelDeckBtn")
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getDeck(deckId) {
  return state.decks.find(deck => deck.id === deckId);
}

function getDueCards(deckId = null) {
  return state.cards.filter(card => isDue(card) && (!deckId || card.deckId === deckId));
}

function isDue(card, now = Date.now()) {
  return (card.dueAt || 0) <= now;
}

function calculateStreak() {
  if (!state.reviews.length) return 0;

  const days = new Set(
    state.reviews.map(review => new Date(review.reviewedAt).toDateString())
  );
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function cardState(card) {
  if (card.cardState) return card.cardState;
  return card.interval > 0 ? "review" : "new";
}

function learningStepsFor(card) {
  return cardState(card) === "relearning"
    ? SCHEDULER.relearningSteps
    : SCHEDULER.learningSteps;
}

function graduateCard(card, interval, now) {
  return {
    ...card,
    cardState: "review",
    learningStep: 0,
    lapseInterval: 0,
    interval: Math.max(1, Math.round(interval)),
    dueAt: now + Math.max(1, Math.round(interval)) * DAY
  };
}

function scheduleLearningCard(card, rating, now) {
  const steps = learningStepsFor(card);
  const step = Math.min(card.learningStep || 0, steps.length - 1);
  const updated = { ...card, cardState: cardState(card) };

  if (rating === "again") {
    updated.learningStep = 0;
    updated.dueAt = now + steps[0];
    if (updated.cardState === "relearning") updated.interval = card.lapseInterval || card.interval;
    return updated;
  }

  if (rating === "hard") {
    const currentDelay = steps[step] || MINUTE;
    const nextDelay = steps[step + 1];
    const delay = nextDelay ? Math.round((currentDelay + nextDelay) / 2) : Math.round(currentDelay * 1.5);
    updated.learningStep = step;
    updated.dueAt = now + delay;
    return updated;
  }

  if (rating === "easy") {
    return graduateCard(card, SCHEDULER.easyInterval, now);
  }

  if (step + 1 < steps.length) {
    updated.learningStep = step + 1;
    updated.dueAt = now + steps[step + 1];
    return updated;
  }

  const interval = cardState(card) === "relearning"
    ? Math.max(1, Math.floor((card.lapseInterval || card.interval || 1) * SCHEDULER.newIntervalMultiplier))
    : SCHEDULER.graduatingInterval;
  return graduateCard(card, interval, now);
}

function scheduleCard(card, rating, now = Date.now()) {
  const stateName = cardState(card);

  if (stateName === "new" || stateName === "learning" || stateName === "relearning") {
    const updated = scheduleLearningCard(card, rating, now);
    if (updated.cardState === "new") {
      updated.cardState = "learning";
    }
    return updated;
  }

  const updated = { ...card, cardState: "review", learningStep: 0 };
  const interval = Math.max(1, card.interval || 1);

  if (rating === "again") {
    updated.cardState = "relearning";
    updated.learningStep = 0;
    updated.lapseInterval = interval;
    updated.dueAt = now + SCHEDULER.relearningSteps[0];
    updated.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
    return updated;
  }

  if (rating === "hard") {
    updated.interval = Math.max(1, Math.round(interval * SCHEDULER.hardMultiplier));
    updated.ease = Math.max(1.3, (card.ease || 2.5) - 0.15);
  }

  if (rating === "good") {
    updated.interval = Math.max(interval + 1, Math.round(interval * (card.ease || 2.5)));
  }

  if (rating === "easy") {
    updated.interval = Math.max(interval + 1, Math.round(interval * (card.ease || 2.5) * 1.3));
    updated.ease = Math.min(3.2, (card.ease || 2.5) + 0.15);
  }

  updated.dueAt = now + updated.interval * DAY;
  return updated;
}

function formatDelay(delayMs) {
  if (delayMs < HOUR) {
    const minutes = Math.max(1, Math.round(delayMs / MINUTE));
    return `${minutes} min`;
  }
  const days = Math.max(1, Math.round(delayMs / DAY));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function renderRatingLabels(card) {
  els.ratingActions.querySelectorAll("[data-rating]").forEach(button => {
    const preview = scheduleCard(card, button.dataset.rating);
    button.querySelector("span").textContent = formatDelay(preview.dueAt - Date.now());
  });
}

function normalizeCard(row) {
  return {
    id: row.id,
    deckId: row.deck_id,
    question: row.question,
    answer: row.answer,
    tags: row.tags || [],
    dueAt: new Date(row.due_at).getTime(),
    interval: row.interval || 0,
    ease: Number(row.ease || 2.5),
    cardState: row.card_state || (row.interval > 0 ? "review" : "new"),
    learningStep: row.learning_step || 0,
    lapseInterval: row.lapse_interval || 0,
    audioPath: row.audio_path || null,
    attachments: row.attachment_paths || []
  };
}

function normalizeReview(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    deckId: row.deck_id,
    rating: row.rating,
    reviewedAt: new Date(row.reviewed_at).getTime()
  };
}

function cardToRow(card) {
  return {
    id: card.id,
    user_id: session.user.id,
    deck_id: card.deckId,
    question: card.question,
    answer: card.answer,
    tags: card.tags || [],
    due_at: new Date(card.dueAt || Date.now()).toISOString(),
    interval: card.interval || 0,
    ease: card.ease || 2.5,
    card_state: cardState(card),
    learning_step: card.learningStep || 0,
    lapse_interval: card.lapseInterval || 0,
    audio_path: card.audioPath || null,
    attachment_paths: card.attachments || [],
    updated_at: new Date().toISOString()
  };
}

async function seedDefaultData() {
  const userId = session.user.id;
  const decks = DEFAULT_DECKS.map(name => ({
    id: crypto.randomUUID(),
    user_id: userId,
    name
  }));

  const { error: deckError } = await supabaseClient.from("decks").insert(decks);
  if (deckError) throw deckError;

  const deckIds = Object.fromEntries(decks.map(deck => [deck.name, deck.id]));
  const cards = DEFAULT_CARDS.map(card => ({
    id: crypto.randomUUID(),
    user_id: userId,
    deck_id: deckIds[card.deckName],
    question: card.question,
    answer: card.answer,
    tags: card.tags,
    due_at: new Date().toISOString(),
    interval: 0,
    ease: 2.5,
    card_state: "new",
    learning_step: 0,
    lapse_interval: 0
  }));

  const { error: cardError } = await supabaseClient.from("cards").insert(cards);
  if (cardError) throw cardError;
}

async function loadCloudState() {
  setSyncStatus("Syncing...");

  const [decksResult, cardsResult, reviewsResult] = await Promise.all([
    supabaseClient.from("decks").select("*").order("created_at"),
    supabaseClient.from("cards").select("*").order("created_at"),
    supabaseClient.from("reviews").select("*").order("reviewed_at")
  ]);

  if (decksResult.error) throw decksResult.error;
  if (cardsResult.error) throw cardsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  if (!decksResult.data.length) {
    await seedDefaultData();
    return loadCloudState();
  }

  state = {
    decks: decksResult.data,
    cards: cardsResult.data.map(normalizeCard),
    reviews: reviewsResult.data.map(normalizeReview)
  };
  setSyncStatus("Synced");
}

function setSyncStatus(message) {
  if (els.syncStatus) els.syncStatus.textContent = message;
}

function showError(error, fallback = "Something went wrong. Please try again.") {
  console.error(error);
  setSyncStatus(fallback);
  alert(error?.message || fallback);
}

function renderStats() {
  const today = startOfToday();
  const todaysReviews = state.reviews.filter(review => review.reviewedAt >= today);
  const successful = todaysReviews.filter(review => ["good", "easy"].includes(review.rating)).length;
  const retention = todaysReviews.length
    ? Math.round((successful / todaysReviews.length) * 100)
    : 0;
  const due = getDueCards().length;

  els.dueCount.textContent = due;
  els.totalCards.textContent = state.cards.length;
  els.reviewedToday.textContent = todaysReviews.length;
  els.retentionValue.textContent = `${retention}%`;
  els.streakValue.textContent = calculateStreak();
  els.heroDueText.textContent = due
    ? `${due} card${due === 1 ? "" : "s"} waiting for you`
    : "No cards due right now";
}

function renderDecks() {
  els.deckList.innerHTML = state.decks.map(deck => {
    const total = state.cards.filter(card => card.deckId === deck.id).length;
    return `
      <button class="deck-item" data-deck-id="${deck.id}">
        <span class="deck-name"><span class="deck-dot"></span>${escapeHtml(deck.name)}</span>
        <span class="deck-count">${total}</span>
      </button>
    `;
  }).join("");

  els.deckOverview.innerHTML = state.decks.map(deck => {
    const cards = state.cards.filter(card => card.deckId === deck.id);
    const due = cards.filter(isDue).length;
    const learned = cards.length ? Math.round(((cards.length - due) / cards.length) * 100) : 0;
    return `
      <div class="deck-row">
        <div class="deck-row-top">
          <strong>${escapeHtml(deck.name)}</strong>
          <small>${due ? `${due} due` : "Up to date"}</small>
        </div>
        <div class="deck-progress" aria-label="${learned}% of cards not due">
          <span style="width: ${learned}%"></span>
        </div>
        <div class="deck-row-bottom">
          <small>${cards.length} card${cards.length === 1 ? "" : "s"}</small>
          <small>${learned}% on track</small>
        </div>
      </div>
    `;
  }).join("") || `<div class="empty-state">No decks yet.</div>`;

  const deckOptions = state.decks.map(deck =>
    `<option value="${deck.id}">${escapeHtml(deck.name)}</option>`
  ).join("");

  els.cardDeck.innerHTML = deckOptions;
  els.deckFilter.innerHTML = `<option value="">All decks</option>${deckOptions}`;
}

function renderCards() {
  const query = els.searchInput.value.trim().toLowerCase();
  const deckId = els.deckFilter.value;
  const cards = state.cards.filter(card => {
    const deckMatches = !deckId || card.deckId === deckId;
    const searchable = `${card.question} ${card.answer} ${(card.tags || []).join(" ")}`.toLowerCase();
    return deckMatches && (!query || searchable.includes(query));
  });

  if (!cards.length) {
    els.cardsTable.innerHTML = `<div class="empty-state">No matching cards.</div>`;
    return;
  }

  els.cardsTable.innerHTML = `
    <div class="cards-table-head" aria-hidden="true">
      <span>Deck</span><span>Question</span><span>Interval</span><span>Actions</span>
    </div>
    ${cards.map(card => {
    const deck = getDeck(card.deckId);
    return `
      <div class="card-row">
        <div>
          <strong>${escapeHtml(deck?.name || "Unknown")}</strong>
          <small>${isDue(card) ? "Due now" : `Due ${new Date(card.dueAt).toLocaleDateString()}`}</small>
        </div>
        <div class="question-cell">
          <strong>${escapeHtml(card.question)}</strong>
          <small>${escapeHtml((card.tags || []).join(" · "))}</small>
        </div>
        <small>Interval: ${card.interval || 0}d</small>
        <div class="card-actions">
          <button data-action="edit" data-card-id="${card.id}" title="Edit">✎</button>
          <button data-action="delete" data-card-id="${card.id}" title="Delete">×</button>
        </div>
      </div>
    `;
    }).join("")}
  `;
}

function switchView(view) {
  currentView = view;
  Object.entries(els.views).forEach(([key, element]) => {
    element.classList.toggle("active", key === view);
  });
  els.navItems.forEach(item => item.classList.toggle("active", item.dataset.view === view));
  els.pageTitle.textContent = { dashboard: "Dashboard", review: "Review", cards: "Cards" }[view];
  if (view === "cards") renderCards();
  if (view === "review") beginReview();
}

function beginReview(deckId = null) {
  reviewQueue = getDueCards(deckId);
  reviewIndex = 0;
  reviewedInSession = 0;
  renderReviewCard();
}

function nextDueQueueIndex() {
  for (let index = reviewIndex; index < reviewQueue.length; index++) {
    if (reviewQueue[index] && isDue(reviewQueue[index])) return index;
  }
  return -1;
}

function clearReviewTimer() {
  if (reviewTimer) {
    clearTimeout(reviewTimer);
    reviewTimer = null;
  }
}

function renderWaitingCard() {
  const upcoming = reviewQueue
    .filter((card, index) => card && index >= reviewIndex && !isDue(card))
    .sort((a, b) => a.dueAt - b.dueAt)[0];

  if (!upcoming) return false;

  const delay = Math.max(500, upcoming.dueAt - Date.now());
  els.reviewDeckBadge.textContent = "Next up";
  els.reviewPosition.textContent = reviewedInSession;
  els.reviewTotal.textContent = reviewedInSession + reviewQueue.filter(Boolean).length;
  els.reviewProgressBar.style.width = `${Math.min(100, Math.round((reviewedInSession / Math.max(1, reviewedInSession + reviewQueue.filter(Boolean).length)) * 100))}%`;
  els.questionText.textContent = `Next card in ${formatDelay(delay)}`;
  els.answerArea.classList.add("hidden");
  els.showAnswerBtn.classList.add("hidden");
  els.ratingActions.classList.add("hidden");
  reviewTimer = setTimeout(() => renderReviewCard(), delay);
  return true;
}

function resetMediaPlayers() {
  [els.cardAudio, els.recordingAudio].forEach(player => {
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.classList.add("hidden");
  });
  els.cardAttachments.innerHTML = "";
}

async function loadCardMedia(card) {
  const cardId = card.id;
  resetMediaPlayers();

  if (card.audioPath) {
    const { data, error } = await supabaseClient.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(card.audioPath, 3600);
    if (!error && data?.signedUrl && reviewQueue[reviewIndex]?.id === cardId) {
      els.cardAudio.src = data.signedUrl;
      els.cardAudio.classList.remove("hidden");
    }
  }

  const attachmentLinks = await Promise.all((card.attachments || []).map(async path => {
    const { data } = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ? { path, url: data.signedUrl } : null;
  }));

  if (reviewQueue[reviewIndex]?.id === cardId) {
    els.cardAttachments.innerHTML = attachmentLinks.filter(Boolean).map(({ path, url }) => `
      <a href="${url}" target="_blank" rel="noreferrer">📎 ${escapeHtml(path.split("/").pop())}</a>
    `).join("");
  }

  const { data: recordings } = await supabaseClient
    .from("review_recordings")
    .select("storage_path")
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = recordings?.[0];
  if (latest && reviewQueue[reviewIndex]?.id === cardId) {
    const { data } = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(latest.storage_path, 3600);
    if (data?.signedUrl) {
      els.recordingAudio.src = data.signedUrl;
      els.recordingAudio.classList.remove("hidden");
    }
  }
}

function renderReviewCard() {
  clearReviewTimer();
  els.answerArea.classList.add("hidden");
  els.ratingActions.classList.add("hidden");
  els.showAnswerBtn.classList.remove("hidden");
  els.transcriptBox.classList.add("hidden");
  els.transcriptBox.textContent = "";
  latestTranscript = "";
  resetMediaPlayers();

  const nextIndex = nextDueQueueIndex();
  if (nextIndex === -1 && renderWaitingCard()) return;

  if (nextIndex === -1) {
    els.reviewDeckBadge.textContent = "Complete";
    els.reviewPosition.textContent = reviewedInSession;
    els.reviewTotal.textContent = reviewedInSession;
    els.reviewProgressBar.style.width = "100%";
    els.questionText.textContent = "You’re done with this review session.";
    els.showAnswerBtn.classList.add("hidden");
    return;
  }

  reviewIndex = nextIndex;
  const card = reviewQueue[reviewIndex];
  const deck = getDeck(card.deckId);
  els.reviewDeckBadge.textContent = deck?.name || "Deck";
  els.reviewPosition.textContent = reviewedInSession + 1;
  els.reviewTotal.textContent = reviewedInSession + reviewQueue.filter(Boolean).length;
  els.reviewProgressBar.style.width = `${Math.min(100, Math.round((reviewedInSession / Math.max(1, reviewedInSession + reviewQueue.filter(Boolean).length)) * 100))}%`;
  els.questionText.textContent = card.question;
  els.answerText.textContent = card.answer;
  els.answerConcepts.innerHTML = (card.tags || [])
    .map(tag => `<span class="concept-tag">${escapeHtml(tag)}</span>`)
    .join("");
  renderRatingLabels(card);
  loadCardMedia(card).catch(error => console.error("Could not load card media", error));
}

function showAnswer() {
  if (!reviewQueue.length || reviewIndex >= reviewQueue.length) return;
  els.answerArea.classList.remove("hidden");
  els.showAnswerBtn.classList.add("hidden");
  els.ratingActions.classList.remove("hidden");
}

async function rateCurrentCard(rating) {
  const card = reviewQueue[reviewIndex];
  if (!card) return;

  try {
    const updated = scheduleCard(card, rating);
    const { error: cardError } = await supabaseClient
      .from("cards")
      .update({
        due_at: new Date(updated.dueAt).toISOString(),
        interval: updated.interval,
        ease: updated.ease,
        card_state: updated.cardState,
        learning_step: updated.learningStep || 0,
        lapse_interval: updated.lapseInterval || 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", card.id);
    if (cardError) throw cardError;

    const { error: reviewError } = await supabaseClient.from("reviews").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      card_id: card.id,
      deck_id: card.deckId,
      rating,
      reviewed_at: new Date().toISOString()
    });
    if (reviewError) throw reviewError;

    reviewQueue[reviewIndex] = null;
    reviewedInSession++;
    if (["learning", "relearning"].includes(updated.cardState)) {
      reviewQueue.push(updated);
    }
    await loadCloudState();
    renderReviewCard();
    renderAll();
  } catch (error) {
    showError(error, "Could not save this review.");
  }
}

function openCardDialog(card = null) {
  if (card) {
    els.cardDialogTitle.textContent = "Edit card";
    els.cardId.value = card.id;
    els.cardDeck.value = card.deckId;
    els.cardQuestion.value = card.question;
    els.cardAnswer.value = card.answer;
    els.cardTags.value = (card.tags || []).join(", ");
  } else {
    els.cardDialogTitle.textContent = "Add card";
    els.cardForm.reset();
    els.cardId.value = "";
    if (state.decks[0]) els.cardDeck.value = state.decks[0].id;
  }
  els.cardDialog.showModal();
}

function safeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

async function uploadFile(file, path) {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`${file.name} is larger than the 25 MB limit.`);
  }

  const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if (error) throw error;
  return path;
}

async function saveCard(event) {
  event.preventDefault();

  try {
    const id = els.cardId.value || crypto.randomUUID();
    const existing = state.cards.find(card => card.id === id);
    const card = {
      id,
      deckId: els.cardDeck.value,
      question: els.cardQuestion.value.trim(),
      answer: els.cardAnswer.value.trim(),
      tags: els.cardTags.value.split(",").map(tag => tag.trim()).filter(Boolean),
      dueAt: existing?.dueAt || Date.now(),
      interval: existing?.interval || 0,
      ease: existing?.ease || 2.5,
      audioPath: existing?.audioPath || null,
      attachments: existing?.attachments || []
    };

    const { error: cardError } = await supabaseClient.from("cards").upsert(cardToRow(card));
    if (cardError) throw cardError;

    const userPrefix = `${session.user.id}/${id}`;
    const audioFile = els.cardAudioFile.files[0];
    if (audioFile) {
      card.audioPath = await uploadFile(
        audioFile,
        `${userPrefix}/reference-${Date.now()}-${safeFileName(audioFile.name)}`
      );
    }

    const attachmentFiles = [...els.cardAttachmentsInput.files];
    if (attachmentFiles.length) {
      const newPaths = await Promise.all(attachmentFiles.map(file => uploadFile(
        file,
        `${userPrefix}/attachment-${Date.now()}-${safeFileName(file.name)}`
      )));
      card.attachments = [...card.attachments, ...newPaths];
    }

    if (audioFile || attachmentFiles.length) {
      const { error: mediaError } = await supabaseClient
        .from("cards")
        .update({
          audio_path: card.audioPath,
          attachment_paths: card.attachments,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
      if (mediaError) throw mediaError;
    }

    els.cardDialog.close();
    await loadCloudState();
    renderAll();
  } catch (error) {
    showError(error, "Could not save this card.");
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") index++;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows.shift().map(header => header.toLowerCase().replace(/\s+/g, "_"));
  return rows.map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""])
  ));
}

function parseImportCards(text, fileName) {
  if (fileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.cards || [];
  }
  return parseCsv(text);
}

function normalizeImportCard(item) {
  const deckName = item.deck || item.deckName || item.deck_name || "Imported";
  const tags = Array.isArray(item.tags)
    ? item.tags
    : String(item.tags || "").split(/[|,]/).map(tag => tag.trim()).filter(Boolean);

  return {
    deckName: String(deckName).trim() || "Imported",
    question: String(item.question || item.front || "").trim(),
    answer: String(item.answer || item.back || "").trim(),
    tags
  };
}

async function importCardsFromFile(file) {
  try {
    setSyncStatus("Importing...");
    const imported = parseImportCards(await file.text(), file.name)
      .map(normalizeImportCard)
      .filter(card => card.question && card.answer);

    if (!imported.length) {
      throw new Error("No valid cards found. Each card needs a question and answer.");
    }

    const deckNames = [...new Set(imported.map(card => card.deckName))];
    const existingDeckNames = new Set(state.decks.map(deck => deck.name.toLowerCase()));
    const decksToCreate = deckNames
      .filter(name => !existingDeckNames.has(name.toLowerCase()))
      .map(name => ({ id: crypto.randomUUID(), user_id: session.user.id, name }));

    let newDecks = [];
    if (decksToCreate.length) {
      const { data, error } = await supabaseClient
        .from("decks")
        .insert(decksToCreate)
        .select("*");
      if (error) throw error;
      newDecks = data || [];
    }

    const allDecks = [...state.decks, ...newDecks];
    const deckIds = new Map(allDecks.map(deck => [deck.name.toLowerCase(), deck.id]));
    const cardRows = imported.map(card => ({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      deck_id: deckIds.get(card.deckName.toLowerCase()),
      question: card.question,
      answer: card.answer,
      tags: card.tags,
      due_at: new Date().toISOString(),
      interval: 0,
      ease: 2.5,
      card_state: "new",
      learning_step: 0,
      lapse_interval: 0
    }));

    const { error: cardError } = await supabaseClient.from("cards").insert(cardRows);
    if (cardError) throw cardError;

    await loadCloudState();
    renderAll();
    alert(`${cardRows.length} card${cardRows.length === 1 ? "" : "s"} imported successfully.`);
  } catch (error) {
    showError(error, "Could not import this file.");
  } finally {
    els.importFileInput.value = "";
  }
}

async function deleteCard(cardId) {
  const card = state.cards.find(item => item.id === cardId);
  if (!card || !confirm(`Delete "${card.question}"?`)) return;

  try {
    const paths = [card.audioPath, ...(card.attachments || [])].filter(Boolean);
    if (paths.length) await supabaseClient.storage.from(STORAGE_BUCKET).remove(paths);

    const { error } = await supabaseClient.from("cards").delete().eq("id", cardId);
    if (error) throw error;
    await loadCloudState();
    renderAll();
    renderCards();
  } catch (error) {
    showError(error, "Could not delete this card.");
  }
}

async function createDeck(event) {
  event.preventDefault();
  const name = els.deckName.value.trim();
  if (!name) return;

  try {
    const { error } = await supabaseClient.from("decks").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      name
    });
    if (error) throw error;
    els.deckDialog.close();
    els.deckForm.reset();
    await loadCloudState();
    renderAll();
  } catch (error) {
    showError(error, "Could not create this deck.");
  }
}

function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.voiceStatus.textContent = "Audio recording works, but speech transcription is not supported here.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => els.transcriptBox.classList.remove("hidden");
  recognition.onresult = event => {
    latestTranscript = [...event.results].map(result => result[0].transcript).join(" ");
    els.transcriptBox.textContent = latestTranscript;
  };
  recognition.onerror = event => {
    if (event.error !== "aborted") els.voiceStatus.textContent = `Transcription error: ${event.error}`;
  };
}

async function startRecording() {
  const card = reviewQueue[reviewIndex];
  if (!card || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    els.voiceStatus.textContent = "Audio recording is not supported in this browser.";
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};
    mediaRecorder = new MediaRecorder(recordingStream, options);
    recordingChunks = [];
    recordingCard = card;
    mediaRecorder.ondataavailable = event => {
      if (event.data.size) recordingChunks.push(event.data);
    };
    mediaRecorder.onstop = finishRecording;
    mediaRecorder.start();
    isRecording = true;
    els.recordBtn.textContent = "■ Stop recording";
    els.voiceStatus.textContent = "Recording...";
    els.transcriptBox.classList.remove("hidden");
    if (recognition) {
      try { recognition.start(); } catch (error) { console.debug("Recognition start skipped", error); }
    }
  } catch (error) {
    showError(error, "Microphone permission is required to record audio.");
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  isRecording = false;
  els.recordBtn.disabled = true;
  els.recordBtn.textContent = "Saving recording...";
  if (recognition) {
    try { recognition.stop(); } catch (error) { console.debug("Recognition stop skipped", error); }
  }
  mediaRecorder.stop();
}

async function finishRecording() {
  const card = recordingCard;
  const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  recordingStream?.getTracks().forEach(track => track.stop());
  recordingStream = null;

  try {
    if (!card || !blob.size) throw new Error("No audio was recorded.");
    const fileName = `review-${Date.now()}.webm`;
    const path = await uploadFile(new File([blob], fileName, { type: blob.type }), `${session.user.id}/${card.id}/${fileName}`);
    const { error } = await supabaseClient.from("review_recordings").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      card_id: card.id,
      storage_path: path,
      transcript: latestTranscript || null
    });
    if (error) throw error;
    els.voiceStatus.textContent = "Recording saved to this review.";
    await loadCardMedia(card);
  } catch (error) {
    showError(error, "Could not save this recording.");
  } finally {
    mediaRecorder = null;
    recordingCard = null;
    els.recordBtn.disabled = false;
    els.recordBtn.textContent = "🎙 Record answer";
  }
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  els.authTitle.textContent = isSignup ? "Create your account" : "Sign in to continue";
  els.authSubtitle.textContent = isSignup
    ? "Create an account to sync your decks, reviews, and audio."
    : "Your decks, reviews, and audio stay synced across devices.";
  els.authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  els.authToggle.textContent = isSignup ? "Already have an account? Sign in" : "Need an account? Sign up";
  els.authPassword.autocomplete = isSignup ? "new-password" : "current-password";
  els.authStatus.textContent = "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  els.authStatus.textContent = authMode === "signup" ? "Creating account..." : "Signing in...";
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  const result = authMode === "signup"
    ? await supabaseClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: APP_URL }
    })
    : await supabaseClient.auth.signInWithPassword({ email, password });

  if (result.error) {
    els.authStatus.textContent = result.error.message;
    return;
  }

  if (authMode === "signup" && !result.data.session) {
    els.authStatus.textContent = "Account created. Check your email to confirm, then sign in.";
  }
}

async function handleSession(nextSession) {
  session = nextSession;
  if (!session) {
    els.appShell.classList.add("hidden");
    els.authGate.classList.remove("hidden");
    return;
  }

  els.authGate.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.userEmail.textContent = session.user.email || "Signed in";

  try {
    await loadCloudState();
    renderAll();
  } catch (error) {
    showError(error, "Run supabase/schema.sql in Supabase SQL Editor first.");
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAll() {
  renderStats();
  renderDecks();
  if (currentView === "cards") renderCards();
}

function setSidebarCollapsed(collapsed) {
  els.appShell.classList.toggle("sidebar-collapsed", collapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  els.sidebarToggle.setAttribute("aria-label", collapsed ? "Open sidebar" : "Collapse sidebar");
  els.sidebarToggle.title = collapsed ? "Open sidebar" : "Collapse sidebar";
  els.sidebarToggle.textContent = collapsed ? "›" : "‹";
  localStorage.setItem("anki-sidebar-collapsed", String(collapsed));
}

els.navItems.forEach(item => item.addEventListener("click", () => switchView(item.dataset.view)));
els.sidebarToggle.addEventListener("click", () => {
  setSidebarCollapsed(!els.appShell.classList.contains("sidebar-collapsed"));
});
els.startReviewBtn.addEventListener("click", () => switchView("review"));
els.showAnswerBtn.addEventListener("click", showAnswer);
els.addCardBtn.addEventListener("click", () => openCardDialog());
els.importBtn.addEventListener("click", () => els.importFileInput.click());
els.importFileInput.addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importCardsFromFile(file);
});
els.addDeckBtn.addEventListener("click", () => els.deckDialog.showModal());
els.recordBtn.addEventListener("click", toggleRecording);
els.authForm.addEventListener("submit", event => handleAuthSubmit(event).catch(error => {
  els.authStatus.textContent = error.message;
}));
els.authToggle.addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
els.signOutBtn.addEventListener("click", () => supabaseClient.auth.signOut());
els.ratingActions.addEventListener("click", event => {
  const button = event.target.closest("[data-rating]");
  if (button) rateCurrentCard(button.dataset.rating);
});
els.deckList.addEventListener("click", event => {
  const button = event.target.closest("[data-deck-id]");
  if (!button) return;
  switchView("review");
  beginReview(button.dataset.deckId);
});
els.cardsTable.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = state.cards.find(item => item.id === button.dataset.cardId);
  if (button.dataset.action === "edit") openCardDialog(card);
  if (button.dataset.action === "delete") deleteCard(button.dataset.cardId);
});
els.searchInput.addEventListener("input", renderCards);
els.deckFilter.addEventListener("change", renderCards);
els.cardForm.addEventListener("submit", event => saveCard(event));
els.deckForm.addEventListener("submit", event => createDeck(event));
els.closeCardDialog.addEventListener("click", () => els.cardDialog.close());
els.cancelCardBtn.addEventListener("click", () => els.cardDialog.close());
els.closeDeckDialog.addEventListener("click", () => els.deckDialog.close());
els.cancelDeckBtn.addEventListener("click", () => els.deckDialog.close());

setupVoiceRecognition();
setSidebarCollapsed(localStorage.getItem("anki-sidebar-collapsed") === "true");

supabaseClient.auth.onAuthStateChange((event, nextSession) => {
  setTimeout(() => handleSession(nextSession), 0);
});

supabaseClient.auth.getSession()
  .then(({ data: { session: currentSession } }) => handleSession(currentSession))
  .catch(error => {
    els.authStatus.textContent = error.message;
  });
