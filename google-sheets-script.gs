// סקריפט שמקבל פניות מטופס יצירת הקשר באתר ושומר כל פנייה כשורה בגיליון.
// הדבקה: בגיליון Google Sheets ← תוספים (Extensions) ← Apps Script ← להחליף את כל הקוד בזה.
// אחרי כל שינוי: פריסה ← ניהול פריסות ← עריכה (עיפרון) ← גרסה: גרסה חדשה ← פריסה.

const HEADERS = ['תאריך', 'שם', 'טלפון', 'אימייל', 'נושא', 'הודעה'];
const FIELDS = ['name', 'phone', 'email', 'topic', 'message'];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setRightToLeft(true);
    sheet.setFrozenRows(1);
  }
  const p = (e && e.parameter) || {};
  const values = FIELDS.map(f => String(p[f] || ''));
  // גרש בהתחלה כדי שגוגל לא ימחק את ה-0 של מספר הטלפון
  if (values[1]) values[1] = "'" + values[1];
  sheet.appendRow([new Date()].concat(values));
  return ContentService.createTextOutput(JSON.stringify({ ok: true, saved: values }))
    .setMimeType(ContentService.MimeType.JSON);
}
