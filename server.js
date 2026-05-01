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
// puppeteer נטען בצורה lazy בתוך הנתיב כדי שהשרת יעלה גם אם לא מותקן

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

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// מי אני — מחזיר את שם המשתמש הנוכחי
app.get('/api/me', (req, res) => {
  res.json({ username: req.auth ? req.auth.user : null });
});

// ─── הגהה לשונית ────────────────────────────────────────────────────────────
const PROOFREADING_SYSTEM = `אתה מגיה לשון עברית מקצועי. בצע תיקונים לשוניים ותחביריים בלבד — ללא שינוי סגנון, ניסוח, רעיונות או ליטוש ספרותי.

══ כללי תיקון ══

1. התאמות דקדוקיות
   א. מין — התאם נושא לפועל, לתואר ולשם עצם, גם כשאינם סמוכים:
      התפיסה והשפעתו→התפיסה והשפעתה
   ב. מספר — התאם נושא לפועל ולתארים:
      הם אמר→הם אמרו | הטענות מוצדק→הטענות מוצדקות

2. כתיב תקני (מלא/חסר) — הוסף/השמט י/ו לפי הכתיב התקני:
   מיסגרות→מסגרות | אומנות→אמנות | דוגמא→דוגמה | וודאי→ודאי
   ⚠ חריק מלא/חסר: אין להוסיף יו"ד כאשר אין חיריק מלא — יישובים→ישובים | אין להסיר יו"ד כשיש חיריק מלא.

3. כינויי קניין — העדף צורות מקוצרות תקניות:
   זהותינו→זהותנו | לזהותנו ואחדותנו→לזהותנו ולאחדותנו

4. מילים תקניות — תקן מילים שגויות או לא מתאימות להקשר:
   משטרה (בהקשר שלטוני)→משטר

5. כינוי גוף חסר (copula) — אם נושא שמני ונשוא שמני רצופים ללא פועל, הוסף הוא/היא/הם/הן:
   "שיטת משטרה אוליגרכיה"→"שיטת משטרה היא אוליגרכיה"
   "הצבא כלי"→"הצבא הוא כלי"

6. שאלות — הוסף "האם" כשאין מילת שאלה:
   אפשר להמשיך?→האם אפשר להמשיך?

7. פיסוק
   א. פסיקים — הוסף אחרי ביטויי פתיחה/הסגר והפסקות תחביריות:
      "בכך מבלי שאמרו דבר הם"→"בכך, מבלי שאמרו דבר, הם"
   ב. מקף מחבר (־) — הוסף בצירופים כבולים שאינם מילה אחת: כל יכול→כל-יכול.
      לעומת זאת, אל תוסיף מקף בצירופים שהם תקניים כמילה אחת ללא מקף: בלתי־פוסק→בלתי פוסק.
   ג. רווחים — פסיק/נקודה צמוד למילה לפניו, רווח אחריו בלבד.

8. החלפת "ש" כתחלית ב-"ה" כשאפשרי דקדוקית:
   "שמבקש לפרק"→"המבקש לפרק" | "שגוזרים קופון"→"הגוזרים קופון"

9. סמיכות ויידוע — ה"א הידיעה במקום הנכון בלבד בצירופי סמיכות.

10. צורות נטייה — השתמש בצורות פועל ושם תקינות לפי כללי הדקדוק.

11. ביטויים כבולים — השתמש בצורה התקנית של ביטויים קבועים בעברית.

12. כינוי יחס ללא 'ש' — כשמשפט שם-עצמי (relative clause) מחובר לשם-עצם באמצעות מילת יחס או כינוי גוף, חובה להוסיף 'ש' לפני מילת היחס/הכינוי:
    הצורות הנפוצות: בו/בה/בהם/בהן | אותו/אותה/אותם/אותן | עליו/עליה | ממנו/ממנה | לו/לה | אליו/אליה | בגינו/בגינה | דרכו/דרכה
    דוגמאות:
      "התיקון בו עלינו להתמיד" → "התיקון שבו עלינו להתמיד"
      "ועדה אותה ימנה השופט" → "ועדה שאותה ימנה השופט"
      "האיש ממנו קיבלתי" → "האיש שממנו קיבלתי"
      "הסיבה בגינה נדחה" → "הסיבה שבגינה נדחה"
      "הדרך בה הלכנו" → "הדרך שבה הלכנו"
    ⚠ חריג: "שלו/שלה/שלהם" (כינויי שייכות) — אינם relative clause, אין לשנות.

══ כללי גרש ══

גרש יחיד (׳) = מושגים, ביטויים ומונחים. גרשיים (״) = ציטוט ישיר של דברי אנשים בלבד.
⚠ אחידות: הקפד על שיטה אחת לאורך כל המאמר — אין לערבב גרש יחיד עם גרשיים באותה פונקציה.
סימון מושג מוגדר: המושג מגדר→המושג ׳מגדר׳

▸ כלל א — מילית יחס לפני גרש:
NEVER write: לה׳...׳ / בה׳...׳ / מה׳...׳ / כה׳...׳
ה"א נבלעת במילית היחס ונמחקת לחלוטין.
   לה'ברית היהודית'→ל'ברית היהודית' | בה'שמאל'→ב'שמאל' | מה'ימין'→מ'ימין'

▸ כלל ב — ה"א הידיעה עם גרש יחיד (מושגים ומונחים בלבד):
NEVER write ׳ה...׳ (ה"א כאות ראשונה בתוך גרש יחיד). הוצא ה"א לפני הגרש, מחק מבפנים.
הכלל חל על מושגים ומונחים (גרש יחיד) — לא על ציטוטים (גרשיים).
   'הרעיון'→ה'רעיון' | 'הברית היהודית'→ה'ברית היהודית' | 'הדמוקרטיה'→ה'דמוקרטיה' | 'המושג'→ה'מושג'

▸ כלל ג — כפילות ה"א:
NEVER write ה׳ה...׳ (שתי ה"א). השאר אחת מחוץ, מחק מבפנים.
   ה'הברית'→ה'ברית' | ה'הימין'→ה'ימין'

══ שורה ראשונה ══
אם מכילה "/" — הגה כותרת בלבד; שם הכותב והסלאש — אל תיגע.

══ שורה אחרונה ══
אם מכילה רק "סוללים דרך" (עם/בלי סמלים) — מחק שורה זו לחלוטין.

══ חובה לשמור ══
- מספר השורות הריקות בין פסקאות חייב להיות זהה בדיוק למקור — אין להוסיף שורות ריקות
- סדר שורות, מבנה פסקאות, כוכביות (*) — אין לשנות מיקום
- קישורים (URLs) — בדיוק כפי שהם, ללא שינוי או מחיקה
- פעלים בבנייני פועל/הופעל/נפעל: יצוין, הוזכר, נאמר — תקינים, אין לשנות
- לשון מקרא — אין לתקן
- סגנון הכותב — אין לשנות ניסוח, רק לתקן שגיאות

החזר את הטקסט המתוקן בלבד, ללא הסברים.`;

