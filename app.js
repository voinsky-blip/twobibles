/* =====================================================================
 *  Библия с толкованиями — оптимизированное приложение (v3.3)
 *  ===================================================================== */

// ---------- Константы ----------
// Версия данных. МЕНЯЙТЕ при каждом обновлении JSON —
// это гарантированно обходит и HTTP-кэш, и CDN GitHub Pages.
const DATA_VERSION = '2026-09-29';
const DATA_ROOT = 'data';
const FONT_SIZES = ['font-small', 'font-medium', 'font-large', 'font-xlarge'];
const DEFAULT_FONT_INDEX = 1;
const STORAGE_KEYS = {
    theme: 'bible.theme',
    font: 'bible.fontIndex',
    pos: 'bible.lastPosition',
};
const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_MIN_LEN = 3;
const SEARCH_MAX_RESULTS = 60;

const SHOW_COMMENTARY_PLACEHOLDER = true;

// ---------- Настройки свайпа ----------
const SWIPE = {
    MOBILE_MAX_WIDTH: 768,
    MIN_DISTANCE: 60,
    MAX_DURATION: 700,
    MAX_VERTICAL: 70,
    RATIO: 1.4,
    COOLDOWN: 280,
    CLICK_BLOCK_MS: 400,
};

// ---------- Состояние ----------
const state = {
    books: { oldTestament: [], newTestament: [] },
    booksById: new Map(),
    currentBookId: null,
    currentChapter: null,
    selectedVerses: new Set(),
    chapterCache: new Map(),
    searchIndex: null,
    searchIndexLoading: false,
    searchResults: [],
    searchActiveIndex: -1,
};

// ---------- Кэш DOM-узлов ----------
const DOM = {
    content: document.getElementById('content'),
    otBooks: document.getElementById('otBooks'),
    ntBooks: document.getElementById('ntBooks'),
    bookTitle: document.getElementById('bookTitle'),
    chapterTitle: document.getElementById('chapterTitle'),
    chapterSelector: document.getElementById('chapterSelector'),
    versesContainer: document.getElementById('versesContainer'),
    commentaryBox: document.getElementById('commentaryBox'),
    loading: document.getElementById('loading'),
    prevBtn: document.getElementById('prevChapter'),
    nextBtn: document.getElementById('nextChapter'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    themeToggle: document.getElementById('themeToggle'),
    copyBtn: document.getElementById('copySelectedBtn'),
    popup: document.getElementById('versePopup'),
    header: document.querySelector('.header'),
    backToTop: document.getElementById('backToTop'),
};

// ---------- Состояние свайпа ----------
let swipeStartX = 0;
let swipeStartY = 0;
let swipeStartTime = 0;
let swipeActive = false;
let swipeCancelled = false;
let lastSwipeNavTime = 0;
let blockClickUntil = 0;   // блокировка click по стиху сразу после свайпа

// =====================================================================
//  УТИЛИТЫ
// =====================================================================
const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

let popupTimer;
function showPopup(text) {
    DOM.popup.textContent = text;
    DOM.popup.classList.add('show');
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => DOM.popup.classList.remove('show'), 1800);
}

const isMobileViewport = () =>
    window.matchMedia(`(max-width: ${SWIPE.MOBILE_MAX_WIDTH}px)`).matches;

const hasTouch = () =>
    ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// =====================================================================
//  ЗАГРУЗКА ДАННЫХ
// =====================================================================
async function loadBooks() {
    const url = `${DATA_ROOT}/books.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Не удалось загрузить ${url} (HTTP ${r.status})`);
    state.books = await r.json();
    state.booksById.clear();
    for (const b of [...state.books.oldTestament, ...state.books.newTestament]) {
        state.booksById.set(b.id, b);
    }
}

async function loadChapter(bookId, chapter) {
    const key = `${bookId}/${chapter}`;
    if (state.chapterCache.has(key)) return state.chapterCache.get(key);

    const url = `${DATA_ROOT}/${bookId}/${chapter}.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Не найден файл ${url} (HTTP ${r.status})`);

    const data = await r.json();
    if (!data || !Array.isArray(data.verses)) {
        throw new Error(`Файл ${url} не содержит поля "verses"`);
    }

    state.chapterCache.set(key, data);
    if (state.chapterCache.size > 30) {
        const firstKey = state.chapterCache.keys().next().value;
        state.chapterCache.delete(firstKey);
    }
    return data;
}

