/* eslint-disable */
/**
 * extract.js — извлекает данные из старого сайта (old_index.html)
 * и строит оптимизированную структуру data/ для нового приложения.
 *
 * Использование:
 *   node extract.js old_index.html
 *
 * Что на выходе:
 *   data/books.json                — список книг
 *   data/{bookId}/{chapter}.json   — стихи + толкование (единая структура)
 *   data/search-index.json         — плоский индекс для поиска
 *
 * ВАЖНО: для КАЖДОЙ главы в JSON записывается поле `commentary`
 * в едином формате { title, text[], keyPoint }. Если для главы нет
 * настоящего толкования — записывается placeholder с тем же форматом.
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || 'old_index.html';
const OUT_DIR = 'data';

// Если true — для глав без реального толкования пишем placeholder.
// Если false — поле commentary не пишется, app.js сам покажет заглушку.
const WRITE_PLACEHOLDER_COMMENTARY = true;

if (!fs.existsSync(inputFile)) {
    console.error('Не найден файл:', inputFile);
    process.exit(1);
}

const html = fs.readFileSync(inputFile, 'utf8');

// ---------------------------------------------------------------------
// 1. Извлекаем любой `const NAME = { ... }` или `const NAME = [ ... ]`
//    с учётом строк, шаблонов и экранирования.
// ---------------------------------------------------------------------
function extractObject(name) {
    // \b в конце — чтобы `commentaries` не матчился как `commentariesData`
    const startRe = new RegExp(`const\\s+${name}\\b\\s*=\\s*`);
    const m = startRe.exec(html);
    if (!m) throw new Error(`Не найден ${name}`);

    let i = m.index + m[0].length;
    while (i < html.length && /\s/.test(html[i])) i++;

    const open = html[i];
    const close = open === '{' ? '}' : (open === '[' ? ']' : null);
    if (!close) throw new Error(`Не найден открывающий символ для ${name}`);

    let depth = 0;
    let inStr = null;
    let escape = false;
    const start = i;

    for (; i < html.length; i++) {
        const c = html[i];

        if (inStr) {
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === inStr) { inStr = null; }
            continue;
        }

        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }

        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
            depth--;
            if (depth === 0) return html.slice(start, i + 1);
        }
    }

    throw new Error(`Не удалось найти конец ${name}`);
}

function parseJSObject(src) {
    // Безопасно: выполняется в изолированной функции
    return (new Function(`return (${src});`))();
}

// ---------------------------------------------------------------------
// 2. Нормализация толкования к единой структуре
//    { title: string|null, text: string[], keyPoint: string|null }
// ---------------------------------------------------------------------
function normalizeCommentary(c) {
    if (!c) return null;
    return {
        title: typeof c.title === 'string' ? c.title : null,
        text: Array.isArray(c.text) ? c.text.filter(x => typeof x === 'string') : [],
        keyPoint: typeof c.keyPoint === 'string' ? c.keyPoint : null,
    };
}

// ---------------------------------------------------------------------
// 3. Placeholder для глав без реального толкования — в ТОЙ ЖЕ структуре
// ---------------------------------------------------------------------
function buildPlaceholderCommentary(bookMeta, chapterNum) {
    const bookName = bookMeta?.name || bookMeta?.id || 'Книга';
    return {
        title: `Толкование на ${bookName}, глава ${chapterNum}`,
        text: [
            'Толкование на эту главу пока не добавлено.',
        ],
        keyPoint: null,
    };
}

// ---------------------------------------------------------------------
// 4. Извлекаем данные
// ---------------------------------------------------------------------
console.log('Извлекаю bibleBooks…');
const bibleBooks = parseJSObject(extractObject('bibleBooks'));

console.log('Извлекаю chaptersData (может занять несколько секунд)…');
const chaptersData = parseJSObject(extractObject('chaptersData'));

console.log('Извлекаю commentaries…');
let rawCommentaries = {};
try {
    rawCommentaries = parseJSObject(extractObject('commentaries'));
    const cnt = Object.keys(rawCommentaries).length;
    console.log(`  найдено реальных толкований: ${cnt}`);
} catch (e) {
    console.warn('  ⚠ комментарии не найдены:', e.message);
    rawCommentaries = {};
}

// ---------------------------------------------------------------------
// 5. Готовим папку data/
// ---------------------------------------------------------------------
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// books.json
fs.writeFileSync(
    path.join(OUT_DIR, 'books.json'),
    JSON.stringify(bibleBooks, null, 0)
);
console.log('✓ books.json');

// ---------------------------------------------------------------------
// 6. Проходимся по всем книгам и главам
// ---------------------------------------------------------------------
const searchIndex = [];
const allBooks = [...bibleBooks.oldTestament, ...bibleBooks.newTestament];
const bookById = new Map(allBooks.map(b => [b.id, b]));

let totalChapters = 0;
let totalVerses = 0;
let realCommentaries = 0;
let placeholderCommentaries = 0;

for (const [bookId, chapters] of Object.entries(chaptersData)) {
    const bookDir = path.join(OUT_DIR, bookId);
    fs.mkdirSync(bookDir, { recursive: true });

    const bookMeta = bookById.get(bookId);
    const shortName = bookMeta?.shortName || bookMeta?.name || bookId;

    for (const [chapterNum, verses] of Object.entries(chapters)) {
        const commentaryKey = `${bookId}.${chapterNum}`;

        // Ищем реальное толкование
        let commentary = normalizeCommentary(rawCommentaries[commentaryKey]);

        if (commentary) {
            realCommentaries++;
        } else if (WRITE_PLACEHOLDER_COMMENTARY) {
            commentary = buildPlaceholderCommentary(bookMeta, chapterNum);
            placeholderCommentaries++;
        }

        const chapData = { verses };
        if (commentary) {
            chapData.commentary = commentary;
        }

        fs.writeFileSync(
            path.join(bookDir, `${chapterNum}.json`),
            JSON.stringify(chapData)
        );
        totalChapters++;

        // Индекс поиска
        for (const v of verses) {
            const num = v[0];
            const text = v[1];
            if (typeof num !== 'number' || typeof text !== 'string') continue;

            const plain = text.replace(/<[^>]+>/g, '');
            searchIndex.push({
                ref: `${shortName} ${chapterNum}:${num}`,
                bookId,
                ch: +chapterNum,
                v: num,
                text: plain,
                lower: plain.toLowerCase(),
            });
            totalVerses++;
        }
    }
}

console.log(`✓ ${totalChapters} глав, ${totalVerses} стихов`);
console.log(`  — реальных толкований: ${realCommentaries}`);
if (WRITE_PLACEHOLDER_COMMENTARY) {
    console.log(`  — placeholder-толкований: ${placeholderCommentaries}`);
}

// ---------------------------------------------------------------------
// 7. search-index.json
// ---------------------------------------------------------------------
fs.writeFileSync(
    path.join(OUT_DIR, 'search-index.json'),
    JSON.stringify(searchIndex)
);
const sizeMB = (fs.statSync(path.join(OUT_DIR, 'search-index.json')).size / 1024 / 1024).toFixed(2);
console.log(`✓ search-index.json (${sizeMB} МБ)`);

console.log('\nГотово! Папка data/ создана.');