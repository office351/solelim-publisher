const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const fs = require('fs');
const sharp = require('sharp');

const app = express();

// אוסף המשתמשים: admin + solelim (עריכה בלבד)
const USERS = {
  [process.env.APP_USER || 'admin']: process.env.APP_PASSWORD || 'changeme',
  'solelim': 'solelim',
  'english': 'english'
};

app.use(basicAuth({
  users: USERS,
  challenge: true,
  realm: 'solelim-publisher'
}));

// middleware שמגביל לadmin בלבד
function requireAdmin(req, res, next) {
  const adminUser = process.env.APP_USER || 'admin';
  if (req.auth && req.auth.user === adminUser) return next();
  res.status(403).json({ error: 'אין הרשאה' });
}

// middleware שמאפשר גם למשתמש english
function requireAdminOrEnglish(req, res, next) {
  const adminUser = process.env.APP_USER || 'admin';
  if (req.auth && (req.auth.user === adminUser || req.auth.user === 'english')) return next();
  res.status(403).json({ error: 'אין הרשאה' });
}

const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

// מי אני — מחזיר את שם המשתמש הנוכחי
app.get('/api/me', (req, res) => {
  res.json({ username: req.auth ? req.auth.user : null });
});

// ─── הגהה לשונית ────────────────────────────────────────────────────────────
const PROOFREADING_SYSTEM = `אתה מגיה לשון עברית מקצועי. בצע תיקונים לשוניים ותחביריים בלבד — ללא שינוי סגנון, ניסוח, רעיונות או ליטוש ספרותי.

כללי תיקון:
- התאמת זכר/נקבה בין נושא לפועל, תואר ושם עצם (כולל הפניות עקיפות)
- התאמת יחיד/רבים
- כתיב תקני: זהותנו (לא זהותינו), ודאי (לא וודאי), לזהותנו ולאחדותנו (לא ולאחדותנו), דוגמה (לא דוגמא)
- כתיב מלא/חסר לפי הכתיב התקני
- הוספת "האם" בשאלות שאינן נפתחות במילת שאלה
- גרש ומושגים — כלל מחייב: גרש יחיד (׳) סביב מושגים ומונחים; גרשיים (״) לציטוט ישיר של דברי אנשים בלבד. דוגמה נכונה: הוא דיבר על 'זהות' ו'שייכות'. דוגמה שגויה: הוא דיבר על "זהות" ו"שייכות" (גרשיים — רק לציטוט ישיר).
- ה"א הידיעה לפני גרש — כלל מחייב: כאשר מונח עם ה"א הידיעה מופיע בגרש, ה"א הידיעה נשארת מחוץ לגרש. 'הדמוקרטיה' → ה'דמוקרטיה'. 'הדמוקרטיות' → ה'דמוקרטיות'. 'הימין' → ה'ימין'. 'השמאל' → ה'שמאל'. כלל: ה+׳מושג׳ ולא ׳המושג׳.
- מילת יחס לפני גרש — כלל מחייב: כאשר מילית יחס (ב, ל, כ, מ) קודמת למונח בגרש, ה"א הידיעה נבלעת במילית היחס ואינה נכתבת בנפרד. דוגמאות: ל'ברית' ולא לה'ברית'; ב'שמאל' ולא בה'שמאל'; מ'ימין' ולא מה'ימין'; כ'מדינה' ולא כה'מדינה'. בדוק כל צירוף של מילית יחס + גרש בטקסט ותקן בהתאם.
- גרשיים סביב מונחים מוגדרים בהקשר מושגי: המושג מגדר → המושג 'מגדר'
- החלפת "ש" כתחלית יחסית ב-"ה" כאשר הדבר אפשרי דקדוקית ומשפר את הסגנון: "שגוזרים קופון" → "הגוזרים קופון", "שמבקש לפרק את המוסדות" → "המבקש לפרק את המוסדות". כלל עזר: אם אפשר להחליף את ש+פועל ב-ה+פועל מבלי לשבור את המשפט — עדיף לעשות זאת.
- כינוי גוף חסר (copula) — כאשר בין נושא לנשוא חסר כינוי גוף מקשר, הוסף אותו. דוגמה: "ששיטת המשטרה שלה דמוקרטית" → "ששיטת המשטרה היא דמוקרטית"; "הצבא כלי" → "הצבא הוא כלי"; "החברים אנשי מקצוע" → "החברים הם אנשי מקצוע". בדוק כל משפט שבו נושא ונשוא רצופים ללא פועל ביניהם.
- כתיב מדויק של כל מילה — זהה ותקן שגיאות כתיב גם אם הן קרובות לצליל הנכון. דוגמאות שכיחות: מסגרות (לא מיסגרות), בדיקה (לא בידיקה), תכנית (לא תוכנית כשמדובר בתכנית פעולה), נכון (לא ניכון).
- אין לתקן לשון מקרא
- אין לשנות פעלים בבנייני פועל, הופעל ונפעל — גם אם נראים לא-שגרתיים. לדוגמה: יצוין, צוין, יצוינו, יכובד, יוזכר, הוזכר, נאמר — צורות תקינות לחלוטין. אסור לשנות יצוין לכל צורה אחרת

טיפול בשורה הראשונה:
- אם השורה הראשונה מכילה "/" — מה שלפני ה-/ הוא הכותרת, מה שאחריו הוא שם הכותב/טלפון. הגה את הכותרת בלבד, השאר את שם הכותב כפי שהוא ואת ה-/ במקומו.

טיפול בשורה האחרונה:
- אם השורה האחרונה (או אחת השורות האחרונות) מכילה רק את המילים "סוללים דרך" — עם או בלי נקודה, גרש, כוכבית או סמלים אחרים — מחק שורה זו לחלוטין. חתימה זו תתווסף באופן אוטומטי לאחר מכן.

חובה לשמור:
- מבנה שורות ורווחים זהה למקור לחלוטין (למעט השורה שנמחקה כנ"ל)
- כוכביות (*) במקומן המדויק — אין להזיז, למחוק או להוסיף
- קישורים (URLs) — כל כתובת אינטרנט (https://..., http://..., www...) חייבת להישמר בדיוק כפי שהיא, ללא שינוי, קיצור או מחיקה
- סגנון הכותב

סיום — מעבר אימות סופי:
לאחר ביצוע כל התיקונים, עבור על הטקסט כולו פעם נוספת ובדוק:
א. כתיב כל מילה — האם כתובה נכון?
ב. כל גרש וגרשיים — האם בשימוש הנכון? האם מילית יחס (ב/ל/כ/מ) אינה מופיעה לפני ה"א הידיעה עם גרש?
ג. שלמות תחבירית של כל משפט — האם חסר כינוי גוף? האם יש התאמה בין נושא לפועל?
ד. אם נמצא תיקון נוסף — בצע אותו.

החזר את הטקסט המתוקן בלבד, ללא הסברים.`;

// ─── נרמול רווחים במאמרים ממוספרים ──────────────────────────────────────────
// רק אם יש לפחות 2 שורות שמתחילות באות עברית / ספרה כסמן פסקה —
// מוחק שורה ריקה שבאה מיד אחרי הסמן, וקורס שורות ריקות כפולות לאחת.
// אם אין מבנה כזה — מחזיר את השורות ללא שינוי.
function normalizeStructuredSpacing(lines) {
  // סמן פסקה: שורה שמתחילה ב-א-ת, *, -, 1-99 (ואחריהם . ) : רווח)
  const markerRe = /^[אבגדהוזחטיכלמנסעפצקרשת][.):\s*]|^\*?[אבגדהוזחטיכלמנסעפצקרשת][.):\s]|^\d{1,2}[.):\s]|^[0-9]\uFE0F?\u20E3/;
  const markerCount = lines.filter(l => markerRe.test(l.trim())).length;

  if (markerCount < 2) return lines; // מאמר לא-ממוספר — אל תיגע ברווחים

  const result = [];
  let prevBlank   = false;
  let prevMarker  = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlank  = trimmed === '';
    const isMarker = markerRe.test(trimmed);

    if (isBlank) {
      if (prevMarker) continue;   // אין שורה ריקה בין כותרת פסקה לתוכנה
      if (prevBlank)  continue;   // אין שורות ריקות כפולות
      result.push('');
      prevBlank  = true;
      prevMarker = false;
    } else {
      result.push(line);
      prevBlank  = false;
      prevMarker = isMarker;
    }
  }

  // הסרת שורה ריקה בסוף אם נוצרה
  while (result.length && result[result.length - 1].trim() === '') result.pop();

  return result;
}

// ─── מאגר משימות הגהה ברקע ───────────────────────────────────────────────────
const editJobs = new Map();
// ניקוי משימות ישנות כל 10 דקות
setInterval(() => {
  const tenMin = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of editJobs) {
    if (job.createdAt < tenMin) editJobs.delete(id);
  }
}, 10 * 60 * 1000);

