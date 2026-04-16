require('dotenv').config({ override: true });
const express = require('express');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const fs = require('fs');
const path = require('path');
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
- אין לתקן לשון מקרא

חובה לשמור:
- מבנה שורות ורווחים זהה למקור לחלוטין
- כוכביות (*) במקומן המדויק — אין להזיז, למחוק או להוסיף
- סגנון הכותב

החזר את הטקסט המתוקן בלבד, ללא הסברים.`;

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
      const allLines = correctedText.split('\n');
      const firstLine = allLines[0];
      const slashIdx = firstLine.lastIndexOf('/');
      const originalTitle = (slashIdx !== -1 ? firstLine.slice(0, slashIdx) : firstLine).replace(/\*/g, '').trim();
      let bodyStart = 1;
      while (bodyStart < allLines.length && !allLines[bodyStart].trim()) bodyStart++;
      const body = allLines.slice(bodyStart).join('\n').trim();
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
        messages: [{
          role: 'user',
          content: `הצע 2 כותרות קצרות ומעניינות למאמר הבא (שונות מ: "${originalTitle}").
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

לגבי התגיות (tags) - בחר 4 עד 6 תגיות מהרשימה הבאה. השתמש בניסוח המדויק כפי שמופיע ברשימה, ללא מקפים. רק אם אין תגית מתאימה בכלל — אפשר ליצור אחת חדשה (גם ללא מקפים):
ימין ושמאל, דיפ סטייט, אליטות, גבורה, הפרוגרס, עסקת חטופים, מלחמת זהות, מלחמה, אחדות בעם ישראל, גיוס חרדים, ראש הממשלה, תקשורת, חירות מחשבה, תודעה היסטורית, תפיסות ביטחוניות, יהדות במרחב הציבורי, היסטוריה, חטופים, השב"כ, מערכת המשפט, מערכת הביטחון, מחאות קפלן, אחריות לאומית, החברה החרדית, דמוקרטיה, הנהגת המדינה, עיצוב תודעה, מחנה הימין, שליטה במקורות הכוח, תפיסות מוסריות, חירות, מנהיגות צבאית, ממשלה ואחריות, דתיים לאומיים, אחים לנשק, נפתלי בנט, דת ומדינה, ציבוריות וצבא, מוסר, אהוד ברק, מדיניות ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות החטופים, טראמפ, ליברליזם, ציונות דתית, תורת הרב קוק, רפורמה משפטית, עולם התורה, משפחות שכולות, קצר לפני שבת, תודעה ציבורית, בית המשפט, עברית, נבחרי ציבור, הסכמי אוסלו, תורת ישראל, עיתון הארץ, עופר וינטר, הנהגה יהודית, ערכים לאומיים, מלחמת תרבות, עוצמה לאומית, חינוך לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ 14, עיצוב זיכרון לאומי, זיכרון ותקומה, פוסטמודרניזם, השתקה, רוח צה"ל, מקצועיות בצבא, קבוצת השתייכות, אסטרטגיה

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

// תרגום רעיון אישי לאנגלית עבור DALL-E
app.post('/translate-idea', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea?.trim()) return res.status(400).json({ success: false, error: 'חסר רעיון' });
    const result = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 200,
        messages: [{ role: 'user', content: `Translate this Hebrew image idea to a detailed English prompt for DALL-E 3. The audience is Jewish-Israeli nationalist: no crosses/churches/crescents/mosques, religious women must look Jewish (tichel head covering), flags must be Israeli. Return only the English prompt:\n${idea}` }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 }
    );
    res.json({ success: true, en: result.data.content[0].text.trim() });
  } catch (error) {
    res.json({ success: true, en: req.body.idea }); // fallback: שלח עברית
  }
});

