# TEAMSPIRIT order intake

This Apps Script receives checkout payloads from the static GitHub Pages website and appends them to the TEAMSPIRIT Google Sheet.

## One-time deployment

1. Open the destination Google Sheet.
2. Select **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs`.
4. Select **Deploy → New deployment → Web app**.
5. Execute as: **Me**. Who has access: **Anyone**.
6. Authorize the script and copy the `/exec` deployment URL.
7. Paste that URL into `assets/order-config.js` as `endpoint`.

Do not place Google credentials or API keys in the website repository.