// שלב 1: הגהה לשונית – מתחיל ברקע ומחזיר jobId מיד
app.post('/edit-stage1', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  editJobs.set(jobId, { status: 'pending', createdAt: Date.now(), progress: '' });
  res.json({ success: true, jobId }); // חוזר מיד ללקוח

  // עבודה ברקע – ללא מגבלת זמן HTTP
  (async () => {
    try {
      // פיצול לחלקים לפי פסקאות — כל חלק עד 2500 תווים
      const CHUNK_SIZE = 2500;
      const lines = text.split('\n');
      const chunks = [];
      let current = [];
      let currentLen = 0;

      for (const line of lines) {
        const lineLen = line.length + 1;
        // אם הוספת השורה תחרוג מהגבול וכבר יש תוכן — שמור חלק וצור חדש
        if (currentLen + lineLen > CHUNK_SIZE && current.length > 0) {
          chunks.push(current.join('\n'));
          current = [];
          currentLen = 0;
        }
        current.push(line);
        currentLen += lineLen;
      }
      if (current.length > 0) chunks.push(current.join('\n'));

      // פונקציית עזר: timeout אמיתי עם Promise.race
      const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms/1000}s`)), ms))
      ]);

      // הגהה לכל חלק בנפרד (סדרתי כדי לא לעמוס)
      const proofedChunks = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        editJobs.set(jobId, { ...editJobs.get(jobId), progress: `מגיה חלק ${ci + 1} מתוך ${chunks.length}…` });
        const maxTok = Math.min(Math.ceil(chunk.length / 1.8) + 300, 2500);
        const proofRes = await withTimeout(
          axios.post(
            'https://api.anthropic.com/v1/messages',
            { model: 'claude-haiku-4-5-20251001', max_tokens: maxTok, system: PROOFREADING_SYSTEM,
              messages: [{ role: 'user', content: chunk }] },
            { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 50000 }
          ),
          45000
        );
        proofedChunks.push(proofRes.data.content[0].text.trim());
      }

      const correctedText = proofedChunks.join('\n');
      let allLines = correctedText.split('\n');
      const firstLine = allLines[0];
      const slashIdx = firstLine.search(/[/|\\]/);
      const originalTitle = (slashIdx !== -1 ? firstLine.slice(0, slashIdx) : firstLine).replace(/\*/g, '').trim();
      let bodyStart = 1;
      while (bodyStart < allLines.length && !allLines[bodyStart].trim()) bodyStart++;
      let bodyLines = allLines.slice(bodyStart);

      // מחיקת שורות קישור קיימות מתחילת הגוף (אתר / קבוצת ווטסאפ)
      const isLinkLine = l => {
        const t = l.trim();
        if (!t) return false;
        return /solelim-derech\.co\.il/i.test(t) ||
               /wa\.me|chat\.whatsapp\.com|whatsapp\.com/i.test(t) ||
               /^למאמרים נוספים/i.test(t) ||
               /^להצטרפות לקבוצה/i.test(t);
      };
      while (bodyLines.length > 0 && (isLinkLine(bodyLines[0]) || !bodyLines[0].trim())) {
        if (isLinkLine(bodyLines[0])) bodyLines.shift();
        else if (!bodyLines[0].trim() && bodyLines.length > 1 && isLinkLine(bodyLines[1])) bodyLines.shift();
        else break;
      }

      // מחיקת שורת "סוללים דרך" מהסוף (אם AI לא מחק)
      while (bodyLines.length > 0) {
        const last = bodyLines[bodyLines.length - 1].replace(/[*.'"״,\s]/g, '');
        if (last === 'סוללים דרך' || last === 'סולליםדרך') bodyLines.pop();
        else break;
      }

      // נרמול רווחים — רק אם המאמר ממוספר (אותיות עבריות / ספרות כסמני פסקה)
      bodyLines = normalizeStructuredSpacing(bodyLines);

      const body = bodyLines.join('\n').trim();
      editJobs.set(jobId, {
        status: 'done', createdAt: Date.now(),
        data: { success: true, correctedText, originalTitle, body,
          siteUrl: process.env.SITE_URL || process.env.WP_URL || '' }
      });
    } catch (error) {
      editJobs.set(jobId, {
        status: 'done', createdAt: Date.now(),
        data: { success: false, error: error.message }
      });
    }
  })();
});

// בדיקת סטטוס משימת הגהה
app.get('/edit-poll/:jobId', (req, res) => {
  const job = editJobs.get(req.params.jobId);
  if (!job || job.status === 'pending') return res.json({ done: false, progress: job?.progress || '' });
  editJobs.delete(req.params.jobId);
  res.json({ done: true, ...job.data });
});

// שלב 2: הצעות כותרת (Haiku – מהיר, עד 20 שניות)
app.post('/edit-stage2', async (req, res) => {
  try {
    const { originalTitle, bodyPreview } = req.body;
    const titlesRes = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `אתה עורך ראשי של פרסום ישראלי-לאומי מוביל. תפקידך: לכתוב כותרות שגורמות לאנשים לעצור הכל ולקרוא.

כללי ברזל:
- עד 7 מילים — כל מילה חייבת להרוויח את מקומה
- אסור לסכם — הכותרת מציתה, לא מספרת
- שפה חדה, ישירה, נוקבת — לא אקדמית ולא ביורוקרטית
- כלים מותרים: ניגוד חריף, אירוניה, שאלה שמוציאה מדעת, הצהרה נועזת, מתח עצור
- אסור להתחיל ב: "כיצד", "מדוע", "על", "הסיפור של", "בעקבות", "לאחר"
- אסור לכתוב כותרת שמתחילה בשם פרטי סתמי
- הכותרת הטובה ביותר מרגישה כמו אמת שאסור לומר בקול — אבל היא כאן

תקינות לשונית — חובה:
- התאמת זכר/נקבה, יחיד/רבים בין כל מילות הכותרת
- לא לכתוב "וודאי" אלא "ודאי", לא "שהם" כשאפשר "שהם" וכו'
- לא להשתמש בשפה מסורבלת — כל מילה חייבת להישמע טבעית בעל פה
- לפני כתיבה: לקרוא את הכותרת בקול ולוודא שהיא זורמת, חדה ותקינה

דוגמאות לסגנון הנכון:
✓ "מי מפחד מהאמת הזאת"
✓ "הם ידעו. הם שתקו"
✓ "ישראל לא מרשה לעצמה להפסיד"
✓ "הבגידה שכולם ראו, איש לא אמר"
✓ "הנה מה שהתקשורת לא תספר לך"`,
        messages: [{
          role: 'user',
          content: `כתוב 2 כותרות שונות לחלוטין זו מזו ושונות מהכותרת המקורית: "${originalTitle}".
אחת — חדה ופרובוקטיבית. השנייה — דרמטית ורגשית.
החזר JSON בלבד: {"titles":["כותרת 1","כותרת 2"]}

תחילת המאמר:
${bodyPreview}`
        }]
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
    );
    const raw = titlesRes.data.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    const titles = match ? (JSON.parse(match[0]).titles || []) : [];
    res.json({ success: true, titles });
  } catch (error) {
    res.json({ success: true, titles: [] }); // fallback – ממשיך ללא הצעות
  }
});

// שלב 3: הדגשות – מחזיר רשימת ביטויים (Haiku – מהיר, עד 20 שניות)
app.post('/edit-stage3', async (req, res) => {
  try {
    const { body } = req.body;
    const phrasesRes = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `קרא את המאמר הבא וזהה משפטים שלמים חזקים שכדאי להדגיש.
משפט שלם = מתחיל אחרי נקודה (או בתחילת פסקה) ומסתיים בנקודה.
כלל: לפחות משפט אחד לכל פסקה.
כל משפט חייב להופיע בטקסט כמות שהוא בדיוק — אל תשנה אף מילה.
החזר JSON בלבד: {"phrases":["משפט 1","משפט 2","משפט 3"]}

המאמר:
${body.slice(0, 6000)}`
        }]
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
    );
    const raw = phrasesRes.data.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    let formattedBody = body;
    if (match) {
      const phrases = (JSON.parse(match[0]).phrases || []).filter(p => p && p.length > 2);
      phrases.forEach(phrase => {
        if (!formattedBody.includes(`*${phrase}*`))
          formattedBody = formattedBody.split(phrase).join(`*${phrase}*`);
      });
    }
    res.json({ success: true, formattedBody });
  } catch (error) {
    res.json({ success: true, formattedBody: req.body.body }); // fallback – ללא הדגשות
  }
});
// ────────────────────────────────────────────────────────────────────────────

// ─── מאגר מאמרים ─────────────────────────────────────────────────────────────
const ARTICLES_FILE = path.join(__dirname, 'articles.json');
const MAX_ARTICLES = 100;

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try { return JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8')); }
  catch(e) { return []; }
}

app.get('/articles', (req, res) => {
  const all = loadArticles();
  res.json(all.map(a => ({ id: a.id, savedAt: a.savedAt, title: a.title, author: a.author })));
});

app.get('/articles/:id', (req, res) => {
  const article = loadArticles().find(a => a.id === req.params.id);
  if (!article) return res.status(404).json({ error: 'לא נמצא' });
  res.json(article);
});

app.post('/articles', (req, res) => {
  const articles = loadArticles();
  const article = {
    ...req.body,
    id: Date.now().toString(),
    savedAt: new Date().toISOString()
  };
  articles.unshift(article);
  if (articles.length > MAX_ARTICLES) articles.splice(MAX_ARTICLES);
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2));
  res.json({ success: true, id: article.id });
});

app.delete('/articles/:id', (req, res) => {
  const filtered = loadArticles().filter(a => a.id !== req.params.id);
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(filtered, null, 2));
  res.json({ success: true });
});
// ────────────────────────────────────────────────────────────────────────────

// ─── ניהול קבוצות וואטסאפ ───────────────────────────────────────────────────
const GROUPS_FILE = path.join(__dirname, 'whatsapp-groups.json');

function loadGroups() {
  if (!fs.existsSync(GROUPS_FILE)) {
    const defaults = {
      defaultGroup: 1,
      groups: Array.from({ length: 16 }, (_, i) => ({
        id: i + 1,
        name: `קבוצה ${i + 1}`,
        url: ''
      }))
    };
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
}

function saveGroups(data) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2));
}

app.get('/groups', requireAdmin, (req, res) => res.json(loadGroups()));

app.post('/groups', requireAdmin, (req, res) => {
  saveGroups(req.body);
  res.json({ success: true });
});
// ────────────────────────────────────────────────────────────────────────────

let logs = [];

function addLog(message) {
  console.log(message);
  logs.push({ time: new Date().toISOString(), message });
}

// קבלת לוגים
app.get('/logs', requireAdmin, (req, res) => {
  res.json(logs);
});

// העלאת אודיו ל-Buzzsprout
async function uploadToBuzzsprout(filePath, title) {
  addLog('מתחיל העלאה ל-Buzzsprout...');
  const form = new FormData();
  form.append('title', title || 'פרק חדש');
  form.append('audio_file', fs.createReadStream(filePath));
  form.append('private', '0');

  const response = await axios.post(
    `https://www.buzzsprout.com/api/${process.env.BUZZSPROUT_PODCAST_ID}/episodes.json`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Token token=${process.env.BUZZSPROUT_API_TOKEN}`
      }
    }
  );

  addLog(`העלאה ל-Buzzsprout הושלמה. קישור: ${response.data.audio_url}`);
  return response.data;
}