function preloadAdjacent(bookId, chapter) {
    const book = state.booksById.get(bookId);
    if (!book) return;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    const next = chapter + 1;
    if (next <= book.chapters) {
        idle(() => fetch(`${DATA_ROOT}/${bookId}/${next}.json`).catch(() => { }));
    }
    if (chapter > 1) {
        idle(() => fetch(`${DATA_ROOT}/${bookId}/${chapter - 1}.json`).catch(() => { }));
    }
}

// =====================================================================
//  SIDEBAR
// =====================================================================
function renderSidebar() {
    const frag1 = document.createDocumentFragment();
    const frag2 = document.createDocumentFragment();

    const makeLink = (book) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'book-link';
        btn.dataset.bookId = book.id;
        btn.textContent = book.name;
        return btn;
    };

    for (const b of state.books.oldTestament) frag1.appendChild(makeLink(b));
    for (const b of state.books.newTestament) frag2.appendChild(makeLink(b));

    DOM.otBooks.replaceChildren(frag1);
    DOM.ntBooks.replaceChildren(frag2);
}

document.getElementById('sidebar').addEventListener('click', (e) => {
    const btn = e.target.closest('.book-link');
    if (!btn) return;
    openChapter(btn.dataset.bookId, 1);
    if (isMobileViewport()) {
        DOM.content.scrollIntoView({ behavior: 'smooth' });
    }
});

function updateActiveBookLink() {
    document.querySelectorAll('.book-link.active').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.book-link[data-book-id="${state.currentBookId}"]`);
    if (!el) return;
    el.classList.add('active');
    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.parentElement.getBoundingClientRect();
    if (rect.top < parentRect.top || rect.bottom > parentRect.bottom) {
        el.scrollIntoView({ block: 'nearest' });
    }
}

// =====================================================================
//  СЕЛЕКТОР ГЛАВ
// =====================================================================
function renderChapterSelector() {
    const book = state.booksById.get(state.currentBookId);
    if (!book) return;

    const container = DOM.chapterSelector;
    container.replaceChildren();

    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Выбор главы');
    for (let i = 1; i <= book.chapters; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Глава ${i}`;
        if (i === state.currentChapter) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener('change', () => openChapter(state.currentBookId, +sel.value));
    container.appendChild(sel);

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= book.chapters; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chapter-btn' + (i === state.currentChapter ? ' active' : '');
        btn.dataset.chapter = i;
        btn.textContent = i;
        frag.appendChild(btn);
    }
    container.appendChild(frag);
}

DOM.chapterSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.chapter-btn');
    if (!btn) return;
    const ch = +btn.dataset.chapter;
    if (ch && ch !== state.currentChapter) {
        openChapter(state.currentBookId, ch);
    }
});

// =====================================================================
//  ОТКРЫТИЕ ГЛАВЫ
// =====================================================================
let chapterLoadToken = 0;

async function openChapter(bookId, chapter, { scrollTop = true } = {}) {
    const book = state.booksById.get(bookId);
    if (!book) {
        console.warn('Неизвестная книга:', bookId);
        return;
    }
    chapter = Math.max(1, Math.min(chapter, book.chapters));

    // Токен против «гонок» при быстрых свайпах
    const token = ++chapterLoadToken;

    state.currentBookId = bookId;
    state.currentChapter = chapter;
    state.selectedVerses.clear();
    updateCopyBtn();

    DOM.loading.hidden = false;
    DOM.loading.textContent = 'Загрузка…';

    try {
        const data = await loadChapter(bookId, chapter);

        // Пока грузилось — пользователь уже ушёл дальше; игнорируем
        if (token !== chapterLoadToken) return;

        DOM.bookTitle.hidden = false;
        DOM.chapterTitle.hidden = false;
        DOM.bookTitle.textContent = book.name;
        DOM.chapterTitle.textContent = `Глава ${chapter}`;

        renderChapterSelector();
        renderVerses(data.verses, chapter);
        renderCommentary(data.commentary, book, chapter);

        updateActiveBookLink();
        updateNavButtons();
        savePosition(bookId, chapter);

        // ВАЖНО: скрываем «Загрузку» ДО расчёта позиции скролла,
        // иначе её высота сдвигает bookTitle вниз, и после скрытия
        // название книги уходит под шапку (или за верх экрана).
        DOM.loading.hidden = true;

        if (scrollTop) scrollToChapterStart();

        preloadAdjacent(bookId, chapter);
    } catch (e) {
        if (token !== chapterLoadToken) return;
        console.error('openChapter error:', e);
        DOM.loading.hidden = false;
        DOM.loading.textContent = `Ошибка: ${e.message}`;
        DOM.versesContainer.replaceChildren();
        DOM.commentaryBox.hidden = true;
    }
}

