// סקריפט שמקבל פניות מטופס יצירת הקשר באתר ושומר כל פנייה כשורה בגיליון.
// הדבקה: בגיליון Google Sheets ← תוספים (Extensions) ← Apps Script ← להחליף את כל הקוד בזה.

const HEADERS = ['תאריך', 'שם', 'טלפון', 'אימייל', 'נושא', 'הודעה'];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setRightToLeft(true);
    sheet.setFrozenRows(1);
  }
  const p = e.parameter;
  sheet.appendRow([
    new Date(),
    p['שם'] || '',
    // גרש בהתחלה כדי שגוגל לא ימחק את ה-0 של מספר הטלפון
    p['טלפון'] ? "'" + p['טלפון'] : '',
    p['אימייל'] || '',
    p['נושא'] || '',
    p['הודעה'] || ''
  ]);
  return ContentService.createTextOutput('ok');
}
