# ControlMapper Installation & Setup Guide

ControlMapper is a secure, browser-based tool for mapping Custom Controls to a Control Library using keyword and transformer-based semantic matching.

## Prerequisites

- **Modern Web Browser**: Chrome, Edge, or Firefox (recommended).
- **Internet Connection**: Required for first-time model download (unless using local model files).
- **Optional local server tools**: Python, Node.js, or VS Code Live Server (only needed if your environment blocks direct `file://` execution).

## Quick Start

To set up ControlMapper on a new laptop:

1. **Copy Files**:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `models/` (optional, if you want local/self-hosted model files)

2. **Launch the app**:
   - Open `index.html` directly in your browser (double-click or open with browser).

3. **If direct open is blocked in your environment**, run a local server:

   **Option A: Python**
   ```bash
   python -m http.server 8000
   ```

   **Option B: Node.js**
   ```bash
   npx serve .
   ```

   **Option C: VS Code Live Server**
   - Right-click `index.html` and select **Open with Live Server**.

4. **Access URL (if using server)**:
   - `http://localhost:8000` (or whichever port your server reports).

## Model Source Behavior

- Default model source is **GitHub Repo (Ompliance/ControlMapper)**.
- You can switch source in **Settings > Model Source**:
  - `GitHub Repo (Ompliance/ControlMapper)`
  - `Local Folder (Self-hosted)`
  - `Custom URL...`
- Model files are cached in browser storage after first successful load.

## Troubleshooting

- **Model fails to load**:
  - Check internet connection.
  - Confirm selected model source in Settings.
  - If using **Local Folder**, run via `http://localhost` instead of `file://` and ensure `models/` path exists.
- **CORS or module loading issues**:
  - Use one of the local server options above.
- **Excel parsing issues**:
  - Ensure files are in `.xlsx`, `.xls`, or `.csv` format.
