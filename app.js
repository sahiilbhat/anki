const STORAGE_BUCKET = "card-assets";
const { createClient } = window.supabase || {};

if (!createClient) {
  throw new Error("Supabase client failed to load.");
}

const supabase = createClient(
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

let session = null;
let state = { decks: [], cards: [], reviews: [] };
let currentView = "dashboard";
let reviewQueue = [];
let reviewIndex = 0;
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

  const { error: deckError } = await supabase.from("decks").insert(decks);
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
    ease: 2.5
  }));

  const { error: cardError } = await supabase.from("cards").insert(cards);
  if (cardError) throw cardError;
}

async function loadCloudState() {
  setSyncStatus("Syncing...");

  const [decksResult, cardsResult, reviewsResult] = await Promise.all([
    supabase.from("decks").select("*").order("created_at"),
    supabase.from("cards").select("*").order("created_at"),
    supabase.from("reviews").select("*").order("reviewed_at")
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
  els.navItems.forEach(item => item.classList.toggle("active", item.dataset.view === view));
  els.pageTitle.textContent = { dashboard: "Dashboard", review: "Review", cards: "Cards" }[view];
  if (view === "cards") renderCards();
  if (view === "review") beginReview();
}

function beginReview(deckId = null) {
  reviewQueue = getDueCards(deckId);
  reviewIndex = 0;
  renderReviewCard();
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
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(card.audioPath, 3600);
    if (!error && data?.signedUrl && reviewQueue[reviewIndex]?.id === cardId) {
      els.cardAudio.src = data.signedUrl;
      els.cardAudio.classList.remove("hidden");
    }
  }

  const attachmentLinks = await Promise.all((card.attachments || []).map(async path => {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ? { path, url: data.signedUrl } : null;
  }));

  if (reviewQueue[reviewIndex]?.id === cardId) {
    els.cardAttachments.innerHTML = attachmentLinks.filter(Boolean).map(({ path, url }) => `
      <a href="${url}" target="_blank" rel="noreferrer">📎 ${escapeHtml(path.split("/").pop())}</a>
    `).join("");
  }

  const { data: recordings } = await supabase
    .from("review_recordings")
    .select("storage_path")
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = recordings?.[0];
  if (latest && reviewQueue[reviewIndex]?.id === cardId) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(latest.storage_path, 3600);
    if (data?.signedUrl) {
      els.recordingAudio.src = data.signedUrl;
      els.recordingAudio.classList.remove("hidden");
    }
  }
}

function renderReviewCard() {
  els.answerArea.classList.add("hidden");
  els.ratingActions.classList.add("hidden");
  els.showAnswerBtn.classList.remove("hidden");
  els.transcriptBox.classList.add("hidden");
  els.transcriptBox.textContent = "";
  latestTranscript = "";
  resetMediaPlayers();

  if (!reviewQueue.length || reviewIndex >= reviewQueue.length) {
    els.reviewDeckBadge.textContent = "Complete";
    els.reviewPosition.textContent = reviewQueue.length;
    els.reviewTotal.textContent = reviewQueue.length;
    els.questionText.textContent = "You’re done with this review session.";
    els.showAnswerBtn.classList.add("hidden");
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
    const { error: cardError } = await supabase
      .from("cards")
      .update({
        due_at: new Date(updated.dueAt).toISOString(),
        interval: updated.interval,
        ease: updated.ease,
        updated_at: new Date().toISOString()
      })
      .eq("id", card.id);
    if (cardError) throw cardError;

    const { error: reviewError } = await supabase.from("reviews").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      card_id: card.id,
      deck_id: card.deckId,
      rating,
      reviewed_at: new Date().toISOString()
    });
    if (reviewError) throw reviewError;

    reviewIndex++;
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

  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
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

    const { error: cardError } = await supabase.from("cards").upsert(cardToRow(card));
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
      const { error: mediaError } = await supabase
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

async function deleteCard(cardId) {
  const card = state.cards.find(item => item.id === cardId);
  if (!card || !confirm(`Delete "${card.question}"?`)) return;

  try {
    const paths = [card.audioPath, ...(card.attachments || [])].filter(Boolean);
    if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);

    const { error } = await supabase.from("cards").delete().eq("id", cardId);
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
    const { error } = await supabase.from("decks").insert({
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
    const { error } = await supabase.from("review_recordings").insert({
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
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password });

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

els.navItems.forEach(item => item.addEventListener("click", () => switchView(item.dataset.view)));
els.startReviewBtn.addEventListener("click", () => switchView("review"));
els.showAnswerBtn.addEventListener("click", showAnswer);
els.addCardBtn.addEventListener("click", () => openCardDialog());
els.addDeckBtn.addEventListener("click", () => els.deckDialog.showModal());
els.recordBtn.addEventListener("click", toggleRecording);
els.authForm.addEventListener("submit", event => handleAuthSubmit(event).catch(error => {
  els.authStatus.textContent = error.message;
}));
els.authToggle.addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
els.signOutBtn.addEventListener("click", () => supabase.auth.signOut());
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

supabase.auth.onAuthStateChange((event, nextSession) => {
  setTimeout(() => handleSession(nextSession), 0);
});

supabase.auth.getSession()
  .then(({ data: { session: currentSession } }) => handleSession(currentSession))
  .catch(error => {
    els.authStatus.textContent = error.message;
  });