/**
 * Прокрутка так, чтобы название книги оказалось сразу под липкой
 * шапкой. На десктопе скроллится .content (у него свой overflow),
 * на мобильных — окно целиком.
 */
function scrollToChapterStart() {
    // Сбрасываем внутренний скролл контейнера (актуально для десктопа).
    DOM.content.scrollTop = 0;

    if (!isMobileViewport()) {
        // На десктопе страница не скроллится — достаточно сбросить .content.
        // window.scrollTo нужен на случай, если браузер что-то помнит.
        window.scrollTo(0, 0);
        return;
    }

    // Мобильный режим: страница скроллится окном.
    // Абсолютная позиция bookTitle в документе = rect.top + scrollY.
    const headerH = DOM.header ? DOM.header.offsetHeight : 0;
    const titleTop = DOM.bookTitle.getBoundingClientRect().top + window.scrollY;
    const targetY = Math.max(0, titleTop - headerH - 8); // 8px — небольшой отступ

    window.scrollTo(0, targetY);
}

// =====================================================================
//  РЕНДЕР ТОЛКОВАНИЙ
// =====================================================================
function renderCommentary(commentary, bookMeta, chapter) {
    let html = '';

    if (commentary && typeof commentary === 'object' && !Array.isArray(commentary)) {
        if (commentary.title) {
            html += `<h2>${commentary.title}</h2>`;
        }
        if (Array.isArray(commentary.text)) {
            for (const block of commentary.text) {
                const trimmed = String(block ?? '').trim();
                if (!trimmed) continue;

                if (/^\s*<(ul|ol|h[1-6]|p|blockquote|div|table|pre)\b/i.test(trimmed)) {
                    html += trimmed;
                } else {
                    html += `<p>${trimmed}</p>`;
                }
            }
        }
        if (commentary.keyPoint) {
            html += `<div class="key-point">${commentary.keyPoint}</div>`;
        }
    }
    else if (typeof commentary === 'string' && commentary.trim()) {
        html = commentary;
    }
    else if (Array.isArray(commentary) && commentary.length) {
        html = `<h2>Толкование</h2>` +
            commentary.map(p => `<p>${p}</p>`).join('');
    }

    if (!html && SHOW_COMMENTARY_PLACEHOLDER && bookMeta && chapter) {
        html = `<h2>Толкование на ${bookMeta.name}, глава ${chapter}</h2>`;
        html += `<p class="commentary-empty">Толкование на эту главу пока не добавлено.</p>`;
    }

    if (html) {
        DOM.commentaryBox.hidden = false;
        DOM.commentaryBox.innerHTML = html;
    } else {
        DOM.commentaryBox.hidden = true;
        DOM.commentaryBox.textContent = '';
    }
}

