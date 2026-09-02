const DEFAULT_STATE = {
  decks: [
    { id: "js", name: "JavaScript" },
    { id: "react", name: "React" },
    { id: "system", name: "System Design" },
    { id: "backend", name: "Backend" },
    { id: "behavioral", name: "Behavioral" }
  ],
  cards: [
    {
      id: crypto.randomUUID(),
      deckId: "js",
      question: "What is a closure in JavaScript?",
      answer: "A closure is created when a function retains access to variables from its lexical scope even after the outer function has finished executing.",
      tags: ["javascript", "scope", "closure"],
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    },
    {
      id: crypto.randomUUID(),
      deckId: "react",
      question: "Why can stale closures happen in React?",
      answer: "A callback can capture state or props from the render in which it was created. If that callback runs later, it may read an older snapshot unless dependencies, functional updates, refs, or another suitable pattern are used.",
      tags: ["react", "closures", "state"],
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    },
    {
      id: crypto.randomUUID(),
      deckId: "system",
      question: "Why can Canvas outperform thousands of DOM nodes for dense visualizations?",
      answer: "Canvas draws many visual primitives into one DOM element, avoiding the layout, style calculation and memory overhead of thousands of individual DOM elements. The tradeoff is that interaction and accessibility must be implemented manually.",
      tags: ["canvas", "performance", "frontend-system-design"],
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    },
    {
      id: crypto.randomUUID(),
      deckId: "backend",
      question: "What problem does an event-driven architecture solve?",
      answer: "It decouples producers from consumers. A producer publishes an event and independent consumers react to it asynchronously, which improves extensibility and can help scale workloads independently.",
      tags: ["backend", "events", "architecture"],
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    },
    {
      id: crypto.randomUUID(),
      deckId: "behavioral",
      question: "How should you structure a behavioral interview answer?",
      answer: "Use STAR: Situation, Task, Action and Result. Keep the context short, make your personal actions explicit, and quantify the result when possible.",
      tags: ["behavioral", "star"],
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    }
  ],
  reviews: []
};


const STORAGE_KEY = "interview-anki-state-v1";

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = structuredClone(DEFAULT_STATE);
    saveState(fresh);
    return fresh;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const fresh = structuredClone(DEFAULT_STATE);
    saveState(fresh);
    return fresh;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}


const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function scheduleCard(card, rating, now = Date.now()) {
  const updated = { ...card };

  if (rating === "again") {
    updated.interval = 0;
    updated.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
    updated.dueAt = now + MINUTE;
  }

  if (rating === "hard") {
    const nextInterval = Math.max(1, Math.round((card.interval || 1) * 1.2));
    updated.interval = nextInterval;
    updated.ease = Math.max(1.3, (card.ease || 2.5) - 0.05);
    updated.dueAt = now + nextInterval * DAY;
  }

  if (rating === "good") {
    const nextInterval = card.interval > 0
      ? Math.max(3, Math.round(card.interval * (card.ease || 2.5)))
      : 3;
    updated.interval = nextInterval;
    updated.dueAt = now + nextInterval * DAY;
  }

  if (rating === "easy") {
    const nextInterval = card.interval > 0
      ? Math.max(7, Math.round(card.interval * (card.ease || 2.5) * 1.3))
      : 7;
    updated.interval = nextInterval;
    updated.ease = Math.min(3.2, (card.ease || 2.5) + 0.15);
    updated.dueAt = now + nextInterval * DAY;
  }

  return updated;
}

function isDue(card, now = Date.now()) {
  return (card.dueAt || 0) <= now;
}


let state = loadState();
let currentView = "dashboard";
let reviewQueue = [];
let reviewIndex = 0;
let recognition = null;
let isRecording = false;

