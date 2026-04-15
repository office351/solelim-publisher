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

app.use(basicAuth({
  users: { [process.env.APP_USER || 'admin']: process.env.APP_PASSWORD || 'changeme' },
  challenge: true,
  realm: 'solelim-publisher'
}));

const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

// ─── הגהה לשונית ────────────────────────────────────────────────────────────
const PROOFREADING_SYSTEM = `תפקידך:
אתה מגיה לשון עברית מקצועי.
עליך לבצע אך ורק תיקונים לשוניים ותחביריים, ללא שינוי סגנון, ללא שינוי ניסוחים, ללא הוספת או גריעת רעיונות, וללא ליטוש ספרותי שאינו מחויב.

המטרה:
להחזיר טקסט מתוקן, תקין, טבעי וברור, תוך שמירה מוחלטת על כוונת הכותב.

הנחיה מחייבת לביצוע שלבי הפעולה בפועל:
עליך לבצע את הפעימות הבאות בדיוק לפי סדרן, אך כל הפעימות הללו נעשות 'מאחורי הקלעים' ואסור להציג אותם למשתמש:
פעימה 1 בלבד, אחריה פעימה 2 בלבד, ולאחריה פעימה 3 בלבד.
אסור לדלג על פעימה.
אסור לבצע שתי פעימות באותו זמן.
אסור להניח הנחות או לקצר תהליך; עליך לבצע כל שלב ממשית.
בפעימה 1 אסור לבצע כל תיקון.
בפעימה 2 אסור לבצע איחוד או שינוי מבני.
בפעימה 3 אסור לבצע תיקונים חדשים.
רק לאחר השלמת כל פעימה במלואה מותר לעבור לפעימה הבאה.

אופן פעולה פנימי — בפעימות:

פעימה 1 – חלוקת הטקסט:
חלק את הטקסט למקטעים של כ־80–120 מילים.
אין לשנות דבר בשלב זה.

פעימה 2 – הגהה לשונית לפי הכללים הבאים:

תיקוני זכר ונקבה:
תקן כל התאמה שגויה בין נושא לפועל, בין נושא לתואר ובין נושא לשם עצם.

1א. תיקון כל מופעי ההתאמה לנושא:
יש לתקן כל הפניה עקיפה לנושא, גם אם אינה סמוכה לו.
לדוגמה: התפיסה… והשפעתו → והשפעתה.

תיקוני יחיד ורבים:
הם אמר → אמרו
הטענות מוצדק → מוצדקות

תיקוני כתיב תקני כולל כינויי קניין:
זהותינו → זהותנו
אחדותינו → אחדותנו
תפקידינו → תפקידנו
התלמידים שלנו → תלמידינו
הספרים שלנו → ספרינו

יש להתחשב בסגנון: אין לכפות צורה ספרותית על טקסט יומיומי.

שמירה על הצורה "בינינו":
אין לשנות אותה.

כללי כתיב מלא וחסר:
הוסף י או ו כנדרש לפי הכתיב התקני.
הסר י או ו מיותרות.

אין להכפיל ו בראש מילה:
וודאי → ודאי
ווכך → וכך
הכפלה מותרת באמצע מילה (למשל: בוודאי).

תיקון סדר מילות יחס:
לזהותנו ואחדותנו → לזהותנו ולאחדותנו
מן התורה והנביאים → מן התורה ומן הנביאים

הוספת "האם" בראש שאלה שאינה נפתחת במילת שאלה:
אפשר להמשיך? → האם אפשר להמשיך?
יש לכך סיבה? → האם יש לכך סיבה?

שמירה מוחלטת על מבנה השורות:
אין לחבר שורות.
אין למחוק שורות ריקות.
אין להעביר שורות למקום אחר.
אין לשנות רווחים בתחילת או סוף שורה.
הטקסט חייב לחזור במבנה חזותי זהה למקור.

שמירה על כוכביות:
אין להזיז, למחוק או להוסיף כוכביות.

ציטוטי פסוקים:
אין לתקן לשון מקרא.
יש לוודא התאמת הכתיב והסדר למקור בלבד.

פעימה 2 – הנחיות נוספות:

תיקון מיקום גרשיים במילים מיודעות:
כאשר מילה מיודעת מופיעה בתוך גרשיים או מרכאות, יש למקם את הגרשיים לאחר הא הידיעה.
דוגמאות:
'המושג' → ה'מושג'
'השוויון' → ה'שוויון'
'הפמיניזם' → ה'פמיניזם'

הוספת גרשיים סביב מילים המשמשות כמונחים מוגדרים:
יש להוסיף גרשיים סביב מילה כאשר ברור מן ההקשר שהיא שם של מושג.
המקרים שבהם חובה להוסיף גרשיים:

א. לאחר מילים המציינות הבחנה מושגית:
המושג מגדר → המושג 'מגדר'
הכינוי מגדר → הכינוי 'מגדר'

ב. לאחר ביטויים המסמנים שהמילה מוגדרת כמונח:
מה שמכונה מגדר → מה שמכונה 'מגדר'
לכנות מגדר בשם אחר → לכנות 'מגדר' בשם אחר

ג. אין להוסיף גרשיים אם ההקשר אינו מושגי:
המושג הזה חשוב
הכינוי שלו היה מעליב

פעימה 3 – איחוד הטקסט:
לאחר עיבוד כל המקטעים, חבר את כל המקטעים לטקסט אחד.
שמור על כל מבנה השורות והרווחים במדויק.
שמור על כל סימני ההדגשה.
אין להוסיף הערות, הסברים או תוספות.

ברירת מחדל בתשובה:
החזר למשתמש את הטקסט המתוקן בלבד.
ללא הסברים.
ללא מספור.
ללא גרסת "לפני ואחרי".`;