// =====================================================================
//  РЕНДЕР СТИХОВ
// =====================================================================
function renderVerses(verses, chapter) {
    const frag = document.createDocumentFragment();

    for (const v of verses) {
        const num = v[0];
        const text = v[1];

        const div = document.createElement('div');
        div.className = 'verse';
        div.dataset.verse = num;
        div.dataset.chapter = chapter;

        if (typeof num === 'number') {
            const numSpan = document.createElement('span');
            numSpan.className = 'verse-number';
            numSpan.textContent = num;
            div.appendChild(numSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'verse-text';
        textSpan.dataset.verse = num;
        textSpan.innerHTML = text;

        div.appendChild(textSpan);
        frag.appendChild(div);
    }

    DOM.versesContainer.replaceChildren(frag);
}

// =====================================================================
//  ВЫБОР СТИХОВ
// =====================================================================
DOM.versesContainer.addEventListener('click', (e) => {
    // Свайп только что закончился — гасим случайный клик
    if (Date.now() < blockClickUntil) {
        e.stopPropagation();
        return;
    }

    const textSpan = e.target.closest('.verse-text');
    if (!textSpan) return;
    const verseEl = textSpan.closest('.verse');
    const verseNum = verseEl.dataset.verse;
    if (!/^\d+$/.test(verseNum)) return;

    const id = `${state.currentBookId}-${state.currentChapter}-${verseNum}`;
    if (state.selectedVerses.has(id)) {
        state.selectedVerses.delete(id);
        textSpan.classList.remove('selected');
    } else {
        state.selectedVerses.add(id);
        textSpan.classList.add('selected');
    }
    updateCopyBtn();
});

function updateCopyBtn() {
    DOM.copyBtn.hidden = state.selectedVerses.size === 0;
}

DOM.copyBtn.addEventListener('click', async () => {
    if (!state.selectedVerses.size) return;
    const book = state.booksById.get(state.currentBookId);
    if (!book) return;

    const nums = [...state.selectedVerses]
        .map(id => {
            const parts = id.split('-');
            return +parts[parts.length - 1];
        })
        .sort((a, b) => a - b);

    const lines = [];
    for (const n of nums) {
        const el = DOM.versesContainer.querySelector(`.verse[data-verse="${n}"] .verse-text`);
        if (el) lines.push(`${n}. ${el.textContent.trim()}`);
    }
    const header = `${book.name}, глава ${state.currentChapter}\n\n`;
    const text = header + lines.join('\n');

    try {
        await navigator.clipboard.writeText(text);
        showPopup('Скопировано');
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showPopup('Скопировано'); }
        catch { showPopup('Не удалось скопировать'); }
        ta.remove();
    }
});

// =====================================================================
//  НАВИГАЦИЯ
// =====================================================================
function getAllBooks() {
    return [...state.books.oldTestament, ...state.books.newTestament];
}

function updateNavButtons() {
    const book = state.booksById.get(state.currentBookId);
    if (!book) return;
    const allBooks = getAllBooks();
    const isFirst = book.id === allBooks[0]?.id && state.currentChapter <= 1;
    const isLast = book.id === allBooks[allBooks.length - 1]?.id && state.currentChapter >= book.chapters;
    DOM.prevBtn.disabled = isFirst;
    DOM.nextBtn.disabled = isLast;
}

DOM.prevBtn.addEventListener('click', () => navigateChapter(-1));
DOM.nextBtn.addEventListener('click', () => navigateChapter(1));

/**
 * Переход на delta глав вперёд/назад.
 * На границе книги автоматически переходит на соседнюю книгу.
 */
function navigateChapter(delta) {
    const book = state.booksById.get(state.currentBookId);
    if (!book) return;
    const target = state.currentChapter + delta;
    const all = getAllBooks();

    if (target < 1) {
        const idx = all.findIndex(b => b.id === book.id);
        if (idx > 0) {
            const prev = all[idx - 1];
            openChapter(prev.id, prev.chapters);
        }
    } else if (target > book.chapters) {
        const idx = all.findIndex(b => b.id === book.id);
        if (idx < all.length - 1) {
            const next = all[idx + 1];
            openChapter(next.id, 1);
        }
    } else {
        openChapter(state.currentBookId, target);
    }
}

// =====================================================================
//  СВАЙП-НАВИГАЦИЯ (мобильные)
// =====================================================================
function isSwipeEnabled() {
    return isMobileViewport() && hasTouch();
}

DOM.content.addEventListener('touchstart', (e) => {
    if (!isSwipeEnabled()) return;
    if (e.touches.length !== 1) {
        swipeActive = false;
        swipeCancelled = true;
        return;
    }
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeStartTime = Date.now();
    swipeActive = true;
    swipeCancelled = false;
}, { passive: true });

DOM.content.addEventListener('touchmove', (e) => {
    if (!swipeActive || swipeCancelled) return;
    const t = e.touches[0];
    const dy = Math.abs(t.clientY - swipeStartY);
    if (dy > SWIPE.MAX_VERTICAL) {
        swipeCancelled = true;
    }
}, { passive: true });

DOM.content.addEventListener('touchend', (e) => {
    if (!swipeActive) return;
    swipeActive = false;

    if (swipeCancelled) {
        swipeCancelled = false;
        return;
    }
    if (e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    const dt = Date.now() - swipeStartTime;

    if (dt > SWIPE.MAX_DURATION) return;
    if (Math.abs(dx) < SWIPE.MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE.RATIO) return;

    const now = Date.now();
    if (now - lastSwipeNavTime < SWIPE.COOLDOWN) return;
    lastSwipeNavTime = now;

    blockClickUntil = now + SWIPE.CLICK_BLOCK_MS;

    if (dx < 0) {
        // свайп влево → следующая глава (или 1-я глава следующей книги)
        navigateChapter(1);
    } else {
        // свайп вправо → предыдущая глава (или последняя глава предыдущей книги)
        navigateChapter(-1);
    }
}, { passive: true });

DOM.content.addEventListener('touchcancel', () => {
    swipeActive = false;
    swipeCancelled = true;
}, { passive: true });

// =====================================================================
//  ПОИСК
// =====================================================================
const handleSearchDebounced = debounce(runSearch, SEARCH_DEBOUNCE_MS);

DOM.searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (q.length < SEARCH_MIN_LEN) {
        DOM.searchResults.classList.remove('show');
        DOM.searchResults.replaceChildren();
        return;
    }
    handleSearchDebounced(q);
});