// המרת OGG ל-MP3
function convertToMp3(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath + '.mp3';
    ffmpeg(inputPath)
      .toFormat('mp3')
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// ניתוח טקסט עם Claude
async function analyzeWithClaude(text) {
  addLog('מתחיל ניתוח AI...');
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `נתח את המאמר הבא והחזר JSON בלבד (ללא טקסט נוסף, ללא הסברים). חשוב מאוד: אל תשתמש במרכאות כפולות (") בתוך ערכי המחרוזות — השתמש במרכאות בודדות ('). עם השדות הבאים:
{
  "title": "כותרת המאמר",
  "author": "שם הכותב",
  "opening1": "משפט פתיחה קצר (שורה אחת) - זהה את הרעיון המרכזי או המסר הרגשי העמוק. נסח משפט חד, כללי ומעורר מחשבה. לא תיאור טכני של הנושא.",
  "opening2": "משפט פתיחה (שתי שורות) - זהה את הרעיון המרכזי או המסר הרגשי העמוק. נסח משפטים חדים, כלליים ומעוררי מחשבה. לא תיאור טכני של הנושא.",
  "topics": ["קטגוריה1", "קטגוריה2"],
  "tags": ["תגית1", "תגית2", "תגית3", "תגית4"],
  "quotes": ["ציטוט1", "ציטוט2", "ציטוט3"]
}

לגבי הקטגוריות (topics) - בחר בדיוק 2 מהרשימה הבאה בלבד. אל תוסיף קטגוריות חדשות, אל תשנה את הניסוח, אל תוסיף מקפים:
התיישבות, זהות יהודית, חינוך, לאומיות, משפטים, פוליטיקה, פילוסופיה, צבא וביטחון, תקשורת

לגבי התגיות (tags) - בחר 4 עד 6 תגיות מהרשימה הבאה. חובה לבחור מהרשימה — אין ליצור תגיות חדשות אלא אם אין שום תגית מתאימה ברשימה כולה (מקרה נדיר ביותר). השתמש בניסוח המדויק כפי שמופיע ברשימה, ללא מקפים:
ימין ושמאל, דיפ סטייט, אליטות, מוצש וזכויותיהם של ישראל, גבורה, הפרוגרס, עסקת חטופים, מלחמת זהות, מלחמה, אחדות בעם ישראל, גיוס חרדים, ראש הממשלה, תקשורת, חירות מחשבה, תודעה היסטורית, תפיסות ביטחוניות, יהדות במרחב הציבורי, היסטוריה, חטופים, השב״כ, מערכת המשפט, מערכת הביטחון, מחאות קפלן, אחריות לאומית, החברה החרדית, הרבעון הרביעי, דמוקרטיה, הנהגת המדינה, עיצוב תודעה, מחנה הימין, שליטה במקורות הכוח, תפיסות מוסריות, חירות, מנהיגות צבאית, ממשלה ואחריות, דתיים לאומיים, אחים לנשק, נפתלי בנט, דת ומדינה, ציבוריות וצבא, מוסר, אהוד ברק, מדיניות ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות החטופים, טראמפ, ליברליזם, ציונות דתית, תורת הרב קוק, רפורמה משפטית, עולם התורה, משפחות שכולות, קצר לפני שבת, תודעה ציבורית, בית המשפט, עברית, נבחרי ציבור, הסכמי אוסלו, תורת ישראל, עיתון הארץ, עופר וינטר, הנהגה יהודית, ערכים לאומיים, מלחמת תרבות, עוצמה לאומית, חינוך לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ 14, עיצוב זיכרון לאומי, זיכרון ותקומה, פוסטמודרניזם, השתקה, רוח צה"ל, מקצועיות בצבא, קבוצת השתייכות, אסטרטגיה

לגבי הציטוטים - בחר 3 משפטים שקיימים במאמר כמות שהם, באורך משפט אחד עד שניים לכל היותר. לא קטעים ארוכים.
חובה: העתק את הציטוטים מילה במילה ותו בתו מהמאמר, ללא שינוי כלשהו — כולל שמירה מלאה על גרשיים (״) וגרש (׳). אסור להמיר גרשיים לגרש בודד. לדוגמה: צה"ל חייב להישאר צה"ל, בג"ץ חייב להישאר בג"ץ.

המאמר:
${text}`
      }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );

  addLog('ניתוח AI הושלם בהצלחה');
  const content = response.data.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude לא החזיר JSON תקין');
  let jsonStr = jsonMatch[0];
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // ניסיון תיקון: הסרת תווי בקרה ופסיקים מיותרים
    jsonStr = jsonStr
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(jsonStr);
    } catch (e2) {
      throw new Error(`JSON לא תקין: ${e2.message}. תוכן: ${jsonStr.slice(0, 200)}`);
    }
  }
}

const ALLOWED_CATEGORIES = ['התיישבות', 'זהות יהודית', 'חינוך', 'לאומיות', 'משפטים', 'פוליטיקה', 'פילוסופיה', 'צבא וביטחון', 'תקשורת'];

// המרת שמות ל-IDs בוורדפרס (תגיות או קטגוריות)
async function getOrCreateTermIds(names, taxonomy) {
  const endpoint = taxonomy === 'categories' ? 'categories' : 'tags';
  const ids = [];
  for (const name of names) {
    // קטגוריות — רק מהרשימה המותרת, לא ליצור חדשות
    if (taxonomy === 'categories' && !ALLOWED_CATEGORIES.includes(name)) {
      addLog(`קטגוריה "${name}" לא ברשימה המותרת — מדולגת`);
      continue;
    }
    try {
      const search = await axios.get(`${process.env.WP_URL}/wp-json/wp/v2/${endpoint}?search=${encodeURIComponent(name)}`, {
        auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
      });
      const existing = search.data.find(t => t.name === name);
      if (existing) {
        ids.push(existing.id);
      } else if (taxonomy === 'tags') {
        // תגיות — אפשר ליצור חדשות
        const created = await axios.post(`${process.env.WP_URL}/wp-json/wp/v2/${endpoint}`, { name }, {
          auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
        });
        ids.push(created.data.id);
      } else {
        addLog(`קטגוריה "${name}" לא נמצאה בוורדפרס — מדולגת`);
      }
    } catch (e) {
      addLog(`שגיאה ב-${taxonomy} "${name}": ${e.message}`);
    }
  }
  return ids;
}

// חיפוש כותב לפי שם
async function findAuthorId(name) {
  try {
    const res = await axios.get(`${process.env.WP_URL}/wp-json/wp/v2/users?search=${encodeURIComponent(name)}&per_page=20`, {
      auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
    });
    const user = res.data.find(u => u.name.toLowerCase() === name.toLowerCase()) || res.data[0];
    return user?.id || null;
  } catch (e) {
    addLog(`לא הצלחתי למצוא כותב "${name}": ${e.message}`);
    return null;
  }
}

// פרסום לוורדפרס
async function publishToWordPress(data) {
  addLog('מתחיל פרסום לוורדפרס...');

  const { title, content, excerpt, date, tags, topics, authorName, featuredMediaId } = data;

  const status = process.env.DEV_MODE === 'true' ? 'draft' : 'future';
  const tagIds = tags?.length ? await getOrCreateTermIds(tags, 'tags') : [];
  const categoryIds = topics?.length ? await getOrCreateTermIds(topics.slice(0, 2), 'categories') : [];
  const authorId = authorName ? await findAuthorId(authorName) : null;

  const postData = {
    title,
    content,
    excerpt: excerpt || '',
    status,
    date,
    tags: tagIds,
    categories: categoryIds,
  };
  if (authorId) postData.author = authorId;
  if (featuredMediaId) postData.featured_media = featuredMediaId;

  const response = await axios.post(
    `${process.env.WP_URL}/wp-json/wp/v2/posts`,
    postData,
    { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD } }
  );

  addLog(`המאמר פורסם בוורדפרס בסטטוס ${status} עם מזהה: ${response.data.id}`);
  return response.data;
}

