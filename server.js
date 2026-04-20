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
  'solelim': 'solelim'
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
- כתיב תקני: זהותנו (לא זהותינו), ודאי (לא וודאי), לזהותנו ולאחדותנו (לא ולאחדותנו)
- כתיב מלא/חסר לפי הכתיב התקני
- הוספת "האם" בשאלות שאינן נפתחות במילת שאלה
- גרשיים במילים מיודעות: 'המושג' → ה'מושג'
- גרשיים סביב מונחים מוגדרים בהקשר מושגי: המושג מגדר → המושג 'מגדר'
- החלפת "ש" כתחלית יחסית ב-"ה" כאשר הדבר אפשרי דקדוקית ומשפר את הסגנון: "שגוזרים קופון" → "הגוזרים קופון", "שמבקש לפרק את המוסדות" → "המבקש לפרק את המוסדות". כלל עזר: אם אפשר להחליף את ש+פועל ב-ה+פועל מבלי לשבור את המשפט — עדיף לעשות זאת.
- אין לתקן לשון מקרא

טיפול בשורה הראשונה:
- אם השורה הראשונה מכילה "/" — מה שלפני ה-/ הוא הכותרת, מה שאחריו הוא שם הכותב/טלפון. הגה את הכותרת בלבד, השאר את שם הכותב כפי שהוא ואת ה-/ במקומו.

טיפול בשורה האחרונה:
- אם השורה האחרונה (או אחת השורות האחרונות) מכילה רק את המילים "סוללים דרך" — עם או בלי נקודה, גרש, כוכבית או סמלים אחרים — מחק שורה זו לחלוטין. חתימה זו תתווסף באופן אוטומטי לאחר מכן.