DOM.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        DOM.searchResults.classList.remove('show');
        DOM.searchInput.blur();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveSearchSelection(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
        const item = DOM.searchResults.querySelector('.search-result-item.active');
        if (item) item.click();
    }
});

document.addEventListener('click', (e) => {
    if (!DOM.searchResults.contains(e.target) && e.target !== DOM.searchInput) {
        DOM.searchResults.classList.remove('show');
    }
});

async function ensureSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    if (state.searchIndexLoading) {
        while (state.searchIndexLoading) {
            await new Promise(r => setTimeout(r, 50));
        }
        return state.searchIndex || [];
    }
    state.searchIndexLoading = true;
    try {
        const r = await fetch(`${DATA_ROOT}/search-index.json`);
        if (r.ok) {
            state.searchIndex = await r.json();
        } else {
            console.warn('search-index.json не найден, поиск будет недоступен');
            state.searchIndex = [];
        }
    } catch {
        state.searchIndex = [];
    } finally {
        state.searchIndexLoading = false;
    }
    return state.searchIndex;
}

async function runSearch(query) {
    const q = query.toLowerCase();

    if (!state.searchIndex && !state.searchIndexLoading) {
        DOM.searchResults.innerHTML = '<div class="search-no-results">Загрузка индекса…</div>';
        DOM.searchResults.classList.add('show');
    }

    const index = await ensureSearchIndex();
    const results = [];

    for (const item of index) {
        if (item.lower.includes(q)) {
            results.push(item);
            if (results.length >= SEARCH_MAX_RESULTS) break;
        }
    }

    state.searchResults = results;
    state.searchActiveIndex = -1;
    renderSearchResults(q, results);
}

function renderSearchResults(query, results) {
    if (!results.length) {
        DOM.searchResults.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
        DOM.searchResults.classList.add('show');
        return;
    }

    const frag = document.createDocumentFragment();
    for (const r of results) {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.dataset.bookId = r.bookId;
        div.dataset.chapter = r.ch;
        div.dataset.verse = r.v;

        const refEl = document.createElement('div');
        refEl.className = 'result-ref';
        refEl.textContent = r.ref;

        const textEl = document.createElement('div');
        textEl.className = 'result-text';
        textEl.textContent = highlightSnippet(r.text, query);

        div.appendChild(refEl);
        div.appendChild(textEl);
        frag.appendChild(div);
    }

    DOM.searchResults.replaceChildren(frag);
    DOM.searchResults.classList.add('show');
}

function highlightSnippet(text, q) {
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text.slice(0, 90) + (text.length > 90 ? '…' : '');
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + q.length + 50);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function moveSearchSelection(delta) {
    const items = DOM.searchResults.querySelectorAll('.search-result-item');
    if (!items.length) return;
    let idx = state.searchActiveIndex;
    idx = (idx + delta + items.length) % items.length;
    state.searchActiveIndex = idx;
    items.forEach((el, i) => el.classList.toggle('active', i === idx));
    items[idx].scrollIntoView({ block: 'nearest' });
}