// העלאת תמונה לוורדפרס
app.post('/upload-image', requireAdminOrEnglish, upload.single('image'), async (req, res) => {
  try {
    addLog('מעלה תמונה לוורדפרס...');
    const imageBuffer = fs.readFileSync(req.file.path);
    const response = await axios.post(
      `${process.env.WP_URL}/wp-json/wp/v2/media`,
      imageBuffer,
      {
        headers: {
          'Content-Disposition': `attachment; filename="${req.file.originalname}"`,
          'Content-Type': req.file.mimetype,
        },
        auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
      }
    );
    addLog(`תמונה הועלתה. מזהה: ${response.data.id}`);
    res.json({ success: true, mediaId: response.data.id, logs });
  } catch (error) {
    addLog(`שגיאה בהעלאת תמונה: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

// עדכון פרק ב-Buzzsprout
app.post('/update-episode', requireAdmin, async (req, res) => {
  const { episodeId, title, author } = req.body;
  try {
    await axios.put(
      `https://www.buzzsprout.com/api/${process.env.BUZZSPROUT_PODCAST_ID}/episodes/${episodeId}.json`,
      {
        title,
        description: author ? `כתיבה: ${author}` : ''
      },
      { headers: { 'Authorization': `Token token=${process.env.BUZZSPROUT_API_TOKEN}` } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// רשימת כותבים מוורדפרס
app.get('/wp-users', requireAdmin, async (req, res) => {
  try {
    const response = await axios.get(`${process.env.WP_URL}/wp-json/wp/v2/users?per_page=100`, {
      auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
    });
    res.json({ success: true, users: response.data.map(u => ({ id: u.id, name: u.name })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// נתיב העלאת אודיו מיידית
app.post('/upload-audio', requireAdmin, upload.single('audio'), async (req, res) => {
  logs = [];
  try {
    addLog('קובץ אודיו התקבל, המרה והעלאה ל-Buzzsprout החלו');
    let audioPath = req.file.path;
    if (req.file.originalname.endsWith('.ogg')) {
      addLog('ממיר OGG ל-MP3...');
      audioPath = await convertToMp3(audioPath);
    }
    const audioData = await uploadToBuzzsprout(audioPath, 'פרק חדש');
    res.json({ success: true, audioData, podcastId: process.env.BUZZSPROUT_PODCAST_ID, logs });
  } catch (error) {
    addLog(`שגיאה בהעלאת אודיו: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

// נתיב ראשי - עיבוד מאמר
app.post('/process', requireAdmin, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), async (req, res) => {
  logs = [];
  addLog('מתחיל עיבוד מאמר חדש');

  try {
const rawText = req.body.text;

// חילוץ כותרת ושם כותב משורה ראשונה
const firstLine = rawText.split('\n')[0];
const lastSlashIndex = firstLine.lastIndexOf('/');
const titlePart = (lastSlashIndex !== -1 ? firstLine.slice(0, lastSlashIndex).trim() : firstLine.trim()).replace(/\*/g, '').trim();
const authorPart = lastSlashIndex !== -1
  ? firstLine.slice(lastSlashIndex + 1).replace(/\(.*?\)/g, '').trim()
  : '';

// ניקוי הטקסט
const lines = rawText.split('\n').slice(1); // מסיר שורה ראשונה (כותרת+כותב)

// מסיר שורות ריקות וקישורים מתחילת המאמר בלבד
let contentStart = 0;
while (contentStart < lines.length) {
  const trimmed = lines[contentStart].trim();
  if (trimmed === '' || /https?:\/\//.test(trimmed) || /www\./.test(trimmed)) {
    contentStart++;
  } else {
    break;
  }
}

const cleanLines = lines.slice(contentStart).filter(line => {
  const trimmed = line.trim();
  if (trimmed.includes('סוללים דרך')) return false;
  return true;
});

// המרת הדגשים לHTML ומחיקת כוכביות שנותרו
// וואטסאפ משתמש ב-*טקסט* (כוכבית אחת) להדגשה
const text = cleanLines.join('\n')
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/\*/g, '')
  .trim();
    // ניתוח AI
const analysis = await analyzeWithClaude(text);
analysis.title = titlePart || analysis.title;
analysis.author = authorPart || analysis.author;

    res.json({
      success: true,
      analysis,
      cleanedText: text,
      logs
    });

  } catch (error) {
    addLog(`שגיאה: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

// נתיב פרסום סופי
app.post('/publish', requireAdmin, async (req, res) => {
  try {
    const result = await publishToWordPress(req.body);
    res.json({ success: true, result, logs });
  } catch (error) {
    addLog(`שגיאה בפרסום: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

// ─── העלאת חוברת שבועית ───────────────────────────────────────────────────────
app.post('/publish-booklet', requireAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { bookletNumber, publishDate } = req.body;
    if (!req.file) return res.status(400).json({ success: false, error: 'קובץ PDF חסר' });
    if (!bookletNumber) return res.status(400).json({ success: false, error: 'מספר חוברת חסר' });
    if (!publishDate) return res.status(400).json({ success: false, error: 'תאריך פרסום חסר' });

    const wpAuth = { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD };
    const wpBase = `${process.env.WP_URL}/wp-json/wp/v2`;

    addLog(`מעלה חוברת מספר ${bookletNumber}...`);

    // 1. העלאת ה-PDF למדיה של וורדפרס
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfFilename = `חוברת-שבועית-סוללים-דרך-${bookletNumber}.pdf`;
    const mediaRes = await axios.post(`${wpBase}/media`, pdfBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="booklet-${bookletNumber}.pdf"`,
        'Content-Type': 'application/pdf'
      },
      auth: wpAuth,
      maxBodyLength: Infinity
    });
    fs.unlinkSync(req.file.path);
    const pdfUrl = mediaRes.data.source_url;
    addLog(`PDF הועלה: ${pdfUrl}`);

    // 2. מציאת תמונה ראשית קבועה לפי שם
    const imgSearch = await axios.get(`${wpBase}/media?search=WhatsApp-Image-2025-01-10-at-12.24.11&per_page=5`, { auth: wpAuth });
    const featuredImg = imgSearch.data.find(m => m.slug?.includes('12-24-11') || m.source_url?.includes('12.24.11')) || imgSearch.data[0];
    const featuredMediaId = featuredImg?.id || null;
    if (featuredMediaId) addLog(`תמונה ראשית נמצאה: ID ${featuredMediaId}`);

    // 3. קטגוריה ותגית
    const categoryIds = await getOrCreateTermIds(['אקטואליה'], 'categories');
    const tagIds      = await getOrCreateTermIds(['חוברת שבועית להדפסה'], 'tags');

    // 4. בניית תוכן המאמר
    const content = `<blockquote>
<h2>המאמרים של השבוע האחרון בקובץ דיגיטלי, מותאם להדפסה!</h2>
<h3>לקבלת החוברת במייל מידי שבוע - <a href="https://pe4ch.com/ref/xR1a1UxC2che?lang=he">הירשמו כאן</a></h3>
</blockquote>
<h2></h2>
<h2 style="text-align: center;"><a href="${pdfUrl}"><strong>לפתיחת החוברת לחצו כאן</strong></a></h2>
<a href="${pdfUrl}"><img class="aligncenter wp-image-1342 size-thumbnail" src="https://www.solelim-derech.co.il/wp-content/uploads/2025/01/download-pdf-150x150.png" alt="" width="150" height="150" /></a>`;

    // 5. יצירת הפוסט
    const postData = {
      title: `חוברת מאמרי השבוע (${bookletNumber}) להדפסה!`,
      content,
      status: 'future',
      date: new Date(publishDate).toISOString(),
      categories: categoryIds,
      tags: tagIds
    };
    if (featuredMediaId) postData.featured_media = featuredMediaId;

    const postRes = await axios.post(`${wpBase}/posts`, postData, { auth: wpAuth });
    addLog(`חוברת פורסמה! קישור: ${postRes.data.link}`);

    res.json({ success: true, postUrl: postRes.data.link, postId: postRes.data.id, pdfUrl, logs });
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    addLog(`שגיאה בפרסום חוברת: ${msg}`);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: msg, logs });
  }
});

// אישור ופרסום טיוטה
app.post('/approve', requireAdminOrEnglish, async (req, res) => {
  try {
    const { postId } = req.body;
    addLog(`מאשר פרסום פוסט ${postId}...`);
    const response = await axios.post(
      `${process.env.WP_URL}/wp-json/wp/v2/posts/${postId}`,
      { status: 'publish' },
      { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD } }
    );
    addLog(`הפוסט פורסם בהצלחה!`);
    res.json({ success: true, url: response.data.link });
  } catch (error) {
    addLog(`שגיאה באישור: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── יצירת תמונות עם AI ──────────────────────────────────────────────────────
const GENERATED_DIR = path.join(__dirname, 'public', 'generated');
const LOGO_PATH     = path.join(__dirname, 'public', 'logo.png');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// ─── ניקוי אוטומטי: תמונות ו-MP3 זמניים מעל 3 ימים ────────────────────────
function cleanOldFiles() {
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;
  // תמונות שנוצרו
  try {
    for (const f of fs.readdirSync(GENERATED_DIR)) {
      const fp = path.join(GENERATED_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > THREE_DAYS) { fs.unlinkSync(fp); deleted++; }
    }
  } catch {}
  // MP3 זמניים
  const tempDir = path.join(__dirname, 'public', 'temp');
  try {
    if (fs.existsSync(tempDir)) {
      for (const f of fs.readdirSync(tempDir)) {
        const fp = path.join(tempDir, f);
        if (now - fs.statSync(fp).mtimeMs > THREE_DAYS) { fs.unlinkSync(fp); deleted++; }
      }
    }
  } catch {}
  if (deleted > 0) console.log(`[cleanup] נמחקו ${deleted} קבצים ישנים`);
}
cleanOldFiles();                                    // ריצה בהפעלה
setInterval(cleanOldFiles, 6 * 60 * 60 * 1000);   // כל 6 שעות

async function applyLogoToImage(imageBuffer, position = 'bottom-left') {
  const img  = sharp(imageBuffer);
  const meta = await img.metadata();
  const size = meta.width; // תמיד מרובע

  const logoSize = Math.round(size * 0.15); // 15% מגודל התמונה
  const padding  = Math.round(size * 0.05); // 5% ריווח מהקצה

  // שינוי גודל הלוגו + הפחתת שקיפות ל-75%
  const { data, info } = await sharp(LOGO_PATH)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = Math.round(pixels[i] * 0.75); // opacity 75%
  }

  const logoFinal = await sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toBuffer();

  // מיקום לפי פינה
  let left, top;
  switch (position) {
    case 'top-left':     left = padding;                    top = padding;                    break;
    case 'top-right':    left = size - logoSize - padding;  top = padding;                    break;
    case 'bottom-right': left = size - logoSize - padding;  top = size - logoSize - padding;  break;
    default:             left = padding;                    top = size - logoSize - padding;  break; // bottom-left
  }

  return img
    .composite([{ input: logoFinal, top, left, blend: 'over' }])
    .png()
    .toBuffer();
}

// ─── יצירת דגל ישראל מדויק (SVG → PNG) ──────────────────────────────────────
function createIsraeliFlagBuffer(flagWidth) {
  const w = flagWidth;
  const h = Math.round(w * 2 / 3);
  const stripeH = Math.round(h * 0.13);
  const topY    = Math.round(h * 0.195);
  const botY    = h - topY - stripeH;
  const cx = w / 2, cy = h / 2;
  const r  = Math.round(w * 0.115);   // רדיוס המגן דוד
  const sw = Math.max(3, Math.round(w * 0.019)); // עובי קו
  const s60 = 0.866, c60 = 0.5;      // sin/cos 60°
  // משולש עליון (▲) ומשולש תחתון (▽)
  const up = `${cx},${cy - r} ${cx + r * s60},${cy + r * c60} ${cx - r * s60},${cy + r * c60}`;
  const dn = `${cx},${cy + r} ${cx + r * s60},${cy - r * c60} ${cx - r * s60},${cy - r * c60}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    <rect x="0" y="${topY}" width="${w}" height="${stripeH}" fill="#0038B8"/>
    <rect x="0" y="${botY}" width="${w}" height="${stripeH}" fill="#0038B8"/>
    <polygon points="${up}" fill="none" stroke="#0038B8" stroke-width="${sw}" stroke-linejoin="miter"/>
    <polygon points="${dn}" fill="none" stroke="#0038B8" stroke-width="${sw}" stroke-linejoin="miter"/>
  </svg>`;
  return Buffer.from(svg, 'utf-8');
}

// ─── הדבק דגל ישראל על תמונה שנוצרה ─────────────────────────────────────────
// הדגל מוצג ממולא (frontal) — כמו שער מגזין, לא כדגל ברקע.
// לסצנות שבהן הדגל הוא האלמנט הראשי זה נראה טבעי ועוצמתי.
async function overlayIsraeliFlag(imageBuf) {
  const meta  = await sharp(imageBuf).metadata();
  const imgW  = meta.width, imgH = meta.height;
  // דגל גדול — 82% מרוחב התמונה, ממוקם במרכז לכיסוי הדגל של ה-AI
  const flagW = Math.round(imgW * 0.82);
  const flagH = Math.round(flagW * 2 / 3);
  // סיבוב קל אקראי (-6° עד +6°) — פחות סטטי
  const rotateDeg = (Math.random() * 12 - 6);
  const flagSvgBuf = createIsraeliFlagBuffer(flagW);
  // צור PNG עם סיבוב קל, ורקע שקוף
  const flagPng = await sharp(flagSvgBuf)
    .rotate(rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const rotMeta = await sharp(flagPng).metadata();
  // ממוקם במרכז אופקי, שליש עליון אנכי
  const left = Math.round((imgW - rotMeta.width)  / 2);
  const top  = Math.round((imgH - rotMeta.height) / 2 - imgH * 0.08);
  return sharp(imageBuf)
    .composite([{ input: flagPng, left, top, blend: 'over' }])
    .png()
    .toBuffer();
}

// ─── יצירת תמונה — Grok (xAI Aurora) עם fallback ל-gpt-image-1 ──────────────
async function generateDalleVariant(prompt, _style) {
  // נסה Grok קודם אם יש מפתח
  if (process.env.XAI_API_KEY) {
    try {
      addLog('🤖 שולח ל-Grok (xAI)...');
      const xaiRes = await axios.post(
        'https://api.x.ai/v1/images/generations',
        { model: 'grok-2-image', prompt, n: 1 },
        { headers: { 'Authorization': `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      const imgData = xaiRes.data.data[0];
      if (imgData.b64_json) return Buffer.from(imgData.b64_json, 'base64');
      const imgRes = await axios.get(imgData.url, { responseType: 'arraybuffer', timeout: 30000 });
      return Buffer.from(imgRes.data);
    } catch (xaiErr) {
      const msg = xaiErr.response?.data?.error?.message || xaiErr.message;
      addLog(`⚠️ Grok נכשל (${msg}) — עובר ל-gpt-image-1`);
    }
  }
  // fallback 1: gpt-image-1
  try {
    addLog('🤖 שולח ל-gpt-image-1 (OpenAI)...');
    const dalleRes = await axios.post(
      'https://api.openai.com/v1/images/generations',
      { model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'high', n: 1 },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
    );
    const imgData = dalleRes.data.data[0];
    if (imgData.b64_json) return Buffer.from(imgData.b64_json, 'base64');
    const imgRes = await axios.get(imgData.url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(imgRes.data);
  } catch (gptImgErr) {
    const msg = gptImgErr.response?.data?.error?.message || gptImgErr.message;
    addLog(`⚠️ gpt-image-1 נכשל (${msg}) — עובר ל-dall-e-3`);
  }
  // fallback 2: dall-e-3 (זמין לכל חשבון OpenAI)
  addLog('🤖 שולח ל-dall-e-3 (OpenAI)...');
  const dalle3Res = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model: 'dall-e-3', prompt, size: '1024x1024', quality: 'standard', n: 1 },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
  );
  const dalle3Data = dalle3Res.data.data[0];
  const dalle3ImgRes = await axios.get(dalle3Data.url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(dalle3ImgRes.data);
}

// ─── מדריך רעיונות ויזואליים + הנדסת פרומפטים (שני מצבים) ─────────────────
const VISUAL_SYSTEM_PROMPT = `You are an editorial image director for a leading Israeli news publication.

Your job: given an article, produce 4 image concepts that look like they could appear on the front page of a serious Israeli newspaper or magazine — MAARIV, YEDIOTH, or a political journal.

CRITICAL — ISRAELI CONTEXT (DEFAULT FOR ALL CONTENT):
All articles are written for an Israeli audience. Unless a foreign country is explicitly named in the article, ALWAYS apply these defaults:
- "army" / "military" / "soldiers" = IDF (Israeli Defense Forces) — Israeli military uniforms, green IDF gear, Israeli soldiers
- "flag" = Israeli flag — blue and white with Star of David
- "state" / "country" / "nation" = State of Israel
- "city" / "urban scenes" = Israeli city (Tel Aviv, Jerusalem, or generic Israeli urban landscape)
- "parliament" / "government building" = Israeli Knesset
- "court" / "justice" = Israeli Supreme Court building
- "streets" / "protest" / "crowd" = Israeli streets, Israeli demonstrators
If a specific foreign country, army, or flag is explicitly mentioned in the article — use that. Otherwise: Israel only.

The system operates in TWO MODES.

====================================
MODE: IDEAS
===========

Based on the article, generate 4 distinct and powerful visual concepts for square (1:1) editorial images for an Israeli publication.

Step 1: Identify the core message and emotional tone (e.g. conflict, division, unity, identity, injustice, reflection, tension, hope, cynicism). Name it explicitly before building visuals.

Step 2: For each concept, build a layered visual scene. Think through each of these dimensions:
- SUBJECT: What is the main subject? (a person, object, abstract shape, landscape)
- COMPOSITION: How is it arranged? (split, isolated vs crowd, above vs below, center vs margin)
- LIGHTING: What does the light tell? (warm vs cold sides, one lit/one dark, chiaroscuro, harsh vs soft, a single shaft of light)
- MATERIALS & TEXTURE: What materials carry symbolic weight? (cracked stone, broken glass, mirror, water, iron, fire, shadow, soil)
- ATMOSPHERE: What is the overall mood? (oppressive, hopeful, ironic, tense, melancholy, defiant, absurd)

Requirements:
- Each concept must be significantly different from the others (different metaphor, not just variation).
- Each concept must work as a standalone image — striking even without knowing the article.
- Focus on symbolic and emotional impact, not literal illustration of the text.
- Avoid generic, cliché, or static ideas. Prefer dynamic tension and visual contradiction.

Balance requirement — MANDATORY:
- Exactly ONE concept must be bold, cynical, provocative, or sharply critical.
  Use a striking, unexpected, or uncomfortable visual metaphor for strong emotional impact.
  Mark it with "cynical": true in the JSON.
- The other three can be more subtle, calm, poetic, or powerful in a different way.
- Maintain diversity in tone across all four.

Creative guidelines:
- Visual contrast is your primary tool: light vs darkness, warm vs cold tones, individual vs crowd, broken vs whole, silence vs noise.
- Lighting can tell the whole story — use it as a narrative device (one side bathed in warm gold, the other in cold blue shadow).
- Materials and textures add meaning: stone = power/permanence, cracked earth = fracture/instability, mirror/glass = reflection/distortion, iron = rigidity, fire = urgency, water = flow/instability.
- Use strong symbolic elements: cracked objects, distorted reflections, tilted scales, barriers, shadows, scale differences, empty chairs, locked doors.
- Consider irony, exaggeration, role reversal, or visual contradiction.
- Minimal composition — one dominant idea per image, no clutter.
- The image must be able to carry its message without any text.

Do NOT include text inside the images.
Do NOT generate full prompts — only conceptual ideas in Hebrew.

Output format — Return ONLY valid JSON. The "scene" field must be 2-3 rich sentences covering: what we see, lighting and color contrast, materials and textures, atmosphere and mood:
{"summary": "2-3 משפטים בעברית על המסר המרכזי של המאמר", "ideas": [{"title": "כותרת 2-4 מילים", "scene": "2-3 משפטים: מה רואים בתמונה, מה התאורה והצבעים, אילו חומרים ואווירה", "metaphor": "המטפורה הוויזואלית המרכזית במשפט אחד", "message": "המסר הרגשי שהתמונה מעבירה במשפט אחד", "cynical": false}, {"title": "...", "scene": "...", "metaphor": "...", "message": "...", "cynical": false}, {"title": "...", "scene": "...", "metaphor": "...", "message": "...", "cynical": false}, {"title": "...", "scene": "...", "metaphor": "...", "message": "...", "cynical": true}]}

====================================
MODE: PROMPTS
=============

Input: A visual scene described in Hebrew for an Israeli publication.
Task: Translate and expand it into two English image prompts — one photorealistic, one illustrated.

Stay faithful to the original scene. Preserve every visual element mentioned: subjects, objects, lighting direction, color contrast (warm/cold), materials, textures, and atmosphere.

Enrich each prompt with specific sensory details:
- Lighting: direction, quality (harsh/soft), temperature (warm golden vs cold blue), contrast ratio
- Materials: specify textures (cracked stone, aged wood, polished iron, frosted glass, dark soil)
- Atmosphere: time of day, air quality, silence or noise implied, emotional tension
- Composition: where the eye lands first, foreground vs background, negative space

Prompt A — Documentary photograph style: shot by an award-winning photojournalist, natural available light, 35mm lens, high contrast, hyper-realistic, no studio feel. No text in image. Square 1:1 composition.

Prompt B — Editorial illustration style: painted by a master editorial illustrator, bold graphic shapes, intentional color palette (specify 2-3 dominant colors), rich texture, strong symbolic composition, magazine cover quality. No text in image. Square 1:1 composition.

OUTPUT — write only the two prompts, no preamble:
Prompt A:
[paragraph]

Prompt B:
[paragraph]`;

// ─── הנחייה קצרה המצורפת לכל פרומפט שנשלח ליצירת תמונה ──────────────────
const DALL_E_STYLE_SUFFIX = ` Square 1:1 composition. No text, no letters, no numbers anywhere in the image. IMPORTANT: This is an Israeli publication — unless a specific foreign country is explicitly described, all soldiers wear IDF uniforms, all flags are Israeli (blue and white, Star of David), all settings are Israeli.`;

// תרגום רעיון אישי לאנגלית (תרגום פשוט — הרחבה תתבצע ב-expandToTwoPrompts)
app.post('/translate-idea', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea?.trim()) return res.status(400).json({ success: false, error: 'חסר רעיון' });
    const result = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Translate the Hebrew image idea to concise English. Return only the translated description, nothing else.' },
          { role: 'user', content: idea }
        ],
        max_tokens: 200 },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    res.json({ success: true, en: result.data.choices[0].message.content.trim() });
  } catch (error) {
    res.json({ success: true, en: req.body.idea }); // fallback: שלח עברית
  }
});

// ─── יצירת שני פרומפטים מרעיון נבחר (MODE: PROMPTS) ────────────────────────
async function expandToTwoPrompts(idea) {
  try {
    const result = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o',
        messages: [
          { role: 'system', content: VISUAL_SYSTEM_PROMPT },
          { role: 'user', content: `MODE: PROMPTS\n\nINPUT:\n${idea}` }
        ],
        max_tokens: 1200 },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const text = result.data.choices[0].message.content;
    const promptAMatch = text.match(/Prompt A:\s*([\s\S]+?)(?=\n\s*Prompt B:|$)/i);
    const promptBMatch = text.match(/Prompt B:\s*([\s\S]+?)$/i);
    if (!promptAMatch) addLog('⚠️ לא נמצא Prompt A — משתמש בפולבק');
    if (!promptBMatch) addLog('⚠️ לא נמצא Prompt B — משתמש בפולבק');
    const promptA = (promptAMatch ? promptAMatch[1].trim() : idea) + DALL_E_STYLE_SUFFIX;
    const promptB = (promptBMatch ? promptBMatch[1].trim() : idea) + DALL_E_STYLE_SUFFIX;
    addLog(`📷 A: ${promptA.length} תווים | 🎨 B: ${promptB.length} תווים`);
    return { promptA, promptB };
  } catch (e) {
    addLog(`⚠️ expandToTwoPrompts נכשל: ${e.message} — משתמש בפולבק`);
    return { promptA: idea + DALL_E_STYLE_SUFFIX, promptB: idea + DALL_E_STYLE_SUFFIX };
  }
}

// רעיונות לתמונה — שני שלבים: ניתוח מאמר → רעיונות תמונה
app.post('/image-ideas', async (req, res) => {
  try {
    const { text, direction } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

    addLog('מנתח מאמר ויוצר רעיונות ויזואליים...');

    const ideasRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: VISUAL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `MODE: IDEAS

INPUT:
${text.slice(0, 3500)}
${direction ? `\nVISUAL DIRECTION FROM AUTHOR: "${direction}" — all 4 ideas must align with this direction.\n` : ''}`
          }
        ],
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const result = JSON.parse(ideasRes.data.choices[0].message.content);
    addLog(`התקבלו ${result.ideas?.length || 0} רעיונות לתמונה`);
    res.json({ success: true, summary: result.summary || '', ideas: result.ideas, logs });
  } catch (error) {
    addLog(`שגיאה ברעיונות תמונה: ${error.response?.data?.error?.message || error.message}`);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message, logs });
  }
});

// יצירת תמונה — DALL-E 3 x2 (📷 קולנועי + 🎨 אמנותי)
app.post('/generate-image', async (req, res) => {
  try {
    const { ideaEn, ideaHe } = req.body;
    if (!ideaEn) return res.status(400).json({ success: false, error: 'רעיון חסר' });

    addLog('יוצר פרומפטים מקצועיים לפי הרעיון הנבחר...');
    const { promptA, promptB } = await expandToTwoPrompts(ideaEn);

    addLog('יוצר 📷 ריאלי ו-✏️ ציור במקביל...');
    const ts = Date.now();

    // שני סגנונות DALL-E במקביל — שניהם natural (vivid גורם למראה AI מבריק)
    const [dalleSettled, artisticSettled] = await Promise.allSettled([
      generateDalleVariant(promptA, 'natural'),
      generateDalleVariant(promptB, 'natural')
    ]);

    // שמור תמונות שהצליחו
    async function saveImagePair(buf, prefix) {
      const pngBuf = await sharp(buf).png().toBuffer();
      const noLogoFile   = `img_${ts}_${prefix}_clean.png`;
      const withLogoFile = `img_${ts}_${prefix}_logo.png`;
      fs.writeFileSync(path.join(GENERATED_DIR, noLogoFile), pngBuf);
      const withLogoBuf = await applyLogoToImage(pngBuf, 'bottom-left');
      fs.writeFileSync(path.join(GENERATED_DIR, withLogoFile), withLogoBuf);
      return { noLogoFile, withLogoFile, noLogoUrl: `/generated/${noLogoFile}`, withLogoUrl: `/generated/${withLogoFile}` };
    }

    const result = { success: true, ideaHe, logs };

    if (dalleSettled.status === 'fulfilled') {
      result.dalle = await saveImagePair(dalleSettled.value, 'dalle');
      addLog('📷 ריאלי — נשמר בהצלחה');
    } else {
      const dalleErr = dalleSettled.reason?.response?.data?.error?.message || dalleSettled.reason?.message || 'שגיאה לא ידועה';
      addLog(`📷 ריאלי נכשל: ${dalleErr}`);
    }

    if (artisticSettled.status === 'fulfilled') {
      result.artistic = await saveImagePair(artisticSettled.value, 'artistic');
      addLog('🎨 אמנותי — נשמר בהצלחה');
    } else {
      const artisticErr = artisticSettled.reason?.response?.data?.error?.message || artisticSettled.reason?.message || 'שגיאה לא ידועה';
      addLog(`🎨 vivid נכשל: ${artisticErr} — מנסה שנית עם natural`);
      // Fallback: retry Prompt B with natural style
      try {
        const retryBuf = await generateDalleVariant(promptB, 'natural');
        result.artistic = await saveImagePair(retryBuf, 'artistic');
        addLog('🎨 אמנותי (retry natural) — נשמר בהצלחה');
      } catch (retryErr) {
        const retryErrMsg = retryErr?.response?.data?.error?.message || retryErr.message;
        addLog(`🎨 אמנותי נכשל גם בניסיון שני: ${retryErrMsg}`);
      }
    }

    if (!result.dalle && !result.artistic) {
      return res.status(500).json({ success: false, error: 'שתי יצירות התמונה נכשלו', logs });
    }

    // ── הדבק דגל ישראל: בדוק גם רעיון וגם פרומפטים שנוצרו ─────────────────────
    const needsFlag = /דגל|flag/i.test(ideaHe || '')
                   || /flag/i.test(ideaEn || '')
                   || /flag/i.test(promptA)
                   || /flag/i.test(promptB);
    if (needsFlag) {
      addLog('🇮🇱 מזהה בקשה לדגל — מייצר דגל ישראל מדויק ומדביק על התמונות...');
      for (const key of ['dalle', 'artistic']) {
        if (!result[key]) continue;
        try {
          const noLogoBuf  = fs.readFileSync(path.join(GENERATED_DIR, result[key].noLogoFile));
          const withFlag   = await overlayIsraeliFlag(noLogoBuf);
          const withFlagAndLogo = await applyLogoToImage(withFlag, 'bottom-left');
          fs.writeFileSync(path.join(GENERATED_DIR, result[key].noLogoFile),   withFlag);
          fs.writeFileSync(path.join(GENERATED_DIR, result[key].withLogoFile), withFlagAndLogo);
          addLog(`✅ דגל ישראל הודבק על תמונת ${key}`);
        } catch (flagErr) {
          addLog(`⚠️ שגיאה בהדבקת דגל על ${key}: ${flagErr.message}`);
        }
      }
    }

    addLog('התמונות מוכנות!');
    res.json(result);
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    addLog(`שגיאה ביצירת תמונה: ${msg}`);
    res.status(500).json({ success: false, error: msg, logs });
  }
});

// הזזת לוגו לפינה אחרת
app.post('/apply-logo', async (req, res) => {
  try {
    const { noLogoFile, position } = req.body;
    if (!noLogoFile || !position) return res.status(400).json({ success: false, error: 'חסרים פרמטרים' });

    const noLogoPath = path.join(GENERATED_DIR, noLogoFile);
    if (!fs.existsSync(noLogoPath)) return res.status(404).json({ success: false, error: 'קובץ לא נמצא' });

    const imageBuffer    = fs.readFileSync(noLogoPath);
    const withLogoBuffer = await applyLogoToImage(imageBuffer, position);

    const newFile = `img_${Date.now()}_${position}.png`;
    fs.writeFileSync(path.join(GENERATED_DIR, newFile), withLogoBuffer);

    res.json({ success: true, withLogoFile: newFile, withLogoUrl: `/generated/${newFile}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// העלאת תמונה מהמשתמש (עריכת מאמר) + הוספת לוגו
app.post('/upload-edit-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'קובץ חסר' });

    const rawBuffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);

    // המרה ל-PNG (תומך ב-JPG/PNG/WEBP וכו')
    const pngBuffer = await sharp(rawBuffer).png().toBuffer();

    const ts          = Date.now();
    const noLogoFile  = `img_${ts}_clean.png`;
    const withLogoFile = `img_${ts}_logo.png`;
    fs.writeFileSync(path.join(GENERATED_DIR, noLogoFile),  pngBuffer);

    const withLogoBuffer = await applyLogoToImage(pngBuffer, 'bottom-left');
    fs.writeFileSync(path.join(GENERATED_DIR, withLogoFile), withLogoBuffer);

    res.json({
      success: true,
      noLogoFile,
      withLogoFile,
      noLogoUrl:   `/generated/${noLogoFile}`,
      withLogoUrl: `/generated/${withLogoFile}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// העלאת תמונה שנוצרה לוורדפרס
app.post('/upload-generated', requireAdmin, async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ success: false, error: 'שם קובץ חסר' });

    const filePath = path.join(GENERATED_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'קובץ לא נמצא' });

    addLog(`מעלה תמונה שנוצרה לוורדפרס: ${filename}`);
    const imageBuffer = fs.readFileSync(filePath);

    const response = await axios.post(
      `${process.env.WP_URL}/wp-json/wp/v2/media`,
      imageBuffer,
      {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'image/png'
        },
        auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }
      }
    );

    addLog(`תמונה הועלתה לוורדפרס. מזהה: ${response.data.id}`);
    res.json({ success: true, mediaId: response.data.id, logs });
  } catch (error) {
    addLog(`שגיאה בהעלאת תמונה שנוצרה: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});
// רשימת תמונות שנוצרו לאחרונה (ללא לוגו)
app.get('/recent-images', requireAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(GENERATED_DIR)
      .filter(f => f.endsWith('_clean.png'))
      .map(f => ({
        filename: f,
        url: `/generated/${f}`,
        time: fs.statSync(path.join(GENERATED_DIR, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 6); // 6 אחרונות
    res.json({ success: true, images: files });
  } catch(e) {
    res.json({ success: true, images: [] });
  }
});
// ────────────────────────────────────────────────────────────────────────────

// ─── English Article Feature ─────────────────────────────────────────────────

const EN_TRANSLATION_SYSTEM = `You are a professional Hebrew-to-English translator specializing in Israeli political and cultural commentary for an English-speaking audience.

Translate the Hebrew WhatsApp article below to English with these EXACT rules:

1. FIRST LINE: Keep "Title / Author Name" format. If a phone number appears in parentheses after the author name, rewrite as: Name (For comments: NUMBER). Example: "Signs in Jerusalem / Yaakov Cohen (For comments: 050-1234567)"

2. SECTION LETTERS: Convert Hebrew letters to English — א→A, ב→B, ג→C, ד→D, ה→E, ו→F, ז→G, ח→H, ט→I, י→J, כ→K, ל→L

3. BOLD: Keep asterisks as-is — *bold text* stays *bold text*

4. LINKS BLOCK: Place this block BETWEEN the first line (title/author) and the article body. Each element separated by a blank line:

[blank line]
For more articles: www.solelim-derech.co.il
[blank line]
To join the group: https://chat.whatsapp.com/LD5QhFlalkRDTbC3Y49QAt
[blank line]

Remove any other website or WhatsApp links that appear anywhere else in the text.

5. SIGNATURE: The last line of the article must be exactly:
'path pavers'
(with single quotes around it). Replace "סוללים דרך" or any similar Hebrew sign-off with this.

6. QUALITY: Write natural, flowing English — maintain the rhetorical style, persuasive tone, and literary quality of the original. Do not translate word-for-word.

7. SPACING: Preserve blank lines between paragraphs and sections exactly as in the original.

Return ONLY the translated text. No explanations, no preamble, no markdown.`;

// תרגום מאמר עברי לאנגלית
app.post('/translate-en', requireAdminOrEnglish, express.json(), async (req, res) => {
  logs = [];
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'Text required' });
    addLog('Translating Hebrew article to English...');
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: EN_TRANSLATION_SYSTEM,
        messages: [{ role: 'user', content: text.trim() }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );
    const translated = response.data.content[0].text.trim();
    addLog('Translation complete');
    res.json({ success: true, translated, logs });
  } catch (e) {
    addLog(`Translation error: ${e.message}`);
    res.status(500).json({ success: false, error: e.message, logs });
  }
});

const ENGLISH_AUTHORS = ['SOLELIM DERECH', 'Ezra Hyman', 'Itay Asman', 'Ben Yakov Sabo', 'Udi Ben Hamu'];

const HEBREW_TAGS_LIST = 'ימין ושמאל, דיפ סטייט, אליטות, מוצש וזכויותיהם של ישראל, גבורה, הפרוגרס, עסקת חטופים, מלחמת זהות, מלחמה, אחדות בעם ישראל, גיוס חרדים, ראש הממשלה, תקשורת, חירות מחשבה, תודעה היסטורית, תפיסות ביטחוניות, יהדות במרחב הציבורי, היסטוריה, חטופים, השב״כ, מערכת המשפט, מערכת הביטחון, מחאות קפלן, אחריות לאומית, החברה החרדית, הרבעון הרביעי, דמוקרטיה, הנהגת המדינה, עיצוב תודעה, מחנה הימין, שליטה במקורות הכוח, תפיסות מוסריות, חירות, מנהיגות צבאית, ממשלה ואחריות, דתיים לאומיים, אחים לנשק, נפתלי בנט, דת ומדינה, ציבוריות וצבא, מוסר, אהוד ברק, מדיניות ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות החטופים, טראמפ, ליברליזם, ציונות דתית, תורת הרב קוק, רפורמה משפטית, עולם התורה, משפחות שכולות, קצר לפני שבת, תודעה ציבורית, בית המשפט, עברית, נבחרי ציבור, הסכמי אוסלו, תורת ישראל, עיתון הארץ, עופר וינטר, הנהגה יהודית, ערכים לאומיים, מלחמת תרבות, עוצמה לאומית, חינוך לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ 14, עיצוב זיכרון לאומי, זיכרון ותקומה, פוסטמודרניזם, השתקה, רוח צה"ל, מקצועיות בצבא, קבוצת השתייכות, אסטרטגיה';
const HEBREW_CATEGORIES_LIST = 'התיישבות, זהות יהודית, חינוך, לאומיות, משפטים, פוליטיקה, פילוסופיה, צבא וביטחון, תקשורת';

const ENGLISH_TAGS_LIST = 'Right and Left, Deep State, Elites, Rights of Israel, Heroism, The Progressives, Hostage Deal, Identity War, War, Jewish Unity, Haredi Conscription, Prime Minister, Media, Freedom of Thought, Historical Consciousness, Security Concepts, Judaism in the Public Sphere, History, Hostages, Shin Bet, Judicial System, Defense Establishment, Kaplan Protests, National Responsibility, Haredi Society, The Fourth Quarter, Democracy, State Leadership, Shaping Public Consciousness, The Right Wing Camp, Control of Power Sources, Moral Perceptions, Freedom, Military Leadership, Government and Accountability, Religious Zionists, Brothers in Arms, Naftali Bennett, Religion and State, Public Sphere and Military, Morality, Ehud Barak, Public Policy, IDF Chief of Staff, Islam, Attorney General, Hostage Families, Trump, Liberalism, Religious Zionism, Rabbi Kooks Teaching, Judicial Reform, Torah World, Bereaved Families, Short Before Shabbat, Public Consciousness, Supreme Court, Hebrew, Elected Officials, Oslo Accords, Torah of Israel, Haaretz Newspaper, Ofer Winter, Jewish Leadership, National Values, Culture War, National Power, Values Education, Hanukkah, The Conception, Hatred, Terror, Vision, Channel 14, Shaping National Memory, Memory and Revival, Postmodernism, Silencing, IDF Spirit, Military Professionalism, Group Identity, Strategy';
const ENGLISH_CATEGORIES_LIST = 'Settlement, Jewish Identity, Education, Nationalism, Law, Politics, Philosophy, Military and Security, Media';

// ניתוח מאמר אנגלי עם Claude
async function analyzeEnglishArticle(text) {
  addLog('Analyzing English article with Claude...');
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Analyze the following English article and return JSON only (no extra text, no explanations). Do NOT use double-quotes (") inside string values — use single quotes (') instead.

{
  "title": "article title",
  "author": "author name extracted from first line (after / or |), or empty string",
  "opening1": "one compelling English sentence (max 120 chars) that captures the core message — thought-provoking, not a technical description",
  "opening2": "two compelling English sentences (max 200 chars total) that expand on the core message",
  "topics": ["category1", "category2"],
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "quotes": ["verbatimQuote1", "verbatimQuote2", "verbatimQuote3"]
}

Topics — choose EXACTLY 2 from this list only, exact spelling:
${ENGLISH_CATEGORIES_LIST}

Tags — choose 4-6 from this list only, exact spelling, no hyphens between words:
${ENGLISH_TAGS_LIST}

Quotes — extract EXACTLY 3 verbatim sentences from the article body (1-2 sentences each, copied word-for-word, no changes).

The article:
${text}`
      }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );
  addLog('English analysis complete');
  const content = response.data.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');
  let jsonStr = jsonMatch[0];
  try { return JSON.parse(jsonStr); }
  catch (e) {
    jsonStr = jsonStr.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(jsonStr); }
    catch (e2) { throw new Error(`Invalid JSON: ${e2.message}`); }
  }
}