// ─── שמירת מבנה שורות ריקות מהמקור על הפלט המתוקן ───────────────────────────
// מפרק שני טקסטים לרצפי שורות-תוכן + מספר שורות ריקות לפניהן,
// ואם מספר השורות שווה — מיישם את דפוס הרווחים של המקור על הפלט.
function matchBlankLines(original, proofed) {
  const parse = text => {
    const segs = [];
    let blanks = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) { blanks++; }
      else { segs.push({ line, blanks }); blanks = 0; }
    }
    return segs;
  };
  const origSegs  = parse(original);
  const proofSegs = parse(proofed);
  // אם מספר השורות שונה (המודל איחד/פיצל) — פשוט כווץ 3+ ריקות ל-2
  if (origSegs.length !== proofSegs.length)
    return proofed.replace(/\n{3,}/g, '\n\n');
  // יישם את מספר השורות הריקות מהמקור על כל שורת-תוכן בפלט
  return proofSegs.map((seg, i) =>
    (origSegs[i].blanks > 0 ? '\n'.repeat(origSegs[i].blanks) : '') + seg.line
  ).join('\n');
}

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
  let prevBlank  = false;
  let prevMarker = false;

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

// שלב 1: הגהה לשונית – סינכרוני (ממתין לתשובה, אין polling)
app.post('/edit-stage1', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

  try {
      // פיצול לחלקים לפי פסקאות — כל חלק עד 5000 תווים
      const CHUNK_SIZE = 5000;
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
      console.log(`[הגהה] מתחיל ${chunks.length} חלקים, סה"כ ${text.length} תווים`);
      const proofedChunks = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const tStart = Date.now();
        console.log(`[הגהה] מגיה חלק ${ci + 1} מתוך ${chunks.length}…`);
        const maxTok = Math.min(Math.ceil(chunk.length / 1.3) + 800, 8000);
        console.log(`[הגהה] חלק ${ci + 1}: ${chunk.length} תווים, maxTok=${maxTok}`);
        try {
          const proofRes = await withTimeout(
            axios.post(
              'https://api.anthropic.com/v1/messages',
              { model: 'claude-haiku-4-5-20251001', max_tokens: maxTok, system: PROOFREADING_SYSTEM,
                messages: [{ role: 'user', content: chunk }] },
              { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 90000 }
            ),
            85000
          );
          console.log(`[הגהה] חלק ${ci + 1} הושלם תוך ${((Date.now()-tStart)/1000).toFixed(1)}s`);
          // שמור על מבנה השורות הריקות של המקור בדיוק
          const proofedText = matchBlankLines(chunk, proofRes.data.content[0].text.trim());
          proofedChunks.push(proofedText);
        } catch (chunkErr) {
          console.error(`[הגהה] חלק ${ci + 1} נכשל אחרי ${((Date.now()-tStart)/1000).toFixed(1)}s: ${chunkErr.message}`);
          throw chunkErr;
        }
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
      res.json({ success: true, correctedText, originalTitle, body,
        siteUrl: process.env.SITE_URL || process.env.WP_URL || '' });
    } catch (error) {
      console.error('[הגהה] שגיאה:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
});

// תאימות לאחור — poll לא נדרש יותר אבל נשאר כדי לא לשבור גרסאות ישנות
app.get('/edit-poll/:jobId', (req, res) => {
  res.json({ done: true, success: false, error: 'polling לא בשימוש — נא לרענן את הדף.' });
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

══ תקינות לשונית — חובה מוחלטת ══
דקדוק:
- התאמת זכר/נקבה, יחיד/רבים בין כל מילות הכותרת
- כינויי קניין: זהותנו (לא זהותינו), עמנו (לא עמינו), ביתנו (לא ביתינו)
- כינוי גוף חסר: "הצבא כלי" → "הצבא הוא כלי"; "השלטון שחיתות" → "השלטון הוא שחיתות"
- שאלות: "האם" מופיעה כשצריך
- מקף כפול (—) ולא מינוס כשמפרידים

כתיב תקני:
- וודאי → ודאי | דוגמא → דוגמה | בכלל לא → כלל לא (כשמשמעות "לא בשום אופן")
- להשתמש ב-ה' השאלה במקום "האם" כשמתאים: "האמת ידועה?" ולא "האם האמת ידועה?"
- גרש (׳) מותר רק לקיצורים מקובלים (צה"ל, ד"ר, מ"מ) — אסור לעטוף בו מילים שלמות

בדיקה לפני שליחה:
1. קרא את הכותרת בקול — האם היא זורמת ותקינה?
2. בדוק התאמת מין ומספר של כל זוג מילים סמוכות
3. האם כל מילה הכרחית? אם לא — מחק

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
  "quotes": ["ציטוט1", "ציטוט2", "ציטוט3", "ציטוט4"]
}

לגבי הקטגוריות (topics) - בחר בדיוק 2 מהרשימה הבאה בלבד. אל תוסיף קטגוריות חדשות, אל תשנה את הניסוח, אל תוסיף מקפים:
התיישבות, זהות יהודית, חינוך, לאומיות, משפטים, פוליטיקה, פילוסופיה, צבא וביטחון, תקשורת

לגבי התגיות (tags) - בחר 4 עד 6 תגיות מהרשימה הבאה. חובה לבחור מהרשימה — אין ליצור תגיות חדשות אלא אם אין שום תגית מתאימה ברשימה כולה (מקרה נדיר ביותר). השתמש בניסוח המדויק כפי שמופיע ברשימה, ללא מקפים:
ימין ושמאל, דיפ סטייט, אליטות, מוצש וזכויותיהם של ישראל, גבורה, הפרוגרס, עסקת חטופים, מלחמת זהות, מלחמה, אחדות בעם ישראל, גיוס חרדים, ראש הממשלה, תקשורת, חירות מחשבה, תודעה היסטורית, תפיסות ביטחוניות, יהדות במרחב הציבורי, היסטוריה, חטופים, השב״כ, מערכת המשפט, מערכת הביטחון, מחאות קפלן, אחריות לאומית, החברה החרדית, הרבעון הרביעי, דמוקרטיה, הנהגת המדינה, עיצוב תודעה, מחנה הימין, שליטה במקורות הכוח, תפיסות מוסריות, חירות, מנהיגות צבאית, ממשלה ואחריות, דתיים לאומיים, אחים לנשק, נפתלי בנט, דת ומדינה, ציבוריות וצבא, מוסר, אהוד ברק, מדיניות ציבורית, הרמטכ"ל, אסלאם, היועמשית, משפחות החטופים, טראמפ, ליברליזם, ציונות דתית, תורת הרב קוק, רפורמה משפטית, עולם התורה, משפחות שכולות, קצר לפני שבת, תודעה ציבורית, בית המשפט, עברית, נבחרי ציבור, הסכמי אוסלו, תורת ישראל, עיתון הארץ, עופר וינטר, הנהגה יהודית, ערכים לאומיים, מלחמת תרבות, עוצמה לאומית, חינוך לערכים, חנוכה, הקונספציה, שנאה, טרור, חזון, ערוץ 14, עיצוב זיכרון לאומי, זיכרון ותקומה, פוסטמודרניזם, השתקה, רוח צה"ל, מקצועיות בצבא, קבוצת השתייכות, אסטרטגיה

לגבי הציטוטים - בחר 4 משפטים שקיימים במאמר כמות שהם, באורך משפט אחד עד שניים לכל היותר. לא קטעים ארוכים.
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

// העלאת מדיה כללית (תמונה / סרטון) לוורדפרס — מחזיר url + mediaId
app.post('/upload-media', requireAdmin, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'לא נשלח קובץ' });
    const buffer = fs.readFileSync(req.file.path);
    const response = await axios.post(
      `${process.env.WP_URL}/wp-json/wp/v2/media`,
      buffer,
      {
        headers: {
          'Content-Disposition': `attachment; filename="${req.file.originalname}"`,
          'Content-Type': req.file.mimetype,
        },
        auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    fs.unlinkSync(req.file.path);
    res.json({ success: true, mediaId: response.data.id, url: response.data.source_url, mimeType: req.file.mimetype });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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


// ─── יצירת תמונה — Grok (xAI Aurora) עם fallback ל-gpt-image-1 ──────────────
async function generateDalleVariant(prompt, _style) {
  // נסה Grok קודם אם יש מפתח
  if (process.env.XAI_API_KEY) {
    try {
      addLog('🤖 שולח ל-Grok (xAI)...');
      const xaiRes = await axios.post(
        'https://api.x.ai/v1/images/generations',
        { model: 'grok-imagine-image', prompt, n: 1 },
        { headers: { 'Authorization': `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      const imgData = xaiRes.data.data[0];
      if (imgData.b64_json) return Buffer.from(imgData.b64_json, 'base64');
      const imgRes = await axios.get(imgData.url, { responseType: 'arraybuffer', timeout: 30000 });
      return Buffer.from(imgRes.data);
    } catch (xaiErr) {
      const msg = xaiErr.response?.data?.error?.message || xaiErr.message;
      throw new Error(`Grok נכשל: ${msg}`);
    }
  }
  throw new Error('XAI_API_KEY לא מוגדר');
}

// ─── מדריך רעיונות ויזואליים + הנדסת פרומפטים (שני מצבים) ─────────────────
const VISUAL_SYSTEM_PROMPT = `You are an editorial image director for a leading Israeli news publication.

Your job: given an article, produce 4 image concepts that look like they could appear on the front page of a serious Israeli newspaper or magazine — MAARIV, YEDIOTH, or a political journal.

ISRAELI CONTEXT (apply only for ambiguous generic elements not specified in the prompt):
All articles are written for an Israeli audience. Only when the prompt does NOT specify the element, use these defaults:
- generic "soldiers" with no description = IDF uniforms
- generic "parliament / government building" with no description = Israeli Knesset
- generic "court / justice building" with no description = Israeli Supreme Court
- generic "city street / crowd" with no description = Israeli setting
Do NOT add flags, national symbols, or Israeli branding unless the prompt explicitly calls for them.
Follow the visual prompt exactly — do not add or replace elements.

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
Task: Write two short, powerful English image prompts — one photorealistic, one illustrated.

ISRAELI CONTEXT (apply only when not explicitly specified in the input):
- "soldiers" with no further description = IDF soldiers
- "flag" with no further description = Israeli flag
- "parliament / government building" = Knesset
- "court" = Israeli Supreme Court
- Generic "city / crowd / street" = Israeli setting
Do NOT add Israeli symbols beyond what the context requires.

GOLDEN RULE: One strong image = one clear idea. Do NOT add objects or subjects beyond what is described. Instead, create depth through:
- LIGHT: direction, quality, temperature (golden backlight, cold blue shadow, single shaft of warm light, dramatic chiaroscuro)
- TIME & WEATHER: golden hour, stormy sky, heavy clouds, haze, wind
- ANGLE & PERSPECTIVE: low angle looking up (power/grandeur), wide sky above, tight crop that isolates emotion
- MOOD & ATMOSPHERE: name the emotional weight — defiant, solemn, proud, melancholic, tense
These tools transform a simple subject into a powerful image without adding new elements.

Each prompt: 2–4 sentences maximum. No bullet points. No technical camera specs.

---

Prompt A — Photorealistic editorial photograph:
- State the single dominant subject exactly as described — do NOT add new subjects
- Add depth: describe the lighting and atmosphere in one sentence (direction + quality + temperature + weather)
- Name the angle/perspective and emotional weight
- End with: "Award-winning editorial photography. Cinematic quality."

Prompt B — Graphic editorial illustration:
- State the same concept rendered as a bold, flat illustration
- Specify exactly 2 dominant colors (name them)
- Name one style reference: e.g. "TIME Magazine cover", "Soviet propaganda poster reappropriated", "stark Polish poster art", "New Yorker editorial illustration"
- End with: "Bold graphic shapes. No gradients. Zero clutter."

No text in either image. Square 1:1 composition.

OUTPUT — write only the two prompts, no preamble:
Prompt A:
[2-4 sentences]

Prompt B:
[2-4 sentences]`;

// ─── קידומת איכות המצורפת לכל פרומפט שנשלח לגרוק ────────────────────────────
const IMAGE_QUALITY_PREFIX = `High quality editorial image. Professional lighting, sharp focus on the main subject, masterful composition, rich tonal range, refined textures, atmospheric depth. Premium render, highly detailed. `;
const DALL_E_STYLE_SUFFIX = ` No text or letters in the image. Square 1:1 composition.`;

// תרגום רעיון אישי לאנגלית (תרגום פשוט — הרחבה תתבצע ב-expandToTwoPrompts)
app.post('/translate-idea', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea?.trim()) return res.status(400).json({ success: false, error: 'חסר רעיון' });
    const result = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'Translate the Hebrew image description to English. Preserve every visual detail — subjects, lighting, colors, materials, mood, atmosphere. Return only the translated description, nothing else.',
        messages: [{ role: 'user', content: idea }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 }
    );
    res.json({ success: true, en: result.data.content[0].text.trim() });
  } catch (error) {
    res.json({ success: true, en: req.body.idea }); // fallback: שלח עברית
  }
});

// ─── יצירת שני פרומפטים מרעיון נבחר (MODE: PROMPTS) ────────────────────────
async function expandToTwoPrompts(idea) {
  try {
    const result = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: VISUAL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `MODE: PROMPTS\n\nINPUT:\n${idea}` }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 }
    );
    const text = result.data.content[0].text;
    const promptAMatch = text.match(/Prompt A:\s*([\s\S]+?)(?=\n\s*Prompt B:|$)/i);
    const promptBMatch = text.match(/Prompt B:\s*([\s\S]+?)$/i);
    if (!promptAMatch) addLog('⚠️ לא נמצא Prompt A — משתמש בפולבק');
    if (!promptBMatch) addLog('⚠️ לא נמצא Prompt B — משתמש בפולבק');
    const promptA = IMAGE_QUALITY_PREFIX + (promptAMatch ? promptAMatch[1].trim() : idea) + DALL_E_STYLE_SUFFIX;
    const promptB = IMAGE_QUALITY_PREFIX + (promptBMatch ? promptBMatch[1].trim() : idea) + DALL_E_STYLE_SUFFIX;
    addLog(`📷 A: ${promptA.length} תווים | 🎨 B: ${promptB.length} תווים`);
    return { promptA, promptB };
  } catch (e) {
    addLog(`⚠️ expandToTwoPrompts נכשל: ${e.message} — משתמש בפולבק`);
    return { promptA: IMAGE_QUALITY_PREFIX + idea + DALL_E_STYLE_SUFFIX, promptB: IMAGE_QUALITY_PREFIX + idea + DALL_E_STYLE_SUFFIX };
  }
}

// רעיונות לתמונה — שני שלבים: ניתוח מאמר → רעיונות תמונה
app.post('/image-ideas', async (req, res) => {
  try {
    const { text, direction } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'טקסט חסר' });

    addLog('מנתח מאמר ויוצר רעיונות ויזואליים...');

    const ideasRes = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: VISUAL_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `MODE: IDEAS

INPUT:
${text.slice(0, 3500)}
${direction ? `\nVISUAL DIRECTION FROM AUTHOR: "${direction}" — all 4 ideas must align with this direction.\n` : ''}`
        }]
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 45000 }
    );

    const rawText = ideasRes.data.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    addLog(`התקבלו ${result.ideas?.length || 0} רעיונות לתמונה`);
    res.json({ success: true, summary: result.summary || '', ideas: result.ideas, logs });
  } catch (error) {
    addLog(`שגיאה ברעיונות תמונה: ${error.response?.data?.error?.message || error.message}`);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message, logs });
  }
});

// יצירת תמונה — Grok x2 (📷 ריאלי + 🎨 אמנותי)
app.post('/generate-image', async (req, res) => {
  try {
    const { ideaEn, ideaHe } = req.body;
    if (!ideaEn) return res.status(400).json({ success: false, error: 'רעיון חסר' });

    addLog('יוצר פרומפטים מקצועיים לפי הרעיון הנבחר...');
    const { promptA, promptB } = await expandToTwoPrompts(ideaEn);

    addLog('יוצר 📷 ריאלי ו-✏️ ציור במקביל...');
    const ts = Date.now();

    // שני פרומפטים לגרוק במקביל
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
      const artisticErr = artisticSettled.reason?.message || 'שגיאה לא ידועה';
      addLog(`🎨 אמנותי נכשל: ${artisticErr}`);
    }

    if (!result.dalle && !result.artistic) {
      const lastErr = logs.filter(l => l.message.includes('נכשל')).map(l => l.message).join(' | ');
      return res.status(500).json({ success: false, error: `שתי יצירות התמונה נכשלו — ${lastErr}`, logs });
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
  "quotes": ["verbatimQuote1", "verbatimQuote2", "verbatimQuote3", "verbatimQuote4"]
}

Topics — choose EXACTLY 2 from this list only, exact spelling:
${ENGLISH_CATEGORIES_LIST}

Tags — choose 4-6 from this list only, exact spelling, no hyphens between words:
${ENGLISH_TAGS_LIST}

Quotes — extract EXACTLY 4 verbatim sentences from the article body (1-2 sentences each, copied word-for-word, no changes).

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

// ─── חוברת שבועית: בניית HTML להדפסה ────────────────────────────────────────
function buildBookletHTML(bookletNumber, posts, origin, hasCoverImg, hasIntroImg) {
  const logoUrl = origin + '/logo.png';
  const STATIC  = origin + '/booklet-static/';

  const INTRO_HTML = [
    `<p>'סוללים דרך' הינו מיזם העוסק בתודעה והסברה שהחל לפני מספר שנים לאור הצורך להבין את המתרחש במרחב הציבורי באופן ענייני, ללא משוא פנים ומתוך שיח בוגר ומקצועי.</p>`,
    `<p>לאט לאט הצטרפו למיזם אנשים רבים, עד שכיום הקהילה הגיעה לכ-15 אלף חברים (!) שמקבלים מאמר בכל יום.</p>`,
    `<p>ב'סוללים דרך' אנו נוהגים לומר ש'אין לך דבר פרקטי יותר מתיאוריה טובה'.</p>`,
    `<p>כלומר, המיזם מאפשר לתחושות האינטואיטיביות הפשוטות של רבים, לעבור מתחושות בטן להמשגה ברורה ולתודעה סדורה. רק אדם כזה הופך להיות 'אקטיביסט' מדויק הפועל בהתאם לרוח לאומית, ציונית ויהודית.</p>`,
    `<p>אנו משתדלים לסקל את אבני הנגף מנהר החיים הישראלים על מנת לסייע בענווה לספינה הלאומית לנוע בבטחה ובגאון.</p>`,
    `<p class="bk-contact">תגובות: <a href="mailto:office@solelim-derech.co.il">office@solelim-derech.co.il</a></p>`
  ].join('\n');

  const dec = s => (s || '')
    .replace(/&quot;/g, '"').replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '…').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

  // תאריך עברי — Node.js 13+ תומך ב-ca-hebrew
  const hebrewDate = d => {
    try {
      return new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day:'numeric', month:'long', year:'numeric' }).format(d);
    } catch(e) {
      return d.toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' });
    }
  };

  const articles = posts.map(p => {
    const imageUrl  = p._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
    const author    = p._embedded?.author?.[0]?.name || '';
    const title     = dec(p.title.rendered.replace(/<[^>]+>/g, ''));
    const isoDate   = p.date; // המרה לעברית תתבצע בדפדפן
    const excerpt   = dec((p.excerpt.rendered || '').replace(/<[^>]+>/g, '').trim());
    const content   = p.content.rendered
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<div[^>]*buzzsprout[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*wp-block-file[^>]*>[\s\S]*?<\/div>/gi, '') // הסרת בלוקי PDF
      .replace(/<embed[^>]*\/?>/gi, '')                              // הסרת embed
      .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')              // הסרת object
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/<p[^>]*>\s*<\/p>/g, '')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return { title, author, imageUrl, isoDate, excerpt, content };
  });

  const artLabels = ['ראשון','שני','שלישי','רביעי'];
  const articlesHTML = articles.map((a, i) => `
<div class="bk-page">
  <div class="art-num">מאמר ${artLabels[i] || i + 1}</div>
  ${a.imageUrl ? `<div class="art-img-wrap"><img class="art-img" src="${a.imageUrl}" alt="" loading="eager"></div>` : ''}
  <h2 class="art-title">${a.title}</h2>
  ${a.author ? `<p class="art-meta"><span class="art-author">✍ ${a.author}</span></p>` : ''}
  ${a.excerpt ? `<p class="art-excerpt">${a.excerpt}</p>` : ''}
  <div class="art-body">${a.content}</div>
</div>`).join('\n');

  // עמוד שער
  const coverPage = hasCoverImg
    ? `<div class="bk-page bk-static-page bk-first">
        <img src="${STATIC}cover.jpg" alt="שער" style="width:100%;display:block">
        <div class="cv-badge-overlay">${bookletNumber}</div>
       </div>`
    : `<div class="bk-page bk-cover bk-first">
        <div class="cv-badge">${bookletNumber}</div>
        <div class="cv-body">
          <img src="${logoUrl}" class="cv-logo" onerror="this.style.display='none'" alt="סוללים דרך">
          <div class="cv-brand">סוללים דרך</div>
          <div class="cv-tag">בונים חירות תודעתית</div>
          <div class="cv-week">מאמרי השבוע</div>
          <div class="cv-dates" id="cvDates">טוען...</div>
          <div class="cv-year" id="cvYear"></div>
        </div>
        <div class="cv-foot">
          <a href="https://www.solelim-derech.co.il">www.solelim-derech.co.il</a>
          <div class="qr-box"><canvas id="qrCvs"></canvas></div>
        </div>
       </div>`;

  // עמוד הקדמה
  const introPage = hasIntroImg
    ? `<div class="bk-page bk-static-page">
        <img src="${STATIC}intro.jpg" alt="הקדמה" style="width:100%;height:100%;object-fit:contain;display:block">
       </div>`
    : `<div class="bk-page bk-intro">
        <h2>מי אנחנו?</h2>
        ${INTRO_HTML}
       </div>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>חוברת סוללים דרך — גיליון ${bookletNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#ddd;font-family:'Heebo','Arial Hebrew',Arial,sans-serif;direction:rtl;color:#1a1a1a}
.pbar{position:fixed;inset:0 0 auto 0;z-index:999;background:#1a3a54;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:9px 18px}
.pbar-t{font-size:15px;font-weight:700}.pbar-b{display:flex;gap:8px}
.pb{border:none;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
.pb-p{background:#f5a623;color:#fff}.pb-g{background:#27ae60;color:#fff}.pb-c{background:#555;color:#fff}
@media screen{body{padding-top:52px}}

/* ── עמודים ── */
.bk-page{background:#fff;width:210mm;margin:12px auto;padding:18mm 20mm;min-height:297mm;position:relative;overflow:hidden}
.bk-static-page{padding:0!important}

/* ── שער דינמי ── */
.bk-cover{display:flex;flex-direction:column;align-items:center;padding:0}
.cv-badge{position:absolute;top:0;right:0;background:#1a3a54;color:#fff;font-size:22px;font-weight:900;padding:10px 16px;border-radius:0 0 0 14px;min-width:50px;text-align:center}
.cv-badge-overlay{position:absolute;top:11mm;right:11mm;background:#1a3a54;color:#fff;font-size:22px;font-weight:900;width:46px;height:46px;display:flex;align-items:center;justify-content:center;border-radius:8px}
.cv-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:36px 40px;width:100%}
.cv-logo{width:120px;height:auto;margin-bottom:14px}
.cv-brand{font-size:48px;font-weight:900;color:#1a3a54;line-height:1}
.cv-tag{font-size:16px;color:#1e8a6b;margin:5px 0 38px}
.cv-week{font-size:22px;font-weight:700;color:#1a3a54;margin-bottom:10px}
.cv-dates{font-size:20px;font-weight:600;color:#1a3a54}
.cv-year{font-size:14px;color:#666;margin-top:6px}
.cv-foot{background:#1e8a6b;width:100%;padding:22px;text-align:center;margin-top:auto}
.cv-foot a{color:#fff;font-size:13px;display:block;margin-bottom:12px;text-decoration:none}
.qr-box{display:inline-block;background:#fff;border-radius:6px;padding:6px}

/* ── הקדמה דינמית ── */
.bk-intro{padding:20mm 22mm}
.bk-intro h2{font-size:26px;font-weight:900;color:#1a3a54;padding-bottom:12px;border-bottom:3px solid #1e8a6b;margin-bottom:22px}
.bk-intro p{font-size:15px;line-height:2.1;color:#2a2a2a;margin-bottom:16px}
.bk-contact{font-size:13px!important;color:#999!important;margin-top:20px!important}
.bk-contact a{color:#1e8a6b!important}

/* ── מאמרים ── */
.art-num{display:block;text-align:center;font-size:12px;font-weight:900;color:#1e8a6b;letter-spacing:3px;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e8f4ef}
.art-img-wrap{display:flex;justify-content:center;margin-bottom:20px}
.art-img{width:90mm;height:90mm;object-fit:cover;border-radius:10px;display:block}
.art-title{font-size:22px;font-weight:900;color:#1a3a54;line-height:1.35;margin-bottom:8px;text-align:center}
.art-meta{font-size:17px;color:#555;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.art-author{font-weight:700;color:#1a3a54}
.art-excerpt{font-size:17px;color:#333;line-height:1.75;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #e8f4ef;font-style:italic;text-align:right}
.art-body{font-size:16px;line-height:1.95;color:#222}
.art-body p{margin-bottom:13px}.art-body strong{font-weight:700;color:#111}
.art-body blockquote{background:#eef8f4;border-right:4px solid #1e8a6b;padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;font-size:18px;font-weight:700;color:#1a3a54;line-height:1.7;font-style:normal}
.art-body blockquote p{margin:0}
/* תמונות מוטמעות בגוף המאמר (לא תמונה ראשית) — מרוכזות, עד חצי עמוד */
.art-body img{display:block;max-width:50%;height:auto;margin:14px auto;border-radius:6px}

/* ── @page ברמה עליונה. margin:0 לגובה — Chrome מציג כותרות רק אם יש מקום בmargin ──
   שוליים ויזואליים (10mm למעלה/למטה) מגיעים מה-padding של .bk-page ישירות ── */
@page{size:A4;margin:0 20mm}
@page frontmatter{size:A4;margin:0 20mm}

/* ── הדפסה ── */
@media print{
  body{background:#fff;padding-top:0;orphans:3;widows:3}
  .pbar{display:none!important}

  /* שער/הקדמה — עמוד ייעודי ללא מספר */
  .bk-cover,.bk-intro,.bk-static-page{page:frontmatter}

  /* כל עמוד: מתחיל דף חדש; padding מחליף את שוליי @page למעלה/למטה */
  .bk-page{
    width:100%;margin:0;padding:10mm 0;
    position:relative;
    min-height:0;
    overflow:visible!important;
    page-break-before:always;break-before:page;
    page-break-inside:auto;break-inside:auto;
    -webkit-print-color-adjust:exact;print-color-adjust:exact
  }
  .bk-first{page-break-before:auto!important;break-before:auto!important}

  /* עמודי שער/הקדמה: מלאים A4 (297mm — אין margin גובה) */
  .bk-cover,.bk-intro,.bk-static-page{
    height:297mm;
    overflow:hidden!important;
    page-break-inside:avoid;break-inside:avoid
  }
  /* הקדמה — padding ויזואלי לתוכן */
  .bk-intro{padding:10mm 0!important}
  .bk-cover{padding:0!important}
  .bk-static-page{
    position:relative!important;
    padding:0!important
  }
  .bk-static-page img{width:100%;height:100%;object-fit:cover;display:block}

  /* מניעת חיתוך באמצע תמונות / ציטוטים */
  .art-img-wrap{page-break-inside:avoid;break-inside:avoid}
  .art-body blockquote{page-break-inside:avoid;break-inside:avoid}
  /* כותרת + שם כותב: לא יופרדו מהטקסט שמתחתם */
  .art-num,.art-title,.art-meta{page-break-after:avoid;break-after:avoid}

  .cv-foot,.cv-badge,.cv-badge-overlay,.cv-brand,.cv-tag,.cv-week,.cv-dates,
  .bk-intro h2,.art-body blockquote,.art-excerpt,.art-num{
    -webkit-print-color-adjust:exact;print-color-adjust:exact
  }

  /* ── הקטנת רווחים — מ-20 עמודים ל-14 ── */
  .art-body{line-height:1.55!important}
  .art-body p{margin-bottom:5px!important}
  .art-excerpt{font-size:15px!important;line-height:1.5!important;margin-bottom:10px!important;padding-bottom:8px!important}
  .art-num{margin-bottom:8px!important;padding-bottom:4px!important;font-size:11px!important}
  .art-title{font-size:20px!important;margin-bottom:4px!important}
  .art-meta{margin-bottom:6px!important}
  .art-img{width:55mm!important;height:55mm!important}
  .art-img-wrap{margin-bottom:10px!important}
  .bk-intro p{line-height:1.65!important;margin-bottom:8px!important}
  .bk-intro h2{margin-bottom:12px!important;padding-bottom:6px!important}
  .art-body blockquote{padding:8px 14px!important;margin:10px 0!important;font-size:16px!important}
  .art-body img{max-width:85mm!important;display:block!important;margin:8px auto!important;height:auto!important;page-break-inside:avoid;break-inside:avoid}

  /* ── מספרי עמודים (מחליף @bottom-center שדורש margin) ──
     counter מתחיל מ-2 כדי שעמוד המאמר הראשון = 3 (שער+הקדמה הם 1-2) */
  body{counter-reset:bk-pg 2}
  .bk-page:not(.bk-cover):not(.bk-intro):not(.bk-static-page){counter-increment:bk-pg}
  .bk-page:not(.bk-cover):not(.bk-intro):not(.bk-static-page)::after{
    content:counter(bk-pg);
    display:block;
    text-align:center;
    font-size:8pt;
    color:#aaa;
    font-family:'Heebo',Arial,sans-serif;
    margin-top:4mm
  }
}
</style>
</head>
<body>
<div class="pbar">
  <span class="pbar-t">📚 חוברת סוללים דרך — גיליון ${bookletNumber}</span>
  <div class="pbar-b">
    <button class="pb pb-p" onclick="printBooklet()">🖨️ שמור PDF</button>
    <button class="pb pb-g" onclick="if(window.opener&&window.opener.continueToPublish){window.opener.continueToPublish();}window.close()">📤 העלה לאתר</button>
    <button class="pb pb-c" onclick="window.close()">✕ סגור</button>
  </div>
</div>

${coverPage}
${introPage}
${articlesHTML}

${!hasCoverImg ? `<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>` : ''}
<script>
(function(){
  // המרת מספר לאותיות עבריות
  function numToHebLet(n){
    if(n===15)return'ט\u05F4ו';
    if(n===16)return'ט\u05F4ז';
    var vals=[400,300,200,100,90,80,70,60,50,40,30,20,10,9,8,7,6,5,4,3,2,1];
    var lets=['ת','ש','ר','ק','צ','פ','ע','ס','נ','מ','ל','כ','י','ט','ח','ז','ו','ה','ד','ג','ב','א'];
    var s='',r=n;
    for(var i=0;i<vals.length;i++){while(r>=vals[i]){s+=lets[i];r-=vals[i];}}
    if(s.length===1)return s+'\u05F3';
    return s.slice(0,-1)+'\u05F4'+s.slice(-1);
  }
  // המרת מחרוזת תאריך עברי: מחליף את המספרים בה באותיות
  function hebrewizeDate(str){
    // שנה: מספר >= 5000 → מחסיר 5000 ואז ממיר
    str=str.replace(/\b(5\d{3})\b/g,function(_,y){return numToHebLet(parseInt(y)-5000)+'\'';});
    // ימים ומספרים קטנים
    str=str.replace(/\b([1-9][0-9]?)\b/g,function(_,n){return numToHebLet(parseInt(n));});
    return str;
  }
  // תאריכים עבריים (דפדפן תמיד תומך)
  var heFmt=null;
  try{ heFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{day:'numeric',month:'long',year:'numeric'}); }catch(e){}
  document.querySelectorAll('.art-date[data-iso]').forEach(function(el){
    try{
      var d=new Date(el.dataset.iso);
      var raw=heFmt ? heFmt.format(d) : d.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});
      el.textContent=hebrewizeDate(raw);
    }catch(e){}
  });
  ${!hasCoverImg ? `
  try{
    var d=new Date(),fmtD=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{day:'numeric',month:'long'}),
        fmtY=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{year:'numeric'}),
        dow=d.getDay(),sun=new Date(d),thu=new Date(d);
    sun.setDate(d.getDate()-dow); thu.setDate(d.getDate()-dow+4);
    document.getElementById('cvDates').textContent=fmtD.format(sun)+' — '+fmtD.format(thu);
    document.getElementById('cvYear').textContent=fmtY.format(d);
  }catch(e){}
  try{QRCode.toCanvas(document.getElementById('qrCvs'),'https://www.solelim-derech.co.il',{width:70,color:{dark:'#1a3a54',light:'#ffffff'}},function(){});}catch(e){}
  ` : ''}
})();

function printBooklet(){
  // קריאה ישירה מ-onclick — user gesture → window.print() עובד תמיד
  window.print();
}
</script>
</body>
</html>`;
}

// מחזיר את כתובת WordPress ללקוח (לשימוש בבקשות ישירות)
app.get('/booklet/wp-config', requireAdmin, (req, res) => {
  res.json({ wpUrl: process.env.WP_URL });
});

// קאש מאמרים אחרונים — נשמר בקובץ כדי לשרוד רסטרטים ולמנוע עומס על WordPress
const POSTS_CACHE_FILE    = path.join(__dirname, 'data', 'recent-posts-cache.json');
const POSTS_CACHE_TTL     = 24 * 60 * 60 * 1000; // 24 שעות — תקינות רגילה
const POSTS_CACHE_MIN_AGE = 24 * 60 * 60 * 1000; // 24 שעות — מינימום בין כל רענון

let recentPostsCache = { posts: [], fetchedAt: 0 };
// טעינת קאש מקובץ בעת הפעלת השרת
try {
  if (fs.existsSync(POSTS_CACHE_FILE)) {
    recentPostsCache = JSON.parse(fs.readFileSync(POSTS_CACHE_FILE, 'utf8'));
  }
} catch(_) {}

async function fetchRecentPostsFromWP() {
  const feedUrl = process.env.WP_URL + '/feed/?posts_per_page=30';
  const r = await axios.get(feedUrl, {
    timeout: 15000,
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }
  });
  const xml = r.data;
  const BOOKLET_TAG = 'חוברת שבועית להדפסה';
  const heRe = /[א-ת]/;

  // חילוץ ערך תג XML — ללא regex, עם indexOf בלבד
  function extractTag(block, tag) {
    const open  = '<' + tag;
    const close = '</' + tag + '>';
    const s = block.indexOf(open);
    if (s === -1) return '';
    const a = block.indexOf('>', s) + 1;
    if (a <= 0) return '';
    const e = block.indexOf(close, a);
    if (e === -1) return '';
    let v = block.slice(a, e).trim();
    if (v.startsWith('<![CDATA[') && v.endsWith(']]>')) v = v.slice(9, -3).trim();
    return v;
  }

  function extractAllTags(block, tag) {
    const out = [], close = '</' + tag + '>';
    let pos = 0;
    while (true) {
      const s = block.indexOf('<' + tag, pos);
      if (s === -1) break;
      const a = block.indexOf('>', s) + 1;
      if (a <= 0) break;
      const e = block.indexOf(close, a);
      if (e === -1) break;
      let v = block.slice(a, e).trim();
      if (v.startsWith('<![CDATA[') && v.endsWith(']]>')) v = v.slice(9, -3).trim();
      out.push(v);
      pos = e + close.length;
    }
    return out;
  }

  const pNum   = /[?&]p=(\d+)/;
  const pSlash = /\/(\d+)\//;
  const imgRe  = /url="([^"]+\.(?:jpg|jpeg|png|webp|gif))"/;

  const items = [];
  let pos = 0;
  while (items.length < 10) {
    const s = xml.indexOf('<item>', pos);
    if (s === -1) break;
    const e = xml.indexOf('</item>', s);
    if (e === -1) break;
    const block = xml.slice(s + 6, e);
    pos = e + 7;

    const title = extractTag(block, 'title');
    const date  = extractTag(block, 'pubDate');
    const cats  = extractAllTags(block, 'category');

    if (cats.includes(BOOKLET_TAG)) continue;
    if (!heRe.test(title)) continue;

    const ls = block.indexOf('<link>'), le = block.indexOf('</link>');
    const link = (ls !== -1 && le !== -1) ? block.slice(ls + 6, le).trim() : '';
    const idM = link.match(pNum) || link.match(pSlash);
    const id  = idM ? parseInt(idM[1]) : items.length + 1;

    const imgM = block.match(imgRe);
    const imageUrl = imgM ? imgM[1] : '';

    let dateLabel = date;
    try {
      dateLabel = new Intl.DateTimeFormat('he-IL-u-ca-hebrew',
        { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date));
    } catch(_) {}

    items.push({ id, date, dateLabel, title, imageUrl });
  }

  return items;
}

// שליפת 10 מאמרים אחרונים — עם קאש למניעת עומס על WordPress
app.get('/booklet/recent-posts', requireAdmin, async (req, res) => {
  const cacheAge = Date.now() - recentPostsCache.fetchedAt;
  const hasCache = recentPostsCache.posts.length > 0;
  const tooSoon  = cacheAge < POSTS_CACHE_MIN_AGE; // פחות מ-5 דקות — לא לגשת ל-WP

  // אם עברו פחות מ-5 דקות, תמיד החזר קאש (הגנה על WordPress)
  if (hasCache && tooSoon) {
    return res.json({ success: true, posts: recentPostsCache.posts, fromCache: true });
  }
  // אם לא ביקשו רענון מפורש וקאש תקין — החזר קאש
  if (hasCache && cacheAge < POSTS_CACHE_TTL && !req.query.refresh) {
    return res.json({ success: true, posts: recentPostsCache.posts, fromCache: true });
  }

  try {
    const posts = await fetchRecentPostsFromWP();
    recentPostsCache = { posts, fetchedAt: Date.now() };
    // שמור לקובץ — ישרוד רסטרט שרת
    try {
      if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
      fs.writeFileSync(POSTS_CACHE_FILE, JSON.stringify(recentPostsCache), 'utf8');
    } catch(_) {}
    res.json({ success: true, posts, fromCache: false });
  } catch (e) {
    // אם יש קאש ישן — החזר אותו במקום שגיאה
    if (recentPostsCache.posts.length > 0) {
      return res.json({ success: true, posts: recentPostsCache.posts, fromCache: true, stale: true });
    }
    const status = e.response ? e.response.status : null;
    const detail = status ? ' (HTTP ' + status + ')' : ' (' + (e.code || 'network error') + ')';
    res.status(500).json({ success: false, error: e.message + detail });
  }
});

// העלאת תמונות סטטיות (שער / הקדמה)
const BOOKLET_STATIC_DIR = path.join(__dirname, 'public', 'booklet-static');
app.post('/booklet/upload-static', requireAdmin, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'intro', maxCount: 1 }
]), async (req, res) => {
  if (!fs.existsSync(BOOKLET_STATIC_DIR)) fs.mkdirSync(BOOKLET_STATIC_DIR, { recursive: true });
  const saved = [];
  try {
    for (const type of ['cover', 'intro']) {
      const file = req.files?.[type]?.[0];
      if (!file) continue;
      const buf = fs.readFileSync(file.path);
      fs.unlinkSync(file.path);
      await sharp(buf).jpeg({ quality: 95 }).toFile(path.join(BOOKLET_STATIC_DIR, `${type}.jpg`));
      saved.push(type);
    }
    res.json({ success: true, saved });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// יצירת HTML לחוברת (4 מאמרים נבחרים)
// מאגר זמני לתצוגות מקדימות — token → html, פג תוקף אחרי שעה
const bookletPreviews = new Map();

// הגשת תצוגה מקדימה לפי token — URL אמיתי שמאפשר window.print()
app.get('/booklet/preview/:token', requireAdmin, (req, res) => {
  const html = bookletPreviews.get(req.params.token);
  if (!html) return res.status(404).send('<p>תצוגה מקדימה לא נמצאה או פגה תוקף</p>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/booklet/generate-html', requireAdmin, express.json(), async (req, res) => {
  try {
    const { bookletNumber, postIds } = req.body;
    if (!postIds || postIds.length < 1 || postIds.length > 4)
      return res.status(400).json({ success: false, error: 'יש לבחור 1–4 מאמרים' });
    if (!bookletNumber)
      return res.status(400).json({ success: false, error: 'מספר חוברת חסר' });

    // שליפה סדרתית (לא מקבילה) כדי לא להעמיס על WordPress בו-זמנית
    const postsData = [];
    for (const id of postIds) {
      const r = await axios.get(
        `${process.env.WP_URL}/wp-json/wp/v2/posts/${id}?_embed`,
        { auth: { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD }, timeout: 20000 }
      );
      postsData.push(r.data);
    }
    postsData.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!fs.existsSync(BOOKLET_STATIC_DIR)) fs.mkdirSync(BOOKLET_STATIC_DIR, { recursive: true });
    const hasCoverImg = fs.existsSync(path.join(BOOKLET_STATIC_DIR, 'cover.jpg'));
    const hasIntroImg = fs.existsSync(path.join(BOOKLET_STATIC_DIR, 'intro.jpg'));

    const origin = req.protocol + '://' + req.get('host');
    const html   = buildBookletHTML(bookletNumber, postsData, origin, hasCoverImg, hasIntroImg);

    // שמור עם token זמני לצורך URL אמיתי (window.print() עובד רק מניווט רגיל)
    const crypto = require('crypto');
    const token  = crypto.randomBytes(12).toString('hex');
    bookletPreviews.set(token, html);
    setTimeout(() => bookletPreviews.delete(token), 60 * 60 * 1000); // שעה

    res.json({ success: true, html, token });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// הורדת PDF של חוברת — Puppeteer מייצר PDF מה-HTML (ללא כותרות דפדפן)
app.post('/generate-booklet-pdf', requireAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML חסר' });
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--disable-extensions', '--single-process']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true   // מכבד @page{size:A4;margin:...} מה-CSS
    });
    await browser.close(); browser = null;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="booklet.pdf"');
    res.send(pdfBuffer);
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    res.status(503).json({ success: false, error: e.message });
  }
});

// פרסום חוברת ישירות מ-HTML — מייצר PDF בעזרת Puppeteer ומעלה לוורדפרס
app.post('/publish-booklet-from-html', requireAdmin, async (req, res) => {
  const { html, bookletNumber, publishDate } = req.body;
  if (!html)           return res.status(400).json({ success: false, error: 'HTML חסר' });
  if (!bookletNumber)  return res.status(400).json({ success: false, error: 'מספר חוברת חסר' });
  if (!publishDate)    return res.status(400).json({ success: false, error: 'תאריך פרסום חסר' });

  const wpAuth = { username: process.env.WP_USERNAME, password: process.env.WP_APP_PASSWORD };
  const wpBase = `${process.env.WP_URL}/wp-json/wp/v2`;
  let browser;
  try {
    addLog(`מייצר PDF לחוברת מספר ${bookletNumber}...`);
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--disable-extensions', '--single-process']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '20mm', bottom: '10mm', left: '20mm' }
    });
    await browser.close(); browser = null;
    addLog('PDF נוצר בהצלחה, מעלה לוורדפרס...');

    // 1. העלאת PDF למדיה
    const mediaRes = await axios.post(`${wpBase}/media`, pdfBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="booklet-${bookletNumber}.pdf"`,
        'Content-Type': 'application/pdf'
      },
      auth: wpAuth, maxBodyLength: Infinity
    });
    const pdfUrl = mediaRes.data.source_url;
    addLog(`PDF הועלה: ${pdfUrl}`);

    // 2. תמונה ראשית
    const imgSearch = await axios.get(
      `${wpBase}/media?search=WhatsApp-Image-2025-01-10-at-12.24.11&per_page=5`, { auth: wpAuth });
    const featuredImg = imgSearch.data.find(m =>
      m.slug?.includes('12-24-11') || m.source_url?.includes('12.24.11')) || imgSearch.data[0];
    const featuredMediaId = featuredImg?.id || null;

    // 3. קטגוריה ותגית
    const categoryIds = await getOrCreateTermIds(['אקטואליה'], 'categories');
    const tagIds      = await getOrCreateTermIds(['חוברת שבועית להדפסה'], 'tags');

    // 4. בניית תוכן ויצירת פוסט
    const content = `<blockquote>
<h2>המאמרים של השבוע האחרון בקובץ דיגיטלי, מותאם להדפסה!</h2>
<h3>לקבלת החוברת במייל מידי שבוע - <a href="https://pe4ch.com/ref/xR1a1UxC2che?lang=he">הירשמו כאן</a></h3>
</blockquote>
<h2></h2>
<h2 style="text-align: center;"><a href="${pdfUrl}"><strong>לפתיחת החוברת לחצו כאן</strong></a></h2>
<a href="${pdfUrl}"><img class="aligncenter wp-image-1342 size-thumbnail" src="https://www.solelim-derech.co.il/wp-content/uploads/2025/01/download-pdf-150x150.png" alt="" width="150" height="150" /></a>`;

    const postData = {
      title: `חוברת מאמרי השבוע (${bookletNumber}) להדפסה!`,
      content, status: 'future',
      date: new Date(publishDate).toISOString(),
      categories: categoryIds, tags: tagIds
    };
    if (featuredMediaId) postData.featured_media = featuredMediaId;

    const postRes = await axios.post(`${wpBase}/posts`, postData, { auth: wpAuth });
    addLog(`חוברת פורסמה! קישור: ${postRes.data.link}`);
    res.json({ success: true, postUrl: postRes.data.link, postId: postRes.data.id, pdfUrl });
  } catch (error) {
    if (browser) try { await browser.close(); } catch {}
    const msg = error.response?.data?.message || error.message;
    addLog(`שגיאה בפרסום חוברת: ${msg}`);
    res.status(500).json({ success: false, error: msg });
  }
});

// מספר החוברת האחרונה שהועלתה (להצגת ברירת מחדל בממשק)
app.get('/booklet/last-number', requireAdmin, async (req, res) => {
  try {
    const WP_URL = process.env.WP_URL;
    // שליפת הTAG של חוברת שבועית
    const tagRes = await axios.get(
      `${WP_URL}/wp-json/wp/v2/tags?search=%D7%97%D7%95%D7%91%D7%A8%D7%AA+%D7%A9%D7%91%D7%95%D7%A2%D7%99%D7%AA+%D7%9C%D7%94%D7%93%D7%A4%D7%A1%D7%94&per_page=10`,
      { timeout: 10000 }
    );
    const tag = tagRes.data.find(t => t.name === 'חוברת שבועית להדפסה');
    if (!tag) return res.json({ nextNumber: 1 });

    // שליפת החוברת האחרונה
    const postsRes = await axios.get(
      `${WP_URL}/wp-json/wp/v2/posts?tags=${tag.id}&per_page=1&orderby=date&order=desc&status=publish`,
      { timeout: 10000 }
    );
    if (!postsRes.data.length) return res.json({ nextNumber: 1 });

    const title = postsRes.data[0].title.rendered.replace(/<[^>]+>/g, '');
    const m = title.match(/(\d+)/);
    const lastNum = m ? parseInt(m[1]) : 0;
    res.json({ nextNumber: lastNum + 1 });
  } catch (e) {
    res.json({ nextNumber: null, error: e.message });
  }
});

// ─── עדכון קוד ידני (במקום manual-deploy.php) ────────────────────────────────
app.get('/deploy', requireAdmin, (req, res) => {
  const { execSync } = require('child_process');
  const repoPath = __dirname;
  const out = [];
  try {
    out.push(execSync(`cd "${repoPath}" && git fetch origin main 2>&1`).toString());
    out.push(execSync(`cd "${repoPath}" && git reset --hard origin/main 2>&1`).toString());
    require('fs').mkdirSync(require('path').join(repoPath, 'tmp'), { recursive: true });
    require('fs').writeFileSync(require('path').join(repoPath, 'tmp', 'restart.txt'), Date.now().toString());
    res.send('<pre>✅ עדכון הושלם:\n\n' + out.join('\n') + '</pre>');
  } catch (e) {
    res.status(500).send('<pre>❌ שגיאה:\n' + e.message + '</pre>');
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