# ControlMapper Installation & Setup Guide

ControlMapper is a secure, browser-based tool for mapping custom controls to Drata controls using keyword and AI-powered semantic matching.

## Prerequisites

- **Modern Web Browser**: Chrome, Edge, or Firefox (recommended).
- **Python or Node.js**: Required to run a simple local web server (to handle ES modules and browser security).
- **Internet Connection**: Required for the initial download of the AI Semantic Model (cached after first use) and to load dependencies from CDNs.

## Quick Start (Installation)

To set up ControlMapper on a new laptop:

1.  **Copy Files**: Copy the following files/folders from the source machine to a folder on the new laptop:
    - `index.html`
    - `app.js`
    - `styles.css`
    - `models/` (Optional: if you want to include the AI model files localy)

2.  **Start a Local Server**:
    Because the tool uses ES Modules and requires a secure context for some AI features, you **cannot** simply double-click `index.html`. You must run it through a web server.

    **Option A: Using Python (Easiest)**
    Open a terminal/command prompt in the project folder and run:
    ```bash
    python3 -m http.server 8000
    ```

    **Option B: Using Node.js (npx)**
    If you have Node.js installed, run:
    ```bash
    npx serve .
    ```

    **Option C: VS Code Live Server**
    If you use VS Code, install the "Live Server" extension, right-click `index.html`, and select "Open with Live Server".

3.  **Access the Tool**:
    Open your browser and go to:
    `http://localhost:8000` (or the port provided by your server).

## Using the AI Semantic Matching

- On the first run, the tool will attempt to download the AI model (~25MB) from Hugging Face.
- **Corporate Firewalls**: If your network blocks Hugging Face, go to the **Settings** tab and change the **Model Source** to "HF Mirror" or "Local Folder" (if you copied the `models/` directory).
- Once downloaded, the model is cached in your browser's IndexedDB for offline use.

## Troubleshooting

- **"File not found" or "CORS Error"**: Ensure you are running the tool via a local web server (`http://localhost`) and not opening the file directly (`file://`).
- **AI Model Fails to Load**: Check your internet connection or try switching the Model Source in Settings.
- **Excel Parsing Issues**: Ensure your files are in `.xlsx`, `.xls`, or `.csv` format.