// פיצול טקסט ל-chunks לפי TTS (4000 תווים מקסימום)
function splitIntoTtsChunks(text, maxChars = 4000) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    const lastBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    const cutAt = lastBreak > maxChars * 0.6 ? lastBreak + 1 : maxChars;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// עיבוד מאמר אנגלי
app.post('/process-en', requireAdminOrEnglish, express.json(), async (req, res) => {
  logs = [];
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'Text required' });
    addLog('Processing English article...');

    const lines = text.trim().split('\n');
    const firstLine = lines[0] || '';
    const firstLineIsHtml = /<[a-zA-Z]/.test(firstLine);

    // Title/author extraction only applies to plain-text input format
    const slashIdx = firstLineIsHtml ? -1 : firstLine.search(/[/|\\]/);
    const titlePart  = firstLineIsHtml ? '' : (slashIdx !== -1 ? firstLine.slice(0, slashIdx) : firstLine).replace(/\*/g, '').trim();
    const authorPart = firstLineIsHtml ? '' : (slashIdx !== -1 ? firstLine.slice(slashIdx + 1).replace(/\(.*?\)/g, '').trim() : '');

    // If HTML input, include all lines as body; otherwise skip first line (title/author)
    let bodyLines = firstLineIsHtml ? lines : lines.slice(1);
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();

    // Normalize body: if HTML, strip tags but preserve bold markers first
    const rawBody = bodyLines.join('\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '*$1*')    // HTML bold → *bold*
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<blockquote[^>]*>|<\/blockquote>/gi, '')
      .replace(/<[^>]+>/g, '')                         // strip remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // הסרת שורות חתימה קבועות (לינקים, path pavers וכו')
    const footerPatterns = [
      /^\s*\(?for\s+comments\s*[:：]/i,
      /^\s*for\s+more\s+articles\s*[:：]/i,
      /^\s*to\s+join\s+the\s+group\s*[:：]/i,          // no $ — catches lines with URL on same line
      /^\s*https?:\/\/chat\.whatsapp\.com/i,            // WhatsApp URL on its own line
      /^\s*[''""]?path\s+pavers[''""]?\s*$/i,
      /^\s*www\.solelim/i,
    ];
    const filteredBody = rawBody
      .split('\n')
      .filter(line => !footerPatterns.some(re => re.test(line)))
      .join('\n');

    const cleanedText = filteredBody
      .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
      .replace(/\*/g, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\+\(]?\d[\d\s\-\(\)]{7,}\d/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const analysis = await analyzeEnglishArticle(text);
    if (!analysis.title) analysis.title = titlePart;
    if (!analysis.author) analysis.author = authorPart;

    // ודא שהכותב ברשימה, אחרת Solelim Derech
    const knownAuthor = ENGLISH_AUTHORS.find(a => a.toLowerCase() === (analysis.author || '').toLowerCase())
      || ENGLISH_AUTHORS.find(a => (analysis.author || '').toLowerCase().split(' ').some(word => word.length > 2 && a.toLowerCase().includes(word)));
    analysis.author = knownAuthor || 'SOLELIM DERECH';

    addLog(`English article ready: "${analysis.title}" by ${analysis.author}`);
    res.json({ success: true, analysis, cleanedText, logs });
  } catch (e) {
    addLog(`Error: ${e.message}`);
    res.status(500).json({ success: false, error: e.message, logs });
  }
});