חובה לשמור:
- מבנה שורות ורווחים זהה למקור לחלוטין (למעט השורה שנמחקה כנ"ל)
- כוכביות (*) במקומן המדויק — אין להזיז, למחוק או להוסיף
- סגנון הכותב

החזר את הטקסט המתוקן בלבד, ללא הסברים.`;

// ─── נרמול רווחים במאמרים ממוספרים ──────────────────────────────────────────
// רק אם יש לפחות 2 שורות שמתחילות באות עברית / ספרה כסמן פסקה —
// מוחק שורה ריקה שבאה מיד אחרי הסמן, וקורס שורות ריקות כפולות לאחת.
// אם אין מבנה כזה — מחזיר את השורות ללא שינוי.
function normalizeStructuredSpacing(lines) {
  // סמן פסקה: שורה שמתחילה ב-א-ת, *, -, 1-99 (ואחריהם . ) : רווח)
  const markerRe = /^[אבגדהוזחטיכלמנסעפצקרשת][.):\s*]|^\*?[אבגדהוזחטיכלמנסעפצקרשת][.):\s]|^\d{1,2}[.):\s]/;
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
  editJobs.set(jobId, { status: 'pending', createdAt: Date.now() });
  res.json({ success: true, jobId }); // חוזר מיד ללקוח

  // עבודה ברקע – ללא מגבלת זמן HTTP
  (async () => {
    try {
      const proofRes = await axios.post(
        'https://api.anthropic.com/v1/messages',
        { model: 'claude-haiku-4-5-20251001', max_tokens: 4000, system: PROOFREADING_SYSTEM,
          messages: [{ role: 'user', content: text }] },
        { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 180000 }
      );
      const correctedText = proofRes.data.content[0].text.trim();
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
  if (!job || job.status === 'pending') return res.json({ done: false });
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
        max_tokens: 200,
        system: `אתה כותב כותרות לתוכן ישראלי-לאומי. הכותרות שלך חדות, מעוררות סקרנות ומושכות לקרוא — לא סיכומים.

כללים:
- עד 6 מילים בכותרת
- לא לסכם את הטקסט — לעורר שאלה, מתח או תובנה חדה
- שפה ישירה, פעילה, לא אקדמית
- אפשר להשתמש בניגוד, פרדוקס, שאלה רטורית, או אמירה נועזת
- אסור להתחיל ב"כיצד", "מדוע", "על", "הסיפור של"
- הכותרת צריכה לגרום לאדם לעצור ולקרוא`,
        messages: [{
          role: 'user',
          content: `כתוב 2 כותרות חזקות ומושכות למאמר הזה. שונות לחלוטין מהכותרת המקורית: "${originalTitle}".
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

לגבי התגיות (tags) - בחר 4 עד 6 תגיות מהרשימה הבאה. השתמש בניסוח המדויק כפי שמופיע ברשימה — כולל מקפים היכן שיש. רק אם אין תגית מתאימה בכלל — אפשר ליצור אחת חדשה (ללא מקפים):
ימין ושמאל, דיפ-סטייט, אליטות, מוצש-וזכויותיהם-של-ישראל, גבורה, הפרוגרס, עסקת-חטופים, מלחמת-זהות, מלחמה, אחדות-בעם-ישראל, גיוס-חרדים, ראש-הממשלה, תקשורת, חירות-מחשבה, תודעה-היסטורית, תפיסות-ביטחוניות, יהדות-במרחב-הציבורי, היסטוריה, חטופים, השב״כ, מערכת-המשפט, מערכת-הביטחון, מחאות-קפלן, אחריות-לאומית, החברה-החרדית, הרבעון-הרביעי, דמוקרטיה, הנהגת-המדינה, עיצוב-תודעה, מחנה-הימין, שליטה-במקורות-הכוח, תפיסות-מוסריות, חירות, מנהיגות-צבאית, ממשלה-ואחריות, דתיים-לאומיים, אחים-לנשק, נפתלי-בנט, דת-ומדינה, ציבוריות-וצבא, מוסר, אהוד-ברק, מדיניות-ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות-החטופים, טראמפ, ליברליזם, ציונות-דתית, תורת-הרב-קוק, רפורמה-משפטית, עולם-התורה, משפחות-שכולות, קצר-לפני-שבת, תודעה-ציבורית, בית-המשפט, עברית, נבחרי-ציבור, הסכמי-אוסלו, תורת-ישראל, עיתון-הארץ, עופר-וינטר, הנהגה-יהודית, ערכים-לאומיים, מלחמת-תרבות, עוצמה-לאומית, חינוך-לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ-14, עיצוב-זיכרון-לאומי, זיכרון-ותקומה, פוסטמודרניזם, השתקה, רוח-צה"ל, מקצועיות-בצבא, קבוצת-השתייכות, אסטרטגיה

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
    const user = res.data.find(u => u.name === name) || res.data[0];
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
app.post('/upload-image', requireAdmin, upload.single('image'), async (req, res) => {
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
app.post('/approve', requireAdmin, async (req, res) => {
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

// ─── יצירת תמונה שנייה עם DALL-E סגנון שונה ────────────────────────────────
async function generateDalleVariant(prompt, style) {
  const dalleRes = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model: 'dall-e-3', prompt, size: '1024x1024', quality: 'hd', style, n: 1, response_format: 'url' },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const imgRes = await axios.get(dalleRes.data.data[0].url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(imgRes.data);
}

// ─── מדריך הנדסת פרומפטים — שני סגנונות ────────────────────────────────────
const PROMPT_ENGINEER_SYSTEM = `You are a world-class AI image prompt engineer specializing in cinematic, realistic, and editorial-quality imagery.

Your task is to generate TWO high-quality image prompts from any user input.

IMPORTANT GOAL:
Avoid the typical "AI-generated" look.
Strive for natural, believable, photographic or editorial results.

---

OUTPUT:

1. Prompt A — Cinematic Realism (PRIMARY, most important)
2. Prompt B — Natural Artistic (subtle stylization, NOT digital-looking)

---

GLOBAL RULES (CRITICAL):

* Avoid overly glossy, plastic, or hyper-polished visuals
* Avoid exaggerated fantasy lighting unless explicitly requested
* Avoid "perfect symmetry" or artificial sharpness
* Prefer natural imperfections (grain, texture, subtle noise)
* Keep realism grounded in real-world physics
* Use references to real photography and cinema
* NEVER produce a "midjourney-style digital art look"

---

PROMPT A — CINEMATIC REALISM:

Style direction:

* looks like a real photograph or movie scene
* documentary / editorial / cinematic photography
* natural imperfections are GOOD

Structure:

A cinematic, highly realistic photograph of [SUBJECT],

captured in [REALISTIC ENVIRONMENT with grounded detail].

The scene includes natural elements such as [SUBTLE DETAILS: dust, movement, real-world objects].

Lighting is natural or cinematic but believable (golden hour, overcast sky, practical lights), creating a [REALISTIC MOOD].

Textures are authentic and slightly imperfect (skin texture, fabric wear, environmental detail, natural grain).

Shot using a real camera (e.g., 35mm or 85mm lens), with natural depth of field and slight motion realism.

Composition follows professional photography principles (rule of thirds, natural framing, candid feel).

Color grading is cinematic and restrained (not oversaturated, slightly muted or film-like tones).

Add subtle film grain, realistic contrast, editorial photography style.

Ultra-detailed, realistic, sharp but natural, cinematic quality.

---

PROMPT B — NATURAL ARTISTIC (NON-DIGITAL):

Style direction:

* artistic but NOT glossy AI
* can feel like:

  * high-end illustration
  * textured painting
  * editorial artwork
* still grounded and not "fantasy overload"

Structure:

A detailed artistic depiction of [SUBJECT],

set in [ENVIRONMENT with slightly enhanced but believable atmosphere].

The scene includes symbolic or emotional elements, but remains visually grounded.

Lighting is soft, moody, or dramatic but natural, enhancing depth without artificial glow.

Textures feel tactile and real (brush texture, grain, layered materials), avoiding digital smoothness.

Composition is expressive but balanced, with strong visual storytelling.

Color palette is controlled and mature (not neon, not oversaturated).

Style resembles high-end editorial illustration or cinematic concept art with realism influence.

Highly detailed, textured, refined, visually rich, professional quality.

---

ADAPTATION RULES:

* If the user input relates to Israel / Judaism / military / emotion → emphasize authenticity and emotional realism
* Prefer "real moment" over "epic fantasy"
* If dramatic → keep it believable, not exaggerated
* If symbolic → integrate subtly into reality

not AI-looking, not overly polished, not glossy, not plastic

---

ISRAELI-JEWISH IDENTITY RULES (never violate in either prompt):
- People: real Israelis — modest natural clothing, calm authentic expressions
- Jewish identity: subtle only (kippah, mezuzah, Shabbat candles) — never large central symbols
- Religious women: tichel or sheitel (NEVER hijab). Haredi men: black hat + black suit. Dati-leumi: knitted kippah
- Soldiers: IDF only (olive Israeli uniform). Flags: Israeli flag only
- No crosses, churches, crescents, mosques, or Arabic script
- NO text, letters, words, numbers, or symbols anywhere in the image

---

OUTPUT FORMAT (STRICT — output only the two prompts, nothing else):
Prompt A:
[full paragraph]

Prompt B:
[full paragraph]`;

// ─── סגנון קצר המצורף בסוף הפרומפט ─────────────────────────────────────────
const DALL_E_STYLE_SUFFIX = `

Ultra-detailed, high resolution, 8k, sharp focus, cinematic quality. Square 1:1 composition. Absolutely no text, letters, words, numbers, or symbols anywhere in the image.`;

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

// ─── הרחבה לשני פרומפטים מקצועיים (Prompt A + Prompt B) ────────────────────
async function expandToTwoPrompts(ideaEn) {
  try {
    const result = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o',
        messages: [
          { role: 'system', content: PROMPT_ENGINEER_SYSTEM },
          { role: 'user', content: `Create two professional DALL-E 3 prompts for this image concept:\n${ideaEn}` }
        ],
        max_tokens: 1200 },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const text = result.data.choices[0].message.content;
    const promptAMatch = text.match(/Prompt A:\s*([\s\S]+?)(?=\n\s*Prompt B:|$)/i);
    const promptBMatch = text.match(/Prompt B:\s*([\s\S]+?)$/i);
    const promptA = (promptAMatch ? promptAMatch[1].trim() : ideaEn) + DALL_E_STYLE_SUFFIX;
    const promptB = (promptBMatch ? promptBMatch[1].trim() : ideaEn) + DALL_E_STYLE_SUFFIX;
    return { promptA, promptB };
  } catch (e) {
    // fallback: אותו פרומפט לשניהם
    const fallback = ideaEn + DALL_E_STYLE_SUFFIX;
    return { promptA: fallback, promptB: fallback };
  }
}

// רעיונות לתמונה — שני שלבים: ניתוח מאמר → רעיונות תמונה
app.post('/image-ideas', async (req, res) => {
  try {
    const { text, direction } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

    // ── שלב 1: ניתוח המאמר ─────────────────────────────────────────────────
    addLog('שלב 1: מנתח את המאמר לעומק...');

    const analysisRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a thoughtful literary analyst. Read the article and produce a deep analysis that will later be used to generate visual images. Focus on: the core message and conclusion, the emotional tone, the key human moments or scenes described, the setting (time, place, context), and the underlying values or ideas the author conveys.`
          },
          {
            role: 'user',
            content: `Analyze this Hebrew article deeply. Extract what truly matters — the heart of what the author is saying, the emotions they evoke, the specific scenes or moments they describe, and the visual world this article lives in.

Return ONLY valid JSON:
{
  "summary": "סיכום בעברית של המסר המרכזי (2-3 משפטים)",
  "coreMessage": "The single most important idea or conclusion of the article (English)",
  "emotionalTone": "The dominant emotion or atmosphere (English)",
  "keyScenes": ["specific scene or moment 1", "specific scene or moment 2", "specific scene or moment 3"],
  "visualWorld": "Description of the physical/visual world this article inhabits — place, time, people, textures, light (English)",
  "underlyingValues": "The deeper values, themes, or ideas (English)"
}

Article:
${text.slice(0, 3000)}`
          }
        ],
        max_tokens: 800,
        response_format: { type: 'json_object' }
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const analysis = JSON.parse(analysisRes.data.choices[0].message.content);
    addLog('ניתוח הושלם, יוצר רעיונות תמונה...');

    // ── שלב 2: יצירת 4 רעיונות תמונה — סגנון שונה לכל אחד ─────────────────
    const ideasRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a visual concept designer AND DALL-E 3 prompt engineer for Israeli national-identity content.

Your task: generate 4 distinct visual concepts, each with two ready-to-use DALL-E 3 prompts.

CREATE 4 IDEAS — each in a different mandatory style:
1. Cinematic realism — looks like a real photograph or movie still
2. Digital painting — detailed illustrated scene, expressive color, painterly
3. Minimalist symbolic — one strong symbol, clean graphic composition
4. Surreal / dreamlike — unexpected juxtaposition, poetic visual metaphor

For EACH idea, write TWO full DALL-E 3 prompts:
- promptA: cinematic/photographic version of the idea (natural light, film grain, realistic)
- promptB: artistic/painterly version of the idea (textured, expressive, editorial illustration)

PROMPT WRITING RULES (apply to every prompt):
- Avoid AI-generated look, glossy, plastic, hyper-polished visuals
- No perfect symmetry or artificial sharpness
- Prefer natural imperfections: grain, texture, real-world detail
- Natural or dramatic but believable lighting
- Square 1:1 composition
- Absolutely no text, letters, numbers or symbols in the image
- Each prompt: ONE paragraph, 3-5 sentences, concrete and specific

ISRAELI-JEWISH VISUAL IDENTITY (never violate):
- Real Israelis, modest natural clothing, authentic expressions
- Jewish symbols: subtle only (kippah, mezuzah) — never dominant
- Religious women: tichel or sheitel (never hijab). Soldiers: IDF olive uniform only
- No crosses, crescents, mosques, Arabic text. Israeli flag only

OUTPUT — Return ONLY valid JSON:
{
  "ideas": [
    {
      "he": "כותרת קצרה בעברית (4-6 מילים)",
      "style": "Cinematic realism",
      "promptA": "A cinematic, highly realistic photograph of ...",
      "promptB": "A detailed artistic depiction of ..."
    },
    {
      "he": "כותרת קצרה בעברית (4-6 מילים)",
      "style": "Digital painting",
      "promptA": "...",
      "promptB": "..."
    },
    {
      "he": "כותרת קצרה בעברית (4-6 מילים)",
      "style": "Minimalist symbolic",
      "promptA": "...",
      "promptB": "..."
    },
    {
      "he": "כותרת קצרה בעברית (4-6 מילים)",
      "style": "Surreal",
      "promptA": "...",
      "promptB": "..."
    }
  ]
}`
          },
          {
            role: 'user',
            content: `Create 4 visual concepts (with full DALL-E prompts) for this article. Each must use a different style (Cinematic realism, Digital painting, Minimalist symbolic, Surreal).

ARTICLE ANALYSIS:
- Central theme: ${analysis.coreMessage}
- Emotional tone: ${analysis.emotionalTone}
- Key moments: ${analysis.keyScenes?.join(' | ')}
- Visual world: ${analysis.visualWorld}
- Underlying values: ${analysis.underlyingValues}
${direction ? `\nAUTHOR'S VISUAL DIRECTION: "${direction}" — all 4 ideas must align with this.\n` : ''}
Make each idea visually striking and memorable. Prefer strong metaphor over generic scenes. Write prompts that will produce non-AI-looking, natural, believable images.`
          }
        ],
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const result = JSON.parse(ideasRes.data.choices[0].message.content);
    addLog(`התקבלו ${result.ideas?.length || 0} רעיונות לתמונה`);
    res.json({ success: true, summary: analysis.summary, ideas: result.ideas, logs });
  } catch (error) {
    addLog(`שגיאה ברעיונות תמונה: ${error.response?.data?.error?.message || error.message}`);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message, logs });
  }
});

// יצירת תמונה — DALL-E 3 x2 (📷 קולנועי + 🎨 אמנותי)
app.post('/generate-image', async (req, res) => {
  try {
    const { ideaEn, ideaHe, summary, promptA: prebuiltA, promptB: prebuiltB } = req.body;
    if (!ideaEn && !prebuiltA) return res.status(400).json({ success: false, error: 'רעיון חסר' });

    let promptA, promptB;
    if (prebuiltA && prebuiltB) {
      // פרומפטים מוכנים מ-/image-ideas — ישר ל-DALL-E
      addLog('משתמש בפרומפטים מוכנים...');
      promptA = prebuiltA + DALL_E_STYLE_SUFFIX;
      promptB = prebuiltB + DALL_E_STYLE_SUFFIX;
    } else {
      // רעיון חופשי — מרחיב עם GPT-4o
      addLog('מרחיב רעיון לשני פרומפטים מקצועיים...');
      const expanded = await expandToTwoPrompts(ideaEn);
      promptA = expanded.promptA;
      promptB = expanded.promptB;
    }

    addLog('יוצר 📷 קולנועי-ריאליסטי ו-🎨 אמנותי-יצירתי במקביל...');
    const ts = Date.now();

    // הרץ שני סגנונות DALL-E במקביל: Prompt A natural + Prompt B vivid
    const [dalleSettled, geminiSettled] = await Promise.allSettled([
      generateDalleVariant(promptA, 'natural'),
      generateDalleVariant(promptB, 'vivid')
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
      addLog('📷 קולנועי-ריאליסטי — נשמר בהצלחה');
    } else {
      addLog(`📷 קולנועי נכשל: ${dalleSettled.reason?.message}`);
    }

    if (geminiSettled.status === 'fulfilled') {
      result.gemini = await saveImagePair(geminiSettled.value, 'gemini');
      addLog('🎨 אמנותי-יצירתי — נשמר בהצלחה');
    } else {
      addLog(`🎨 אמנותי נכשל: ${geminiSettled.reason?.message}`);
    }

    if (!result.dalle && !result.gemini) {
      return res.status(500).json({ success: false, error: 'שתי יצירות התמונה נכשלו', logs });
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