app.post('/edit-article', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

    addLog('מתחיל הגהה לשונית עם Claude...');
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        system: PROOFREADING_SYSTEM,
        messages: [{ role: 'user', content: text }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const correctedText = response.data.content[0].text.trim();
    addLog(`הגהה הושלמה. ${text.trim().length} → ${correctedText.length} תווים`);
    res.json({ success: true, correctedText, logs });
  } catch (error) {
    addLog(`שגיאה בהגהה: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
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

app.get('/groups', (req, res) => res.json(loadGroups()));

app.post('/groups', (req, res) => {
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
app.get('/logs', (req, res) => {
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

לגבי התגיות (tags) - בחר 4 עד 6 תגיות מהרשימה הבאה. השתמש בניסוח המדויק כפי שמופיע ברשימה. רק אם אין תגית מתאימה בכלל — אפשר ליצור אחת חדשה:
ימין ושמאל, דיפ-סטייט, אליטות, מוצש-וזכויותיהם-של-ישראל, גבורה, הפרוגרס, עסקת-חטופים, מלחמת-זהות, מלחמה, אחדות-בעם-ישראל, גיוס-חרדים, ראש-הממשלה, תקשורת, חירות-מחשבה, תודעה-היסטורית, תפיסות-ביטחוניות, יהדות-במרחב-הציבורי, היסטוריה, חטופים, השב"כ, מערכת-המשפט, מערכת-הביטחון, מחאות-קפלן, אחריות-לאומית, החברה-החרדית, הרבעון-הרביעי, דמוקרטיה, הנהגת-המדינה, עיצוב-תודעה, מחנה-הימין, שליטה-במקורות-הכוח, תפיסות-מוסריות, חירות, מנהיגות-צבאית, ממשלה-ואחריות, דתיים-לאומיים, אחים-לנשק, נפתלי-בנט, דת-ומדינה, ציבוריות-וצבא, מוסר, אהוד-ברק, מדיניות-ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות-החטופים, טראמפ, ליברליזם, ציונות-דתית, תורת-הרב-קוק, רפורמה-משפטית, עולם-התורה, משפחות-שכולות, קצר-לפני-שבת, תודעה-ציבורית, בית-המשפט, עברית, נבחרי-ציבור, הסכמי-אוסלו, תורת-ישראל, עיתון-הארץ, עופר-וינטר, הנהגה-יהודית, ערכים-לאומיים, מלחמת-תרבות, עוצמה-לאומית, חינוך-לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ-14, עיצוב-זיכרון-לאומי, זיכרון-ותקומה, פוסטמודרניזם, השתקה, רוח-צה"ל, מקצועיות-בצבא, קבוצת-השתייכות, אסטרטגיה

לגבי הציטוטים - בחר 3 משפטים שקיימים במאמר כמות שהם, באורך משפט אחד עד שניים לכל היותר. לא קטעים ארוכים.

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
app.post('/upload-image', upload.single('image'), async (req, res) => {
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
app.post('/update-episode', async (req, res) => {
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
app.get('/wp-users', async (req, res) => {
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
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
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
app.post('/process', upload.fields([
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
app.post('/publish', async (req, res) => {
  try {
    const result = await publishToWordPress(req.body);
    res.json({ success: true, result, logs });
  } catch (error) {
    addLog(`שגיאה בפרסום: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

// אישור ופרסום טיוטה
app.post('/approve', async (req, res) => {
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

async function applyLogoToImage(imageBuffer, position = 'bottom-left') {
  const img  = sharp(imageBuffer);
  const meta = await img.metadata();
  const size = meta.width; // תמיד מרובע

  const logoSize = Math.round(size * 0.10); // 10% מגודל התמונה
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
        messages: [{
          role: 'user',
          content: `נחלק את העבודה לשלבים:
א. קרא את המאמר הבא וכתוב את המסקנה המרכזית שלו בקיצור (משפט אחד-שניים בעברית).
ב. תן 4 רעיונות לתמונה מרובעת שמתאימה למאמר. כל רעיון — תיאור מדויק באנגלית לתמונה חזקה, מעניינת, פשוטה וללא טקסט.

החזר JSON בפורמט הבא בלבד, ללא הסברים:
{
  "summary": "סיכום קצר בעברית",
  "ideas": [
    {"he": "תיאור הרעיון בעברית", "en": "detailed image description in English for DALL-E"},
    {"he": "תיאור הרעיון בעברית", "en": "detailed image description in English for DALL-E"},
    {"he": "תיאור הרעיון בעברית", "en": "detailed image description in English for DALL-E"},
    {"he": "תיאור הרעיון בעברית", "en": "detailed image description in English for DALL-E"}
  ]
}

המאמר:
${text.slice(0, 3000)}`
        }],
        max_tokens: 1200,
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

    const prompt = `${ideaEn}. Square image, absolutely no text, no letters, no words, no symbols. Visually strong, simple, and powerful. ${summary ? 'Context: ' + summary : ''}`;

    const dalleRes = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        quality: 'standard',
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
app.post('/upload-generated', async (req, res) => {
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
app.get('/recent-images', (req, res) => {
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

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

process.on('uncaughtException', (err) => {
  console.error('שגיאה לא מטופלת:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejection לא מטופל:', err?.message || err);
});