DOM.searchResults.addEventListener('click', async (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    const { bookId, chapter, verse } = item.dataset;
    DOM.searchResults.classList.remove('show');
    DOM.searchInput.value = '';
    await openChapter(bookId, +chapter);
    requestAnimationFrame(() => {
        const verseEl = DOM.versesContainer.querySelector(`.verse[data-verse="${verse}"]`);
        if (verseEl) {
            verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const textEl = verseEl.querySelector('.verse-text');
            if (textEl) {
                textEl.classList.add('search-highlight');
                setTimeout(() => textEl.classList.remove('search-highlight'), 3000);
            }
        }
    });
});

// =====================================================================
//  ТЕМА И РАЗМЕР ШРИФТА
// =====================================================================
function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    DOM.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌓';
}

DOM.themeToggle.addEventListener('click', () => {
    const next = document.body.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEYS.theme, next); } catch { }
    applyTheme(next);
});

function applyFont(index) {
    index = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    document.body.classList.remove(...FONT_SIZES);
    document.body.classList.add(FONT_SIZES[index]);
    try { localStorage.setItem(STORAGE_KEYS.font, index); } catch { }
}

document.querySelectorAll('[data-font-delta]').forEach(btn => {
    btn.addEventListener('click', () => {
        const cur = +(localStorage.getItem(STORAGE_KEYS.font) ?? DEFAULT_FONT_INDEX) || DEFAULT_FONT_INDEX;
        applyFont(cur + (+btn.dataset.fontDelta));
    });
});

// =====================================================================
//  СОХРАНЕНИЕ ПОЗИЦИИ (книга + глава + якорь чтения)
// =====================================================================
function savePosition(bookId, chapter, anchor = null) {
    try {
        localStorage.setItem(
            STORAGE_KEYS.pos,
            JSON.stringify({ bookId, chapter, anchor, ts: Date.now() })
        );
    } catch { }
}
function loadPosition() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.pos) || 'null');
    } catch { return null; }
}

// =====================================================================
//  ЯКОРЬ ЧТЕНИЯ: какой стих/блок сейчас наверху экрана
// =====================================================================

/**
 * Возвращает {type:'verse', verse} первого видимого стиха,
 * либо {type:'commentary'}, если все стихи уже выше экрана,
 * либо null, если и комментарий не виден.
 */
function getReadingAnchor() {
    if (!state.currentBookId || !state.currentChapter) return null;

    // Верхняя граница «зоны чтения» в координатах вьюпорта:
    // на мобильных это низ липкой шапки, на десктопе — верх .content.
    const refTop = isMobileViewport()
        ? ((DOM.header?.offsetHeight || 0) + 4)
        : (DOM.content.getBoundingClientRect().top + 4);

    const verses = DOM.versesContainer.children; // .verse
    for (const v of verses) {
        if (v.getBoundingClientRect().bottom > refTop) {
            return { type: 'verse', verse: v.dataset.verse };
        }
    }

    if (!DOM.commentaryBox.hidden) {
        if (DOM.commentaryBox.getBoundingClientRect().bottom > refTop) {
            return { type: 'commentary' };
        }
    }
    return null;
}

/** Прокручивает так, чтобы якорь оказался сверху зоны чтения. */
function scrollToAnchor(anchor) {
    if (!anchor) return false;

    let el = null;
    if (anchor.type === 'verse') {
        el = DOM.versesContainer.querySelector(`.verse[data-verse="${anchor.verse}"]`);
    } else if (anchor.type === 'commentary') {
        el = DOM.commentaryBox.hidden ? null : DOM.commentaryBox;
    }
    if (!el) return false;

    if (isMobileViewport()) {
        const headerH = DOM.header?.offsetHeight || 0;
        const top = el.getBoundingClientRect().top + window.scrollY - headerH - 8;
        window.scrollTo(0, Math.max(0, top));
    } else {
        const contentTop = DOM.content.getBoundingClientRect().top;
        const offset = el.getBoundingClientRect().top - contentTop + DOM.content.scrollTop;
        DOM.content.scrollTop = Math.max(0, offset - 8);
    }
    return true;
}

