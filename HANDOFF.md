# HANDOFF — מערכת פרסום סוללים דרך

> **לסוכן החדש:** קרא את כל המסמך הזה לפני שאתה נוגע בקוד. כאן מסוכם כל מה שצריך לדעת — ארכיטקטורה, היסטוריה, מצב נוכחי, מה הסגנון שעובדים בו, ומה בקנה.

---

## 1. סקירה כללית

מערכת ל-**עמותת "סוללים דרך"** — פרסום אתר חדשותי בעברית (RTL).
האתר עצמו: `https://solelim-derech.co.il` (וורדפרס + Elementor).
המערכת הזו = **שרת Node.js עצמאי** שעוטף את האתר ומוסיף יכולות:

- **הגהה** לטקסט עברי באמצעות Claude API
- **יצירת תמונות** עם OpenAI (gpt-image-1) ו-Grok במקביל
- **פרסום ישירות לוורדפרס** דרך REST API
- **חוברת שבועית** — איסוף 4 מאמרים אחרונים והפיכתם ל-PDF להדפסה

---

## 2. ארכיטקטורה

```
C:\Projects\
├── server.js             ← השרת. ~2400 שורות. כל הלוגיקה כאן.
├── public/index.html     ← UI יחיד (SPA). כל הצד-לקוח כאן.
├── .env                  ← מפתחות API (לא ב-git)
├── whatsapp-groups.json  ← רשימת קבוצות WhatsApp שמצורפות לסוף מאמרים
├── package.json          ← תלויות
└── uploads/              ← תיקיית קבצים זמנית
```

**שורש העניין:** הכל בקובץ אחד גדול (`server.js`) ובדף אחד גדול (`index.html`). זה לא Vue/React. זה Express + vanilla JS. **אל תפצל לקבצים בלי בקשה מפורשת.**

### תלויות עיקריות
- `express` + `express-basic-auth` — שרת ואותנטיקציה
- `axios` — קריאות API (Anthropic, OpenAI, xAI, WordPress)
- `puppeteer` — יצירת PDF לחוברות (אופציונלי — fallback ל-window.print קיים)
- `sharp` — עיבוד תמונות
- `multer` — העלאת קבצים
- `docx` — יצירת מסמכי Word (משומש לדוגמת תוכנית הגירה — לא קריטי)

---

## 3. משתמשים והרשאות

`basicAuth` עם 3 משתמשים (ב-`.env`):
- **`admin`** — הרשאות מלאות (יצירת חוברות, ניהול קבוצות, פרסום)
- **`solelim`** — הגהה + פרסום, **ללא** גישה לניהול קבוצות, אבל **כן** מורשה ל-`/groups` כדי שצירוף קבוצה אוטומטי יעבוד. ה-UI מסתיר ממנו את שדה בחירת הקבוצה
- **`english`** — לתוכן באנגלית (פחות בשימוש)

`requireAdmin` middleware מוגדר בשרת — חוסם את `solelim`. **הקפד** ש-endpoints חדשים שצריכים `solelim` יוחרגו מ-`requireAdmin`.

---

## 4. זרימת עבודה ראשית — הגהה ופרסום

1. משתמש מדביק טקסט של מאמר
2. **`POST /edit-stage1`** — מפצל ל-chunks של 5000 תווים, שולח כל chunk ל-Claude Haiku להגהה לשונית, מאחה חזרה. מחזיר `body` ו-`correctedText`.
3. במקביל **`POST /edit-stage2`** — שולח לClaude לקבל 2 הצעות לכותרת (או 3 אם המאמר ללא כותרת — checkbox "הצע כותרת")
4. וגם **`POST /format-body`** — מעצב את הגוף ל-HTML מותאם וורדפרס
5. **`POST /generate-image`** — יוצר 2 תמונות במקביל: OpenAI (gpt-image-1) + Grok. ה-prompt עובר דרך `expandToRealisticPrompt()` שכותב prompt באנגלית בסגנון editorial photojournalism
6. **`POST /publish`** — מעלה לוורדפרס דרך REST API (PUT /wp/v2/posts)

