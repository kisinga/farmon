# MajiFlow Quick Quote

A static questionnaire that generates hardware quotations. Designed to run on GitHub Pages.

## Setup

### 1. Build the quotation bundle

```bash
cd packages/core
npm run build:quotation
```

This produces `packages/core/dist/quotation.esm.js`.

### 2. Copy the bundle into this folder

```bash
cp ../packages/core/dist/quotation.esm.js ./quotation.esm.js
```

### 3. Configure the Google Apps Script endpoint

Edit `index.html` and replace `YOUR_SCRIPT_ID` in this line:

```html
<script>
  window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
</script>
```

### 4. Deploy to GitHub Pages

Push this `quote/` folder to a `gh-pages` branch (or a separate repo) and enable GitHub Pages.

## Google Apps Script Backend

Create a new Google Apps Script project bound to a Google Sheet. Use this code:

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Append row: timestamp, name, email, phone, quoteId, subtotal, itemsJSON
  sheet.appendRow([
    new Date(),
    data.customerName,
    data.customerEmail,
    data.customerPhone,
    data.quoteId,
    data.subtotal,
    JSON.stringify(data.items),
  ]);

  // Email yourself
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: `MajiFlow Quote ${data.quoteId}`,
    body: `
New quotation request:

Name: ${data.customerName}
Email: ${data.customerEmail}
Phone: ${data.customerPhone}
Quote ID: ${data.quoteId}
Subtotal: KSh ${data.subtotal}

Items:
${data.items.map(i => `- ${i.name} x${i.qty} = $${i.lineTotal.toFixed(2)}`).join('\n')}
    `.trim(),
  });

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Deploy the script as a Web App with execute permissions set to "Anyone".