// יצירת TTS ו-Buzzsprout upload
app.post('/generate-tts', requireAdminOrEnglish, express.json(), async (req, res) => {
  logs = [];
  try {
    const { title, authorName, articleText } = req.body;
    if (!articleText?.trim()) return res.status(400).json({ success: false, error: 'Article text required' });

    // הסרת HTML לטקסט נקי
    const plainText = articleText
      .replace(/<strong>(.*?)<\/strong>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // בניית סקריפט TTS
    const ttsScript = [
      title    ? `${title}.`            : '',
      authorName ? `Written by ${authorName}.` : '',
      '',
      plainText
    ].filter(s => s !== '').join('\n').trim();

    const chunks = splitIntoTtsChunks(ttsScript);
    addLog(`TTS: ${chunks.length} chunk(s), ${ttsScript.length} chars total`);

    const os = require('os');
    const tempFiles = [];

    // יצירת MP3 לכל chunk
    for (let i = 0; i < chunks.length; i++) {
      addLog(`Generating audio chunk ${i + 1}/${chunks.length}...`);
      const ttsRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        { model: 'tts-1-hd', voice: 'nova', input: chunks[i], response_format: 'mp3' },
        { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 120000 }
      );
      const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}-${i}.mp3`);
      fs.writeFileSync(tmpFile, Buffer.from(ttsRes.data));
      tempFiles.push(tmpFile);
    }

    let finalFile;
    if (tempFiles.length === 1) {
      finalFile = tempFiles[0];
    } else {
      // שרשור כל ה-chunks ל-MP3 אחד
      finalFile = path.join(os.tmpdir(), `tts-${Date.now()}-final.mp3`);
      const listFile = path.join(os.tmpdir(), `tts-list-${Date.now()}.txt`);
      fs.writeFileSync(listFile, tempFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listFile)
          .inputOptions(['-f concat', '-safe 0'])
          .audioCodec('copy')
          .on('end', resolve)
          .on('error', reject)
          .save(finalFile);
      });
      fs.unlinkSync(listFile);
      tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    }

    addLog(`TTS audio ready: ${Math.round(fs.statSync(finalFile).size / 1024)}KB`);

    // שמור עותק זמני להורדה ישירה (נמחק אחרי 30 דקות)
    const tempDir = path.join(__dirname, 'public', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempFileName = `tts-${Date.now()}.mp3`;
    const tempPublicPath = path.join(tempDir, tempFileName);
    fs.copyFileSync(finalFile, tempPublicPath);
    setTimeout(() => { try { fs.unlinkSync(tempPublicPath); } catch {} }, 30 * 60 * 1000);

    addLog('Uploading to Buzzsprout...');
    const buzzData = await uploadToBuzzsprout(finalFile, title || 'English Article');
    fs.unlinkSync(finalFile);

    addLog(`Buzzsprout episode ready: ${buzzData.id}`);
    res.json({ success: true, episodeId: String(buzzData.id), audioUrl: buzzData.audio_url, podcastId: process.env.BUZZSPROUT_PODCAST_ID, tempDownloadUrl: `/temp/${tempFileName}`, logs });
  } catch (e) {
    addLog(`TTS error: ${e.message}`);
    res.status(500).json({ success: false, error: e.message, logs });
  }
});

// פרסום מאמר אנגלי לוורדפרס
app.post('/publish-en', requireAdminOrEnglish, express.json(), async (req, res) => {
  logs = [];
  try {
    const { title: rawTitle, content, excerpt, date, tags, topics, authorName, featuredMediaId } = req.body;

    // הסרת סימן שאלה/קריאה מסוף הכותרת (נראה רע באתר עברי RTL)
    const title = (rawTitle || '').replace(/[?!]+$/, '').trim();

    // עטיפת תוכן ב-LTR ופונט אנגלי
    const wrappedContent = `<div dir="ltr" style="text-align:left;font-family:Georgia,'Times New Roman',serif;line-height:1.8;">${content}</div>`;

    const status = process.env.DEV_MODE === 'true' ? 'draft' : 'future';
    const tagIds      = tags?.length   ? await getOrCreateTermIds(tags, 'tags') : [];
    const categoryIds = topics?.length ? await getOrCreateTermIds(topics.slice(0, 2), 'categories') : [];

    // הוספת קטגוריה "English" (מחוץ לרשימה הסגורה)
    try {
      const engSearch = await axios.get(`${process.env.WP_URL}/wp-json/wp/v2/categories?search=English`,
        { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD } });
      let engCat = engSearch.data.find(c => c.name === 'English');
      if (!engCat) {
        const created = await axios.post(`${process.env.WP_URL}/wp-json/wp/v2/categories`, { name: 'English' },
          { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD } });
        engCat = created.data;
        addLog('Created "English" category in WordPress');
      }
      categoryIds.push(engCat.id);
    } catch (e) { addLog(`Could not add English category: ${e.message}`); }

    const authorId = authorName ? await findAuthorId(authorName) : null;

    const postData = { title, content: wrappedContent, excerpt: excerpt || '', status, date, tags: tagIds, categories: categoryIds };
    if (authorId)      postData.author         = authorId;
    if (featuredMediaId) postData.featured_media = featuredMediaId;

    const postRes = await axios.post(`${process.env.WP_URL}/wp-json/wp/v2/posts`, postData,
      { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD } });

    addLog(`English article published! ID: ${postRes.data.id}`);
    res.json({ success: true, result: { id: postRes.data.id, link: postRes.data.link }, logs });
  } catch (e) {
    addLog(`Error publishing: ${e.message}`);
    res.status(500).json({ success: false, error: e.message, logs });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('שגיאה לא מטופלת:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejection לא מטופל:', err?.message || err);
});