### חוקי תוכן חשובים
- **לא להציג את כיפת הסלע** — אם מוזכרת ירושלים, להראות את חומות העיר העתיקה / הכותל. החוק הזה מקודד פעמיים — גם ב-`VISUAL_SYSTEM_PROMPT` (לcCaude שמכין את ה-prompt) וגם ב-`generateGrokImage` / `generateOpenAIImage` (prefix ישיר)
- שני מודלי התמונות = **photorealistic editorial**. הוסר התיאור "ריאלי/אמנותי" — היום שניהם ריאליים

### מספור רשימות (נוסף לאחרונה)
פונקציה `renumberList()` (סביב שורה 207 ב-server.js) רצה אחרי הגהה ב-`/edit-stage1`:
- **`א. ב. ג.`** → `1. 2. 3.`
- ספרות לא ברצף / כפילויות → מתוקנות
- אימוג'י-ספרות (`1️⃣`) → נשמרות עם רצף מתוקן
- אם אין מספור (פחות מ-2 סמנים) — לא נוגעת
- שומרת: indentation, מפריד (`.` או `)`), טקסט אחרי הסמן או שורה נפרדת
- 12 unit tests עברו — אם נוגעים בקוד, **תריץ אותם מחדש**

---

## 5. חוברת שבועית

`POST /booklet/recent-posts?count=N` — מושך מאמרים מ-WordPress RSS (N בין 10–50)
המשתמש בוחר 1-10 מאמרים → UI מרכיב HTML עם CSS מותאם A4 → שתי דרכי שמירה:

1. **שמור PDF** (`downloadBookletPdf()` ב-index.html):
   - מנסה `/generate-booklet-pdf` (Puppeteer בשרת) → PDF נקי
   - אם Puppeteer לא מותקן בשרת ייעודי (`Cannot find module 'puppeteer'`) → `_printBookletFallback()` פותח חלון הדפסה
   - ה-fallback מציג למשתמש הנחיה לבטל "Headers and footers" ב-Chrome

2. **פרסם** — `/publish-booklet-from-html` מייצר PDF ב-Puppeteer ומעלה לוורדפרס כפוסט עם קובץ מצורף

