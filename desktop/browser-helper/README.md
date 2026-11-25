# Memoria Browser Connect

A tiny browser extension that hands your HoYoLAB or SKPORT sign-in from your own
browser to the Memoria app on this PC. It reads only the sign-in cookies Memoria
needs and sends them to `127.0.0.1` (Memoria itself). Nothing goes anywhere else.

## Install (once)

1. **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`).
   **Firefox:** open `about:debugging#/runtime/this-firefox`.
2. **Chrome or Edge:** turn on **Developer mode**.
3. **Chrome or Edge:** click **Load unpacked** and choose this `browser-helper` folder.
   **Firefox:** click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
4. Pin **Memoria Browser Connect** to the toolbar.

## Use

In Memoria, choose **Connect with browser**. Sign in on the page that opens,
click the extension, type the 6-character code Memoria shows and press
**Send to Memoria**. The code works once and expires after 5 minutes.