// רעיונות לתמונה
app.post('/image-ideas', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

    addLog('שולח מאמר ל-GPT-4o לקבלת רעיונות תמונה...');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert DALL-E 3 prompt engineer creating images for a Jewish-Israeli nationalist publication. Your images must be high-quality, visually striking, and culturally appropriate.

STRICT CULTURAL RULES — never violate these:
- The audience is Jewish and Israeli-nationalist. All imagery must reflect Jewish/Israeli identity.
- NEVER include crosses, churches, Christian iconography, or any Christian symbols.
- NEVER include crescents, mosques, Arabic script, or any Islamic symbols.
- If the image includes a HAREDI woman: long dark modest dress, hair fully covered with a sheitel (wig) or tight tichel, covered arms and legs. Never a hijab.
- If the image includes a DATI (religious-Zionist) woman: colorful mitpachat/tichel, modest but modern Israeli dress — NOT haredi black.
- If the image includes a HAREDI man: black suit, white dress shirt, black fedora hat (kapelush), beard — traditional Eastern European Jewish look.
- If the image includes a DATI (religious-Zionist) man: knitted kippah (kippah sruga), button-up shirt, modern Israeli casual-religious look — NOT a black hat.
- If the image includes soldiers or military: must be IDF (Israel Defense Forces) — olive/green Israeli military uniforms, Israeli military equipment, IDF insignia. NOT generic or American military.
- If a national flag appears, it must be the Israeli flag (blue Star of David on white) — never any other flag.
- Jewish symbols that are welcome: Menorah, Star of David, Israeli landscapes (Jerusalem, Kotel, Negev, Galilee), olive trees, pomegranates, wheat, Torah scrolls.
- The spirit of the images must reflect Jewish heritage, Israeli strength, national pride, and love of the land.

VISUAL QUALITY RULES:
- Be highly specific: describe lighting, color palette, composition, mood, and style.
- Use cinematic or fine-art language: "golden hour", "dramatic chiaroscuro", "shallow depth of field", "painterly texture".
- Each of the 4 ideas must use a DIFFERENT artistic style (e.g. photo-realistic, oil painting, watercolor, digital art).
- NEVER include text, letters, words, numbers, or symbols in the image.
- Make it square-composition friendly (1:1 ratio).
- Aim for powerful, emotionally resonant, publication-quality imagery.`
          },
          {
            role: 'user',
            content: `Read the article below and create 4 image ideas that visually represent its theme in the spirit of Jewish-Israeli national identity.

Return ONLY valid JSON:
{
  "summary": "סיכום בעברית במשפט אחד",
  "ideas": [
    {"he": "תיאור קצר בעברית", "en": "Highly detailed DALL-E 3 prompt in English"},
    {"he": "תיאור קצר בעברית", "en": "Highly detailed DALL-E 3 prompt in English"},
    {"he": "תיאור קצר בעברית", "en": "Highly detailed DALL-E 3 prompt in English"},
    {"he": "תיאור קצר בעברית", "en": "Highly detailed DALL-E 3 prompt in English"}
  ]
}

Article:
${text.slice(0, 3000)}`
          }
        ],
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
    addLog(`התקבלו ${result.ideas?.length || 0} רעיונות לתמונה`);
    res.json({ success: true, ...result, logs });
  } catch (error) {
    addLog(`שגיאה ברעיונות תמונה: ${error.response?.data?.error?.message || error.message}`);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message, logs });
  }
});

// יצירת תמונה עם DALL-E 3
app.post('/generate-image', async (req, res) => {
  try {
    const { ideaEn, ideaHe, summary } = req.body;
    if (!ideaEn) return res.status(400).json({ success: false, error: 'רעיון חסר' });

    addLog('יוצר תמונה עם DALL-E 3...');

    // הקדמה שמונעת מ-DALL-E לשכתב את הפרומפט (טריק ידוע)
    const prompt = `I NEED you to generate EXACTLY this image without any modifications or reinterpretation: ${ideaEn}. Square 1:1 composition. Absolutely no text, letters, words, numbers, or symbols anywhere in the image.`;

    const dalleRes = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        quality: 'hd',
        n: 1,
        response_format: 'url'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const imageUrl = dalleRes.data.data[0].url;
    addLog('תמונה נוצרה, מוריד ומוסיף לוגו...');

    // הורדת התמונה
    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const imageBuffer = Buffer.from(imgRes.data);

    // שמירת גרסה ללא לוגו
    const ts = Date.now();
    const noLogoFile   = `img_${ts}_clean.png`;
    const withLogoFile = `img_${ts}_logo.png`;
    const noLogoPath   = path.join(GENERATED_DIR, noLogoFile);
    const withLogoPath = path.join(GENERATED_DIR, withLogoFile);

    fs.writeFileSync(noLogoPath, imageBuffer);

    // שמירת גרסה עם לוגו שמאל-תחתון
    const withLogoBuffer = await applyLogoToImage(imageBuffer, 'bottom-left');
    fs.writeFileSync(withLogoPath, withLogoBuffer);

    addLog('שתי גרסאות התמונה מוכנות!');
    res.json({
      success: true,
      noLogoFile,
      withLogoFile,
      noLogoUrl:   `/generated/${noLogoFile}`,
      withLogoUrl: `/generated/${withLogoFile}`,
      ideaHe,
      logs
    });
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