### CSS חשוב
- `@page { size: A4; margin: 18mm 20mm; @bottom-center { content: counter(page); ... } }`
- `@page frontmatter` — לעמוד שער + הקדמה (margin:0, ללא מספר עמוד)
- `.bk-cover, .bk-intro, .bk-static-page { page: frontmatter }`
- מספרי עמודים **מ-CSS** (לא מ-Chrome's native footer) — מופיעים גם אם המשתמש כיבה Headers and footers

---

## 6. שרת ההפעלה האמיתי

הקוד מ-GitHub נפרס לשרת **`app.solelim-derech.co.il`** דרך webhook (`deploy-webhook.php`).
על השרת חסר Puppeteer (`npm install` לא רץ שם) — לכן fallback להדפסה דרך הדפדפן. **המשתמש יודע על זה.**

---

## 7. אימוג'י / תוכן ויזואלי

- **לא לכתוב emoji לקבצי קוד אלא אם המשתמש ביקש**. UI כן משתמש (כפתורים).
- כל copy ב-UI הוא **עברית RTL**. תגובות אליו = **עברית**.
- כשעובדים על HTML של חוברת — להישאר עם `direction: rtl` ופונט עברי (Heebo / Assistant / Arial).

---

## 8. GitHub

המאגר: **`office351/solelim-publisher`** (פרטי).
הריחוק (`origin`) כולל **Personal Access Token** ישירות ב-URL:
```
https://office351:<TOKEN>@github.com/office351/solelim-publisher.git
```
זה ב-`.git/config`. `git push` עובד מיידית בלי בקשת אישור.

**אל תעלה את `.git/config` לשום מקום ציבורי** — הטוקן בפנים.

אם הטוקן הפסיק לעבוד, צור חדש ב-https://github.com/settings/tokens עם חשבון `office351` (scope: `repo`) והרץ:
```
git remote set-url origin https://office351:NEW_TOKEN@github.com/office351/solelim-publisher.git
```

---

## 9. סגנון עבודה עם המשתמש

הוא לא מפתח. הוא בעלים של עמותה. כללים:
- **בעברית RTL** תמיד
- **קצר וענייני** — סיכומים תכליתיים, בלי הסברים ארוכים. אם הוא רוצה הסבר, ישאל
- **commit + push** אחרי כל שינוי שעובד — לא לחכות לאישור
- **לא לפצל קבצים** ולא לעשות refactoring "כי זה יותר נקי" — הוא ביקש קוד שעובד, לא ארכיטקטורה מהדרת
- כשהוא אומר "תבדוק שעובד" — תריץ syntax check (`node --check server.js`) ותריץ unit tests אם יש. לא להתחיל לבנות בדיקות שלמות.
- **emoji בצ'אט** — אל תרבה. שורת תגובה אחת או שתיים. הוא לא מתרגש מ-✅ ✨ 🎉.

### דוגמאות בפועל
- "תיקנת מצוין" → "תודה!" (בלי שירה). פשוט מאשר.
- "לא עובד" → תקרא לוג, תאתר, תתקן, תעלה. לא לשאול שאלות מקדימות.
- שגיאה רצינית → תקפוץ ישר לאבחון. לא לעצור ולשאול.

---

## 10. סטטוס נוכחי (בזמן ההעברה)

✅ **עובד:**
- הגהה דו-שלבית + מספור רשימות אוטומטי
- יצירת 2 תמונות במקביל (OpenAI + Grok). **איכות התמונות לא מספיקה** — המשתמש מודע, כרגע מעדיף לשלוח לבוט GPT חיצוני
- כפתור "📋 העתק מאמר ופתח בוט" בראש קטע יצירת התמונה (לפני האפשרות ליצירה דרך המערכת)
- פרסום לוורדפרס + הודעת שגיאה ידידותית ל-529
- חוברת שבועית עם מספרי עמודים (CSS-based)
- Fallback להדפסה כשאין Puppeteer

🟡 **פתוחות / לא דחופות:**
- Puppeteer לא מותקן בשרת production — אם פעם המשתמש יבקש PDF נקי לגמרי, תגיד לו להריץ `npm install` שם
- איכות התמונות לא מספיקה — המשתמש ויתר על זה כרגע. אם פעם תגלה שירות חדש שמייצר תמונות באמת טובות (Midjourney API? Stable Diffusion 3 dedicated server?) — הצע

❌ **לא לעבוד עליהן בלי בקשה:**
- כל refactoring של server.js או index.html
- מעבר ל-React / Vue
- פיצול לקבצים

---

## 11. פקודות שימושיות

```bash
# התחל שרת מקומי
cd C:\Projects
node server.js
# אם חסרים מודולים — npm install קודם

# בדיקת syntax
node --check server.js

# בדיקת מספור רשימות (unit tests)
# (אין test runner — הבדיקות הוטמעו בצ'אט; אם צריך, אבקש לכתוב מחדש)

# git push בלי בקשת אישור (הטוקן בURL)
git add . && git commit -m "..." && git push
```

---

## 12. דברים שלמדנו בדרך הקשה

- **`@page { margin }` של CSS** חל על כל שבירת עמוד, כולל באמצע מאמר. `padding` על div לא — רק בתחילתו.
- **Chrome's print headers** מופיעים ב-margin של @page, אבל **אינם** דורסים `@bottom-center` של CSS. כיבוי "Headers and footers" משאיר רק את ה-CSS.
- **Grok API** — `n:1` לבד עובד. הוספת `size` או `response_format` מחזירה 400.
- **WordPress REST API** מחזיר 529 כשהאתר עמוס. הוסף retry או רק תגיד למשתמש לנסות שוב.
- **Puppeteer בשרת shared hosting** = פינה לא טריוויאלית. הfallback לhprintWindow פתר את זה.

---

## 13. שיחות עבר

ההיסטוריה המלאה ב:
```
C:\Users\<username>\.claude\projects\C--Projects\*.jsonl
```
כל קובץ = session אחד. הם ארוכים (אלפי שורות), אבל אם פעם תצטרך לבדוק "מה היה ב-X?" — תוכל לחפש שם.

---

**זהו. תתחיל לעבוד.**
