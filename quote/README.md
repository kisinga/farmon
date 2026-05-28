# MajiFlow Site

Static homepage + quotation page for GitHub Pages.

## Build

```bash
cd packages/core
npm run build:quotation
cp dist/quotation.esm.js ../../quote/quotation.esm.js
```

## Configure

Edit `quote.html` and set your Google Apps Script endpoint:

```html
<script>
  window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
</script>
```

## Deploy (manual)

```bash
git checkout --orphan gh-pages
git rm -rf .
cp -r quote/* .
git add .
git commit -m "Deploy site"
git push origin gh-pages
```

Enable GitHub Pages from the `gh-pages` branch in repository settings.
