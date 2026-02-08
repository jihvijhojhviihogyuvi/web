const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

const STORAGE_DIR = path.join(__dirname, 'saved_sites');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Deep Offline Loader</title>
            <style>
                body, html { margin: 0; padding: 0; height: 100%; width: 100%; font-family: sans-serif; background: #1a1a1a; color: white; overflow: hidden; display: flex; flex-direction: column; }
                #navbar { display: flex; align-items: center; justify-content: center; padding: 10px; background: #2d2d2d; z-index: 10; border-bottom: 2px solid #444; }
                input { width: 450px; padding: 10px; border-radius: 4px 0 0 4px; border: 1px solid #444; background: #333; color: white; outline: none; }
                button { padding: 10px 20px; border-radius: 0 4px 4px 0; border: none; background: #007bff; color: white; cursor: pointer; font-weight: bold; }
                #status { margin-left: 20px; color: #00ff00; font-family: monospace; }
                #gameViewport { flex-grow: 1; width: 100%; background: #000; }
                iframe { width: 100%; height: 100%; border: none; }
            </style>
        </head>
        <body>
            <div id="navbar">
                <input type="text" id="urlInput" placeholder="Enter full URL (e.g. site.com/game)">
                <button onclick="loadGame()">LOAD & SAVE</button>
                <div id="status">Ready</div>
            </div>
            <div id="gameViewport">
                <iframe id="displayFrame" style="display: none;"></iframe>
            </div>

            <script>
                async function loadGame(targetUrl) {
                    const url = targetUrl || document.getElementById('urlInput').value;
                    if (!url) return;
                    if (targetUrl) document.getElementById('urlInput').value = targetUrl;
                    
                    const status = document.getElementById('status');
                    const iframe = document.getElementById('displayFrame');

                    status.innerText = "⏳ Checking path...";
                    iframe.style.display = "none";

                    try {
                        const response = await fetch('/capture', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });

                        const data = await response.json();
                        if (data.html) {
                            status.innerText = data.fromCache ? "📁 [LOCAL] " + data.path : "🌐 [SAVED] " + data.path;
                            iframe.style.display = "block";
                            iframe.srcdoc = data.html;

                            window.onmessage = (e) => {
                                if(e.data.type === 'navigate') loadGame(e.data.url);
                            };
                        }
                    } catch (err) {
                        status.innerText = "❌ Error: " + err.message;
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/capture', async (req, res) => {
    let targetUrl = req.body.url;
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
    
    const urlObj = new URL(targetUrl);
    
    // Create a path based on the hostname + the URL path
    // Example: crazygames.com/game-name -> saved_sites/crazygames_com/game_name/index.html
    const safeHostname = urlObj.hostname.replace(/[^a-z0-9]/gi, '_');
    const safePath = urlObj.pathname.replace(/[^a-z0-9]/gi, '_');
    const siteDir = path.join(STORAGE_DIR, safeHostname, safePath);
    const siteFile = path.join(siteDir, 'index.html');

    // 1. Check if this specific page exists
    if (fs.existsSync(siteFile)) {
        console.log(`[LOCAL] Loading from: ${siteFile}`);
        const savedHtml = fs.readFileSync(siteFile, 'utf8');
        return res.json({ html: savedHtml, fromCache: true, path: urlObj.pathname });
    }

    // 2. Otherwise, download it
    console.log(`[FETCH] Capturing new page: ${targetUrl}`);
    let browser;
    try {
        browser = await puppeteer.launch({ 
    headless: true, 
    executablePath: '/usr/bin/google-chrome', // Point to the Docker-installed Chrome
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-web-security'
    ] 
});
        const page = await browser.newPage();
        await page.setBypassCSP(true);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const gameData = await page.evaluate(() => {
            // Hijack links to keep them in our system
            document.querySelectorAll('a').forEach(link => {
                link.onclick = (e) => {
                    e.preventDefault();
                    window.parent.postMessage({type: 'navigate', url: link.href}, '*');
                };
            });
            return document.documentElement.outerHTML;
        });

        // Ensure directories exist and save
        if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
        fs.writeFileSync(siteFile, gameData);

        await browser.close();
        res.json({ html: gameData, fromCache: false, path: urlObj.pathname });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Deep Downloader: http://localhost:${port}`);
});