const els = {
  views: {
    dashboard: document.querySelector("#dashboardView"),
    review: document.querySelector("#reviewView"),
    cards: document.querySelector("#cardsView")
  },
  pageTitle: document.querySelector("#pageTitle"),
  navItems: [...document.querySelectorAll(".nav-item")],
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
  addDeckBtn: document.querySelector("#addDeckBtn"),
  searchInput: document.querySelector("#searchInput"),
  deckFilter: document.querySelector("#deckFilter"),
  cardsTable: document.querySelector("#cardsTable"),
  reviewDeckBadge: document.querySelector("#reviewDeckBadge"),
  reviewPosition: document.querySelector("#reviewPosition"),
  reviewTotal: document.querySelector("#reviewTotal"),
  questionText: document.querySelector("#questionText"),
  answerArea: document.querySelector("#answerArea"),
  answerText: document.querySelector("#answerText"),
  answerConcepts: document.querySelector("#answerConcepts"),
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
  closeCardDialog: document.querySelector("#closeCardDialog"),
  cancelCardBtn: document.querySelector("#cancelCardBtn"),
  deckDialog: document.querySelector("#deckDialog"),
  deckForm: document.querySelector("#deckForm"),
  deckName: document.querySelector("#deckName"),
  closeDeckDialog: document.querySelector("#closeDeckDialog"),
  cancelDeckBtn: document.querySelector("#cancelDeckBtn")
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getDeck(deckId) {
  return state.decks.find(deck => deck.id === deckId);
}

function getDueCards(deckId = null) {
  return state.cards.filter(card =>
    isDue(card) && (!deckId || card.deckId === deckId)
  );
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

function renderStats() {
  const today = startOfToday();
  const todaysReviews = state.reviews.filter(r => r.reviewedAt >= today);
  const successful = todaysReviews.filter(r => ["good", "easy"].includes(r.rating)).length;
  const retention = todaysReviews.length
    ? Math.round((successful / todaysReviews.length) * 100)
    : 0;

  els.dueCount.textContent = getDueCards().length;
  els.totalCards.textContent = state.cards.length;
  els.reviewedToday.textContent = todaysReviews.length;
  els.retentionValue.textContent = `${retention}%`;
  els.streakValue.textContent = calculateStreak();

  const due = getDueCards().length;
  els.heroDueText.textContent = due
    ? `${due} card${due === 1 ? "" : "s"} waiting for you`
    : "No cards due right now";
}

function renderDecks() {
  els.deckList.innerHTML = state.decks.map(deck => {
    const total = state.cards.filter(card => card.deckId === deck.id).length;
    return `
      <button class="deck-item" data-deck-id="${deck.id}">
        <span>${escapeHtml(deck.name)}</span>
        <span>${total}</span>
      </button>
    `;
  }).join("");

  els.deckOverview.innerHTML = state.decks.map(deck => {
    const cards = state.cards.filter(card => card.deckId === deck.id);
    const due = cards.filter(isDue).length;
    return `
      <div class="deck-row">
        <div>
          <strong>${escapeHtml(deck.name)}</strong>
          <small>${cards.length} cards</small>
        </div>
        <small>${due} due</small>
      </div>
    `;
  }).join("") || `<div class="empty-state">No decks yet.</div>`;

  const deckOptions = state.decks.map(
    deck => `<option value="${deck.id}">${escapeHtml(deck.name)}</option>`
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

  els.cardsTable.innerHTML = cards.map(card => {
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
  }).join("");
}

function switchView(view) {
  currentView = view;

  Object.entries(els.views).forEach(([key, element]) => {
    element.classList.toggle("active", key === view);
  });

  els.navItems.forEach(item => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  const titles = {
    dashboard: "Dashboard",
    review: "Review",
    cards: "Cards"
  };
  els.pageTitle.textContent = titles[view];

  if (view === "cards") renderCards();
  if (view === "review") beginReview();
}

function beginReview(deckId = null) {
  reviewQueue = getDueCards(deckId);
  reviewIndex = 0;
  renderReviewCard();
}

function renderReviewCard() {
  els.answerArea.classList.add("hidden");
  els.ratingActions.classList.add("hidden");
  els.showAnswerBtn.classList.remove("hidden");
  els.transcriptBox.classList.add("hidden");
  els.transcriptBox.textContent = "";

  if (!reviewQueue.length || reviewIndex >= reviewQueue.length) {
    els.reviewDeckBadge.textContent = "Complete";
    els.reviewPosition.textContent = reviewQueue.length;
    els.reviewTotal.textContent = reviewQueue.length;
    els.questionText.textContent = "You’re done with this review session.";
    els.answerArea.classList.add("hidden");
    els.showAnswerBtn.classList.add("hidden");
    els.ratingActions.classList.add("hidden");
    return;
  }

  const card = reviewQueue[reviewIndex];
  const deck = getDeck(card.deckId);

  els.reviewDeckBadge.textContent = deck?.name || "Deck";
  els.reviewPosition.textContent = reviewIndex + 1;
  els.reviewTotal.textContent = reviewQueue.length;
  els.questionText.textContent = card.question;
  els.answerText.textContent = card.answer;
  els.answerConcepts.innerHTML = (card.tags || [])
    .map(tag => `<span class="concept-tag">${escapeHtml(tag)}</span>`)
    .join("");
}

function showAnswer() {
  if (!reviewQueue.length || reviewIndex >= reviewQueue.length) return;
  els.answerArea.classList.remove("hidden");
  els.showAnswerBtn.classList.add("hidden");
  els.ratingActions.classList.remove("hidden");
}

function rateCurrentCard(rating) {
  const card = reviewQueue[reviewIndex];
  if (!card) return;

  const updated = scheduleCard(card, rating);
  const stateIndex = state.cards.findIndex(item => item.id === card.id);
  state.cards[stateIndex] = updated;

  state.reviews.push({
    id: crypto.randomUUID(),
    cardId: card.id,
    deckId: card.deckId,
    rating,
    reviewedAt: Date.now()
  });

  saveState(state);
  reviewIndex++;
  renderReviewCard();
  renderAll();
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

function saveCard(event) {
  event.preventDefault();

  const id = els.cardId.value;
  const cardData = {
    deckId: els.cardDeck.value,
    question: els.cardQuestion.value.trim(),
    answer: els.cardAnswer.value.trim(),
    tags: els.cardTags.value.split(",").map(tag => tag.trim()).filter(Boolean)
  };

  if (id) {
    const index = state.cards.findIndex(card => card.id === id);
    state.cards[index] = { ...state.cards[index], ...cardData };
  } else {
    state.cards.push({
      id: crypto.randomUUID(),
      ...cardData,
      dueAt: Date.now(),
      interval: 0,
      ease: 2.5
    });
  }

  saveState(state);
  els.cardDialog.close();
  renderAll();
  if (currentView === "cards") renderCards();
}

function deleteCard(cardId) {
  const card = state.cards.find(card => card.id === cardId);
  if (!card) return;

  const confirmed = confirm(`Delete "${card.question}"?`);
  if (!confirmed) return;

  state.cards = state.cards.filter(card => card.id !== cardId);
  state.reviews = state.reviews.filter(review => review.cardId !== cardId);
  saveState(state);
  renderAll();
  renderCards();
}

function createDeck(event) {
  event.preventDefault();

  const name = els.deckName.value.trim();
  if (!name) return;

  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;

  state.decks.push({ id, name });
  saveState(state);
  els.deckDialog.close();
  els.deckForm.reset();
  renderAll();
}

function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    els.recordBtn.disabled = true;
    els.voiceStatus.textContent = "Voice transcription is not supported in this browser.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecording = true;
    els.recordBtn.textContent = "■ Stop";
    els.voiceStatus.textContent = "Listening...";
    els.transcriptBox.classList.remove("hidden");
  };

  recognition.onresult = event => {
    const transcript = [...event.results]
      .map(result => result[0].transcript)
      .join(" ");
    els.transcriptBox.textContent = transcript;
  };

  recognition.onerror = event => {
    els.voiceStatus.textContent = `Voice error: ${event.error}`;
  };

  recognition.onend = () => {
    isRecording = false;
    els.recordBtn.textContent = "🎙 Start speaking";
    els.voiceStatus.textContent = "Answer captured. Reveal the card and compare your wording.";
  };
}

function escapeHtml(value = "") {
  return value
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

els.navItems.forEach(item =>
  item.addEventListener("click", () => switchView(item.dataset.view))
);

els.startReviewBtn.addEventListener("click", () => switchView("review"));
els.showAnswerBtn.addEventListener("click", showAnswer);
els.addCardBtn.addEventListener("click", () => openCardDialog());
els.addDeckBtn.addEventListener("click", () => els.deckDialog.showModal());

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

  const cardId = button.dataset.cardId;

  if (button.dataset.action === "edit") {
    openCardDialog(state.cards.find(card => card.id === cardId));
  }

  if (button.dataset.action === "delete") {
    deleteCard(cardId);
  }
});

els.searchInput.addEventListener("input", renderCards);
els.deckFilter.addEventListener("change", renderCards);
els.cardForm.addEventListener("submit", saveCard);
els.deckForm.addEventListener("submit", createDeck);

els.closeCardDialog.addEventListener("click", () => els.cardDialog.close());
els.cancelCardBtn.addEventListener("click", () => els.cardDialog.close());
els.closeDeckDialog.addEventListener("click", () => els.deckDialog.close());
els.cancelDeckBtn.addEventListener("click", () => els.deckDialog.close());

els.recordBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (isRecording) recognition.stop();
  else recognition.start();
});

setupVoiceRecognition();
renderAll();