// Дебаунс-сохранение при скролле
const saveAnchorDebounced = debounce(() => {
    if (!state.currentBookId || !state.currentChapter) return;
    savePosition(state.currentBookId, state.currentChapter, getReadingAnchor());
}, 400);

// Немедленное сохранение (при уходе со страницы)
function saveAnchorNow() {
    if (!state.currentBookId || !state.currentChapter) return;
    savePosition(state.currentBookId, state.currentChapter, getReadingAnchor());
}

// =====================================================================
//  КНОПКА «В НАЧАЛО»
// =====================================================================
const BACK_TO_TOP_THRESHOLD = 400;

const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function currentScrollTop() {
    // На десктопе скроллится .content, на мобильных — само окно.
    // Берём максимум из двух, чтобы корректно работать в обоих режимах.
    return Math.max(window.scrollY || 0, DOM.content.scrollTop || 0);
}

function updateBackToTop() {
    if (!DOM.backToTop) return;
    DOM.backToTop.classList.toggle('show', currentScrollTop() > BACK_TO_TOP_THRESHOLD);
}

// Скролл-события. Оборачиваем в rAF, чтобы не дёргать layout на каждый пиксель.
let backToTopRaf = 0;
function onAnyScroll() {
    if (backToTopRaf) return;
    backToTopRaf = requestAnimationFrame(() => {
        backToTopRaf = 0;
        updateBackToTop();
    });
}

window.addEventListener('scroll', onAnyScroll, { passive: true });
DOM.content.addEventListener('scroll', onAnyScroll, { passive: true });
window.addEventListener('resize', updateBackToTop);

// Сохранение позиции чтения при скролле и при уходе со страницы
window.addEventListener('scroll', saveAnchorDebounced, { passive: true });
DOM.content.addEventListener('scroll', saveAnchorDebounced, { passive: true });

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAnchorNow();
});
window.addEventListener('pagehide', saveAnchorNow);

if (DOM.backToTop) {
    DOM.backToTop.addEventListener('click', () => {
        const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
        if (isMobileViewport()) {
            window.scrollTo({ top: 0, behavior });
        } else {
            DOM.content.scrollTo({ top: 0, behavior });
        }
        // На всякий случай синхронизируем оба «слоя»
        if (behavior === 'auto') {
            window.scrollTo(0, 0);
            DOM.content.scrollTop = 0;
        }
    });
}

// =====================================================================
//  ИНИЦИАЛИЗАЦИЯ
// =====================================================================
async function init() {
    // Отключаем встроенное восстановление скролла браузера,
    // чтобы не конфликтовало с нашим.
    if ('scrollRestoration' in history) {
        try { history.scrollRestoration = 'manual'; } catch { }
    }

    applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'light');
    applyFont(+(localStorage.getItem(STORAGE_KEYS.font) ?? DEFAULT_FONT_INDEX));

    try {
        await loadBooks();
        console.log('✅ books.json загружен, книг:',
            state.books.oldTestament.length + state.books.newTestament.length);
    } catch (e) {
        console.error('init loadBooks error:', e);
        DOM.loading.hidden = false;
        DOM.loading.textContent = `Ошибка: ${e.message}`;
        return;
    }

    renderSidebar();
    updateBackToTop();

    const pos = loadPosition();
    const first = state.books.oldTestament[0];
    if (!first) {
        DOM.loading.textContent = 'Нет данных о книгах';
        return;
    }

    const startBookId = pos?.bookId || first.id;
    const startChapter = pos?.chapter || 1;
    const startAnchor = pos?.anchor || null;

    // Если есть якорь — не прыгаем наверх, восстановим сами.
    await openChapter(startBookId, startChapter, { scrollTop: !startAnchor });

    if (startAnchor) {
        // Двойной rAF: даём браузеру разложить контент после рендера.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (scrollToAnchor(startAnchor)) {
                // openChapter() перезаписал anchor=null — вернём значение.
                savePosition(state.currentBookId, state.currentChapter, startAnchor);
            }
        }));
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').then(reg => {
                // Проверяем обновления SW при каждой загрузке страницы
                reg.update();
            }).catch(err => {
                console.warn('SW registration failed:', err);
            });
        });
    }
}

init();