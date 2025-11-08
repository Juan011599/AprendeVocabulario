/* English Trainer — Verb Master
   Pure JS frontend app with localStorage persistence, SpeechSynthesis and basic review & game modes.
   Place this file in the same folder as index.html and style.css.
*/

(() => {
  // ---- Configuration & state
  const DEFAULT_SESSION_COUNT = 10;
  const DATA_PATH = 'data/verbs-full.json'; // relative path; fallback included below
  let VERBS = []; // loaded verbs
  let sessionVerbs = [];
  let state = {
    user: null,
    level: 'A1',
    tense: 'present',
    sessionCount: DEFAULT_SESSION_COUNT,
    currentIndex: 0,
    learned: [], // array of verb indices in sessionVerbs
    reviewList: [], // objects {verb, correctCount, lastReviewed}
    stats: { learnedTotal: 0, sessions: [] },
    gameScore: 0
  };

  // ---- DOM refs
  const byId = (id) => document.getElementById(id);
  const setup = byId('setup');
  const learning = byId('learning');
  const review = byId('review');
  const game = byId('game');
  const stats = byId('stats');

  const userSummary = byId('userSummary');

  // Setup form elements
  const setupForm = byId('setupForm');
  const userNameInput = byId('userName');
  const userLevelSelect = byId('userLevel');
  const segBtns = [...document.querySelectorAll('.seg-btn')];
  const selectedTenseInput = byId('selectedTense');
  const sessionCountInput = byId('sessionCount');
  const startBtn = byId('startBtn');
  const continueBtn = byId('continueBtn');

  // Learning elements
  const verbIndexEl = byId('verbIndex');
  const progressFill = byId('progressFill');
  const verbBase = byId('verbBase');
  const verbPast = byId('verbPast');
  const verbPart = byId('verbPart');
  const verbTranslation = byId('verbTranslation');
  const verbExample = byId('verbExample');
  const exampleLevel = byId('exampleLevel');
  const playPron = byId('playPron');
  const autoPron = byId('autoPron');
  const enableSpeechRec = byId('enableSpeechRec');
  const learnedBtn = byId('learnedBtn');
  const skipBtn = byId('skipBtn');
  const toReviewBtn = byId('toReviewBtn');
  const toGameBtn = byId('toGameBtn');
  const endSessionBtn = byId('endSessionBtn');

  // Review elements
  const reviewMode = byId('reviewMode');
  const startReviewBtn = byId('startReviewBtn');
  const reviewArea = byId('reviewArea');
  const reviewPrompt = byId('reviewPrompt');
  const reviewInput = byId('reviewInput');
  const reviewFeedback = byId('reviewFeedback');
  const reviewNext = byId('reviewNext');
  const reviewBack = byId('reviewBack');
  const backToLearningFromReview = byId('backToLearningFromReview');

  // Game elements
  const gameSentence = byId('gameSentence');
  const gameChoices = byId('gameChoices');
  const gameScore = byId('gameScore');
  const backToLearningFromGame = byId('backToLearningFromGame');

  // Stats elements
  const statsBody = byId('statsBody');
  const resetProgress = byId('resetProgress');
  const backToSetupFromStats = byId('backToSetupFromStats');

  // Utilities
  const ls = window.localStorage;

  function log(...args){ console.log('[ET]',...args) }

  function saveUserData() {
    if (!state.user) return;
    const key = `et_user_${state.user}`;
    const payload = {
      level: state.level,
      tense: state.tense,
      learned: state.learned,
      reviewList: state.reviewList,
      stats: state.stats,
      lastSession: {
        verbs: sessionVerbs.map(v => v.verb),
        currentIndex: state.currentIndex,
        sessionCount: state.sessionCount,
        timestamp: new Date().toISOString()
      }
    };
    ls.setItem(key, JSON.stringify(payload));
    ls.setItem('et_last_user', state.user);
    updateUserSummary();
  }

  function loadUserData(name){
    const key = `et_user_${name}`;
    const raw = ls.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch(e){ return null; }
  }

  function updateUserSummary(){
    if (!state.user) {
      userSummary.innerHTML = `<em>No hay usuario</em>`;
      return;
    }
    const key = `et_user_${state.user}`;
    const raw = ls.getItem(key);
    let parsed = raw ? JSON.parse(raw) : null;
    let learnedTotal = parsed?.stats?.learnedTotal ?? 0;
    let last = parsed?.lastSession?.timestamp ? new Date(parsed.lastSession.timestamp).toLocaleString() : '—';
    userSummary.innerHTML = `${state.user} · Nivel ${state.level.toUpperCase()} · Aprendidos: ${learnedTotal} · Última sesión: ${last}`;
  }

  // --------------------
  // Load verbs (fetch JSON). Provide fallback built-in sample if fetch fails (useful when opening file://).
  async function loadVerbs(){
    try {
      const resp = await fetch(DATA_PATH);
      if (!resp.ok) throw new Error('No se pudo cargar el JSON');
      const json = await resp.json();
      VERBS = json;
      log('Cargados', VERBS.length, 'verbos desde', DATA_PATH);
    } catch (err){
      console.warn('Fallo fetch, usando fallback interno. Error:', err);
      VERBS = builtinVerbs();
    }
  }

  // Minimal, safe shuffle
  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }

  // pick examples depending on level (A1,B1,B2)
  function exampleForLevel(verbObj, level){
    if (level === 'A1') return verbObj.example_A1 || verbObj.example_B1 || verbObj.example_B2 || '';
    if (level === 'B1') return verbObj.example_B1 || verbObj.example_A1 || verbObj.example_B2 || '';
    return verbObj.example_B2 || verbObj.example_B1 || verbObj.example_A1 || '';
  }

  // Tense rendering
  function renderVerbForTense(vObj, tense){
    if (tense === 'present') return vObj.verb;
    if (tense === 'past') return vObj.past || vObj.verb;
    if (tense === 'future') return `will ${vObj.verb}`;
    return vObj.verb;
  }

  // Pronunciation (SpeechSynthesis with en-US voice preference)
  function speak(text){
    if (!('speechSynthesis' in window)) {
      alert('Tu navegador no soporta SpeechSynthesis');
      return;
    }
    const s = new SpeechSynthesisUtterance(text);
    // choose en-US voice if available
    const voices = speechSynthesis.getVoices();
    const en = voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (en) s.voice = en;
    s.rate = 0.95;
    s.pitch = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(s);
  }

  // Try to get en voice list (some browsers lazy-load voices)
  function ensureVoicesLoaded(){
    if (speechSynthesis && speechSynthesis.getVoices().length === 0){
      speechSynthesis.addEventListener('voiceschanged', ()=>{ log('voices loaded'); });
    }
  }

  // Basic SpeechRecognition wrapper (experimental)
  let recognition = null;
  function initSpeechRecognition(){
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      return null;
    }
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new ctor();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    return r;
  }

  // --------------------
  // UI logic
  function showSection(sec){
    [setup, learning, review, game, stats].forEach(s => s.classList.add('hidden'));
    sec.classList.remove('hidden');
  }

  // setup events
  segBtns.forEach(b => b.addEventListener('click', (e)=>{
    segBtns.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    selectedTenseInput.value = b.dataset.tense;
    state.tense = b.dataset.tense;
  }));

  continueBtn.addEventListener('click', ()=>{
    const lastUser = ls.getItem('et_last_user');
    if (!lastUser) return alert('No hay sesiones previas guardadas.');
    // load user data and restore minimal state
    const parsed = loadUserData(lastUser);
    if (!parsed) return alert('No se encontró data del usuario anterior.');
    state.user = lastUser;
    state.level = parsed.level || 'A1';
    state.tense = parsed.tense || 'present';
    state.reviewList = parsed.reviewList || [];
    state.stats = parsed.stats || { learnedTotal:0, sessions:[] };
    updateUserSummary();
    alert('Usuario cargado: ' + lastUser + '. Pulsa "Comenzar sesión" para generar una nueva sesión con los verbos.');
  });

  startBtn.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    const name = (userNameInput.value || '').trim();
    if (!name) return alert('Escribe un nombre de usuario.');
    state.user = name;
    state.level = userLevelSelect.value;
    state.tense = selectedTenseInput.value || 'present';
    state.sessionCount = Math.max(1, Math.min(100, Number(sessionCountInput.value) || DEFAULT_SESSION_COUNT));

    // load verbs if not loaded
    await loadVerbs();

    // select random verbs
    sessionVerbs = shuffle([...VERBS]).slice(0, state.sessionCount);

    // reset session-specific state
    state.currentIndex = 0;
    state.learned = [];
    state.gameScore = 0;

    // try to restore user saved info if exists (keeps aggregate progress)
    const loaded = loadUserData(state.user);
    if (loaded) {
      state.stats = loaded.stats || state.stats;
      state.reviewList = loaded.reviewList || [];
    } else {
      // initialize stats
      state.stats = state.stats || { learnedTotal: 0, sessions: [] };
      state.reviewList = state.reviewList || [];
    }

    updateUserSummary();
    saveUserData();

    // go to learning screen
    showLearning();
    renderCurrentVerb();
  });

  // render learning
  function showLearning(){
    showSection(learning);
    updateProgressBar();
  }

  function updateProgressBar(){
    const total = state.sessionCount || 1;
    const cur = Math.min(state.currentIndex+1, total);
    const p = Math.round((state.currentIndex / total) * 100);
    progressFill.style.width = `${p}%`;
  }

  function renderCurrentVerb(){
    const idx = state.currentIndex;
    const total = state.sessionCount;
    verbIndexEl.textContent = `Verbo ${idx+1} / ${total}`;
    updateProgressBar();

    const v = sessionVerbs[idx];
    if (!v) return alert('No hay más verbos en la sesión.');
    const tense = state.tense;
    const display = renderVerbForTense(v, tense);

    verbBase.textContent = v.verb;
    verbPast.textContent = v.past || '-';
    verbPart.textContent = v.participle || '-';
    verbTranslation.textContent = v.translation || '';
    const ex = exampleForLevel(v, state.level);
    exampleLevel.textContent = state.level;
    // adapt example to selected tense if possible (naive replace of verb)
    const example = adaptExampleToTense(ex, v, tense);
    verbExample.textContent = example;
  }

  function adaptExampleToTense(exampleText, v, tense){
    if (!exampleText) return '';
    // naive: if present -> base; past -> past; future -> will base
    if (tense === 'present') return exampleText.replace(new RegExp(`\\b(${v.past}|${v.participle}|${v.verb})\\b`,'gi'), v.verb);
    if (tense === 'past') return exampleText.replace(new RegExp(`\\b(${v.verb}|${v.participle}|${v.past})\\b`,'gi'), v.past || v.verb);
    if (tense === 'future') return exampleText.replace(new RegExp(`\\b(${v.verb}|${v.past}|${v.participle})\\b`,'gi'), `will ${v.verb}`);
    return exampleText;
  }

  // Pronunciation events
  playPron.addEventListener('click', ()=>{
    const v = sessionVerbs[state.currentIndex];
    if (!v) return;
    const toSpeak = renderVerbForTense(v, state.tense);
    speak(toSpeak);
  });

  autoPron.addEventListener('click', ()=>{
    // toggles automatic pronunciation every time the verb changes for demo (simple)
    const v = sessionVerbs[state.currentIndex];
    if (!v) return;
    speak(renderVerbForTense(v, state.tense) + '. ' + exampleForLevel(v, state.level));
  });

  // Learned / skip
  learnedBtn.addEventListener('click', ()=>{
    markLearnedCurrent();
    moveToNext();
  });

  skipBtn.addEventListener('click', ()=>{
    moveToNext();
  });

  function markLearnedCurrent(){
    const v = sessionVerbs[state.currentIndex];
    if (!v) return;
    // add to learned and review list
    state.learned.push(v.verb);
    const found = state.reviewList.find(x => x.verb === v.verb);
    if (!found) {
      state.reviewList.push({ verb: v.verb, translation: v.translation, correctCount: 0, lastReviewed: null });
    }
    // update stats
    state.stats.learnedTotal = (state.stats.learnedTotal || 0) + 1;
    saveUserData();
  }

  function moveToNext(){
    if (state.currentIndex < state.sessionCount -1){
      state.currentIndex++;
      renderCurrentVerb();
    } else {
      // session finished
      state.stats.sessions.push({ date: new Date().toISOString(), learnedThisSession: state.learned.length, sessionCount: state.sessionCount });
      saveUserData();
      alert(`Sesión completada. Verbos aprendidos en esta sesión: ${state.learned.length}`);
      showSection(stats);
      renderStats();
    }
  }

  // End session
  endSessionBtn.addEventListener('click', ()=>{
    if (!confirm('¿Terminar sesión y guardar progreso?')) return;
    state.stats.sessions.push({ date: new Date().toISOString(), learnedThisSession: state.learned.length, sessionCount: state.sessionCount });
    saveUserData();
    showSection(stats);
    renderStats();
  });

  // go to Review
  toReviewBtn.addEventListener('click', ()=>{
    showSection(review);
  });

  startReviewBtn.addEventListener('click', ()=>{
    startReview();
  });

  function startReview(){
    // prepare review queue from state.reviewList
    if (!state.reviewList.length) return alert('No tienes verbos para repasar. Marca algunos como "Ya lo aprendí" primero.');
    reviewArea.classList.remove('hidden');
    reviewIndex = 0;
    reviewQueue = shuffle([...state.reviewList]);
    renderReviewItem();
  }

  let reviewQueue = [];
  let reviewIndex = 0;

  function renderReviewItem(){
    if (reviewIndex >= reviewQueue.length){
      reviewFeedback.textContent = 'Repaso completado 🎉';
      return;
    }
    const item = reviewQueue[reviewIndex];
    const vObj = VERBS.find(v => v.verb === item.verb) || sessionVerbs.find(v => v.verb === item.verb) || item;
    const mode = reviewMode.value; // en-es or es-en
    if (mode === 'en-es'){
      reviewPrompt.textContent = renderVerbForTense(vObj, state.tense);
      reviewInput.value = '';
      reviewInput.placeholder = 'Traduce al español...';
    } else {
      reviewPrompt.textContent = vObj.translation || '—';
      reviewInput.value = '';
      reviewInput.placeholder = 'Escribe el verbo en inglés (base form)...';
    }
    reviewFeedback.textContent = '';
    reviewInput.focus();
  }

  reviewInput.addEventListener('input', ()=>{
    const val = reviewInput.value.trim().toLowerCase();
    const item = reviewQueue[reviewIndex];
    const vObj = VERBS.find(v => v.verb === item.verb) || sessionVerbs.find(v => v.verb === item.verb) || item;
    const mode = reviewMode.value;
    if (!vObj) return;
    if (mode === 'en-es'){
      // target: translation (simple contains)
      const target = (vObj.translation || '').toLowerCase();
      if (target && (target === val || target.includes(val))) {
        reviewFeedback.textContent = '✅ Correcto';
        reviewFeedback.style.color = 'var(--accent-2)';
      } else {
        reviewFeedback.textContent = '❌ Sigue intentando...';
        reviewFeedback.style.color = 'var(--muted)';
      }
    } else {
      // spanish -> english: allow base/past/participle
      const acceptable = [vObj.verb, vObj.past, vObj.participle].filter(Boolean).map(x=>x.toLowerCase());
      if (acceptable.includes(val)) {
        reviewFeedback.textContent = '✅ Correcto';
        reviewFeedback.style.color = 'var(--accent-2)';
      } else {
        reviewFeedback.textContent = '❌ Sigue intentando...';
        reviewFeedback.style.color = 'var(--muted)';
      }
    }
  });

  reviewNext.addEventListener('click', ()=>{
    // evaluate and update counters
    const val = reviewInput.value.trim().toLowerCase();
    const item = reviewQueue[reviewIndex];
    const vObj = VERBS.find(v => v.verb === item.verb) || sessionVerbs.find(v => v.verb === item.verb) || item;
    const mode = reviewMode.value;
    let correct = false;
    if (mode === 'en-es'){
      const target = (vObj.translation || '').toLowerCase();
      correct = (val === target) || (target && target.includes(val));
    } else {
      correct = [vObj.verb, vObj.past, vObj.participle].filter(Boolean).map(x=>x.toLowerCase()).includes(val);
    }
    if (correct){
      // bump correctCount
      const rItem = state.reviewList.find(x=>x.verb===item.verb);
      if (rItem) rItem.correctCount = (rItem.correctCount||0)+1;
    }
    if (state.reviewList.length) {
      state.reviewList.forEach(x => x.lastReviewed = new Date().toISOString());
    }
    saveUserData();
    reviewIndex++;
    if (reviewIndex < reviewQueue.length){
      renderReviewItem();
    } else {
      alert('Repaso finalizado');
      showSection(learning);
      renderCurrentVerb();
    }
  });

  reviewBack.addEventListener('click', ()=>{
    if (reviewIndex>0) reviewIndex--;
    renderReviewItem();
  });

  backToLearningFromReview.addEventListener('click', ()=>{
    showSection(learning);
    renderCurrentVerb();
  });

  // --------------------
  // Game: multiple-choice fill-in-the-blank using examples
  function startGame(){
    if (!sessionVerbs.length) return alert('Inicia una sesión primero.');
    state.gameScore = 0;
    gameScore.textContent = 'Puntaje: 0';
    showSection(game);
    nextGameRound();
  }

  function nextGameRound(){
    // pick random verb from sessionVerbs
    const pool = sessionVerbs.slice();
    const v = pool[Math.floor(Math.random()*pool.length)];
    const ex = exampleForLevel(v, state.level);
    // create blank by replacing the verb with "____"
    const tense = state.tense;
    const term = renderVerbForTense(v, tense);
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
    const sentence = regex.test(ex) ? ex.replace(regex, '_____') : ex + ' (use: _____)';
    gameSentence.textContent = sentence;

    // choices: correct + 3 wrong
    const correct = term;
    const choices = new Set([correct]);
    while (choices.size < 4) {
      const cand = sessionVerbs[Math.floor(Math.random()*sessionVerbs.length)];
      const cterm = renderVerbForTense(cand, tense);
      if (cterm !== correct) choices.add(cterm);
    }
    const arr = shuffle([...choices]);
    renderGameChoices(arr, correct);
  }

  function renderGameChoices(arr, correct){
    gameChoices.innerHTML = '';
    arr.forEach(ch=>{
      const btn = document.createElement('button');
      btn.textContent = ch;
      btn.className = 'choice';
      btn.addEventListener('click', ()=>{
        if (ch === correct){
          state.gameScore++;
          gameScore.textContent = `Puntaje: ${state.gameScore}`;
          btn.style.borderColor = 'var(--accent-2)';
          setTimeout(nextGameRound, 700);
        } else {
          btn.style.borderColor = 'var(--danger)';
          setTimeout(nextGameRound, 700);
        }
      });
      gameChoices.appendChild(btn);
    });
  }

  backToLearningFromGame.addEventListener('click', ()=>{
    showSection(learning);
    renderCurrentVerb();
  });

  toGameBtn.addEventListener('click', startGame);

  // --------------------
  // Stats
  function renderStats(){
    const parsed = loadUserData(state.user) || {};
    const sessions = parsed.stats?.sessions || [];
    const learnedTotal = parsed.stats?.learnedTotal || 0;
    const lastSession = parsed.lastSession ? new Date(parsed.lastSession.timestamp).toLocaleString() : '—';
    statsBody.innerHTML = `
      <p>Usuario: <strong>${state.user || '—'}</strong></p>
      <p>Nivel: ${state.level.toUpperCase()}</p>
      <p>Tiempo verbal preferido: ${state.tense}</p>
      <p>Lecciones completadas: ${sessions.length}</p>
      <p>Verbos aprendidos (total): ${learnedTotal}</p>
      <p>Última sesión: ${lastSession}</p>
      <h4>Historial de sesiones</h4>
      <ul>
        ${sessions.map(s=>`<li>${new Date(s.date).toLocaleString()}: ${s.learnedThisSession}/${s.sessionCount} verbos</li>`).join('')}
      </ul>
    `;
  }

  resetProgress.addEventListener('click', ()=>{
    if (!confirm('Borrarás TODO el progreso para este usuario. ¿Continuar?')) return;
    if (!state.user) return alert('No hay usuario.');
    ls.removeItem(`et_user_${state.user}`);
    ls.removeItem('et_last_user');
    alert('Progreso eliminado.');
    location.reload();
  });

  backToSetupFromStats.addEventListener('click', ()=>{
    showSection(setup);
  });

  // --------------------
  // Helpers & init
  // escape regex
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // load fallback verbs (small sample). IMPORTANT: you should replace data/verbs-full.json with full 350 verbs.
  function builtinVerbs(){
    return [
      {"verb":"be","past":"was/were","participle":"been","translation":"ser/estar","example_A1":"I am happy.","example_B1":"He was at work yesterday.","example_B2":"They have been friends for years."},
      {"verb":"have","past":"had","participle":"had","translation":"tener","example_A1":"I have a book.","example_B1":"She had a car last year.","example_B2":"We have had enough time to decide."},
      {"verb":"do","past":"did","participle":"done","translation":"hacer","example_A1":"I do my homework.","example_B1":"He did the job well.","example_B2":"They have done their best."},
      {"verb":"go","past":"went","participle":"gone","translation":"ir","example_A1":"I go to school every day.","example_B1":"She went to the mountains last weekend.","example_B2":"They have gone to study abroad for two years."},
      {"verb":"say","past":"said","participle":"said","translation":"decir","example_A1":"I say hello.","example_B1":"He said he would come.","example_B2":"She has said that before."},
      {"verb":"get","past":"got","participle":"got/gotten","translation":"obtener/recibir","example_A1":"I get up early.","example_B1":"She got a new job.","example_B2":"They have gotten better."},
      {"verb":"make","past":"made","participle":"made","translation":"hacer/crear","example_A1":"I make coffee.","example_B1":"He made a cake yesterday.","example_B2":"They have made progress."},
      {"verb":"know","past":"knew","participle":"known","translation":"saber/conocer","example_A1":"I know the answer.","example_B1":"He knew the truth.","example_B2":"She has known him for years."},
      {"verb":"think","past":"thought","participle":"thought","translation":"pensar","example_A1":"I think it's fine.","example_B1":"She thought about it all night.","example_B2":"They have thought about moving."},
      {"verb":"take","past":"took","participle":"taken","translation":"tomar","example_A1":"I take the bus.","example_B1":"He took the book.","example_B2":"She has taken many courses."},
      {"verb":"see","past":"saw","participle":"seen","translation":"ver","example_A1":"I see a bird.","example_B1":"She saw a movie yesterday.","example_B2":"They have seen that before."},
      {"verb":"come","past":"came","participle":"come","translation":"venir","example_A1":"I come home at 6.","example_B1":"He came late to the party.","example_B2":"They have come to an agreement."},
      {"verb":"want","past":"wanted","participle":"wanted","translation":"querer","example_A1":"I want water.","example_B1":"She wanted a new phone.","example_B2":"They have wanted to travel."},
      {"verb":"look","past":"looked","participle":"looked","translation":"mirar","example_A1":"I look at the sky.","example_B1":"He looked for his keys.","example_B2":"She has looked everywhere."},
      {"verb":"use","past":"used","participle":"used","translation":"usar","example_A1":"I use a pen.","example_B1":"She used the computer.","example_B2":"They have used this method."},
      {"verb":"find","past":"found","participle":"found","translation":"encontrar","example_A1":"I find my pen.","example_B1":"He found a solution.","example_B2":"They have found the answer."},
      {"verb":"give","past":"gave","participle":"given","translation":"dar","example_A1":"I give you a gift.","example_B1":"She gave him a chance.","example_B2":"They have given a donation."},
      {"verb":"tell","past":"told","participle":"told","translation":"contar/decir","example_A1":"I tell a story.","example_B1":"He told me the news.","example_B2":"She has told that before."},
      {"verb":"work","past":"worked","participle":"worked","translation":"trabajar","example_A1":"I work from home.","example_B1":"She worked late yesterday.","example_B2":"They have worked together."},
      {"verb":"call","past":"called","participle":"called","translation":"llamar","example_A1":"I call my mom.","example_B1":"He called her last night.","example_B2":"They have called several times."},
      {"verb":"try","past":"tried","participle":"tried","translation":"intentar","example_A1":"I try new things.","example_B1":"She tried to help.","example_B2":"They have tried already."},
      {"verb":"ask","past":"asked","participle":"asked","translation":"preguntar","example_A1":"I ask a question.","example_B1":"He asked for directions.","example_B2":"They have asked permission."},
      {"verb":"need","past":"needed","participle":"needed","translation":"necesitar","example_A1":"I need help.","example_B1":"She needed more time.","example_B2":"They have needed support."},
      {"verb":"feel","past":"felt","participle":"felt","translation":"sentir","example_A1":"I feel good.","example_B1":"He felt sick yesterday.","example_B2":"They have felt better since."},
      {"verb":"become","past":"became","participle":"become","translation":"convertirse","example_A1":"I become taller.","example_B1":"She became a teacher.","example_B2":"They have become friends."},
      {"verb":"leave","past":"left","participle":"left","translation":"dejar/irse","example_A1":"I leave now.","example_B1":"He left the office.","example_B2":"They have left already."},
      {"verb":"put","past":"put","participle":"put","translation":"poner","example_A1":"I put it here.","example_B1":"She put the book down.","example_B2":"They have put effort in."},
      {"verb":"mean","past":"meant","participle":"meant","translation":"significar","example_A1":"I mean that.","example_B1":"He meant well.","example_B2":"They have meant to help."},
      {"verb":"keep","past":"kept","participle":"kept","translation":"mantener","example_A1":"I keep my things.","example_B1":"She kept a secret.","example_B2":"They have kept records."},
      {"verb":"let","past":"let","participle":"let","translation":"permitir","example_A1":"I let him go.","example_B1":"She let the dog out.","example_B2":"They have let us know."}
    ];
  }

  // initialize voices
  ensureVoicesLoaded();

  // Optional: init speech recognition if available
  recognition = initSpeechRecognition();
  if (recognition) {
    log('SpeechRecognition disponible');
    // integrate minimal voice practice: when checkbox enabled, use recognition to capture and compare with base form
    enableSpeechRec.addEventListener('change', ()=>{
      if (!enableSpeechRec.checked){
        recognition.abort();
        return;
      }
      recognition.onresult = (ev) => {
        const transcript = ev.results[0][0].transcript;
        const v = sessionVerbs[state.currentIndex];
        if (!v) return;
        const target = renderVerbForTense(v, state.tense).toLowerCase();
        if (transcript.toLowerCase().includes(v.verb.toLowerCase()) || transcript.toLowerCase().includes(target)){
          alert('Buen trabajo — tu pronunciación fue reconocida: ' + transcript);
        } else {
          alert('No se reconoció claramente. Intentaste decir: ' + transcript);
        }
      };
      recognition.onerror = (e) => { console.warn('recognition error', e); };
      recognition.onend = ()=> {
        // if checkbox still checked, restart
        if (enableSpeechRec.checked) recognition.start();
      };
      recognition.start();
    });
  } else {
    enableSpeechRec.parentElement.style.display = 'none';
  }

  // initial UI
  showSection(setup);

  // load verbs ahead of time (best-effort)
  loadVerbs();

  // expose for debugging
  window.ET = {
    state,
    sessionVerbs,
    loadVerbs,
    saveUserData,
    builtinVerbs
  };

})();
