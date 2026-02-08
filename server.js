const express = require('express');
const puppeteer = require('puppeteer-core');
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
    console.log('--- LOG: Received /capture request ---');
    let targetUrl = req.body.url;
    console.log(`LOG: Target URL received: ${targetUrl}`);
    if (!targetUrl.startsWith('http')) {
        targetUrl = 'https://' + targetUrl;
        console.log(`LOG: Prepended https:// to URL: ${targetUrl}`);
    }
    
    const urlObj = new URL(targetUrl);
    
    const safeHostname = urlObj.hostname.replace(/[^a-z0-9]/gi, '_');
    const safePath = urlObj.pathname.replace(/[^a-z0-9]/gi, '_');
    const siteDir = path.join(STORAGE_DIR, safeHostname, safePath);
    const siteFile = path.join(siteDir, 'index.html');
    console.log(`LOG: Site directory: ${siteDir}, Site file: ${siteFile}`);

    // 1. Check if this specific page exists
    if (fs.existsSync(siteFile)) {
        console.log(`LOG: [CACHE HIT] Local file found: ${siteFile}`);
        const savedHtml = fs.readFileSync(siteFile, 'utf8');
        console.log('LOG: Successfully read saved HTML from cache.');
        return res.json({ html: savedHtml, fromCache: true, path: urlObj.pathname });
    }

    // 2. Otherwise, download it
    console.log(`LOG: [CACHE MISS] Fetching new page: ${targetUrl}`);
    let browser;
    try {
        console.log('LOG: Attempting to launch Puppeteer browser with args:', [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--no-zygote', 
            '--disable-web-security'
        ]);
        browser = await puppeteer.launch({ 
            headless: true, 
            executablePath: '/usr/bin/google-chrome', // Explicitly pointing to Chrome in the Docker image
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--no-zygote', 
                '--disable-web-security'
            ] 
        });
        console.log('LOG: Puppeteer browser launched successfully.');
        
        console.log('LOG: Creating new page.');
        const page = await browser.newPage();
        console.log('LOG: New page created.');
        
        console.log('LOG: Setting BypassCSP to true.');
        await page.setBypassCSP(true);
        
        console.log(`LOG: Navigating to ${targetUrl} with waitUntil: 'networkidle2', timeout: 60000ms.`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('LOG: Page navigation complete (networkidle2 reached).');

        console.log('LOG: Evaluating page content to hijack links.');
        const gameData = await page.evaluate(() => {
            document.querySelectorAll('a').forEach(link => {
                link.onclick = (e) => {
                    e.preventDefault();
                    window.parent.postMessage({type: 'navigate', url: link.href}, '*');
                };
            });
            return document.documentElement.outerHTML;
        });
        console.log('LOG: Page evaluation complete. Captured HTML length:', gameData.length);

        console.log('LOG: Checking if site directory exists.');
        if (!fs.existsSync(siteDir)) {
            console.log(`LOG: Site directory ${siteDir} does not exist, creating it.`);
            fs.mkdirSync(siteDir, { recursive: true });
            console.log(`LOG: Created directory: ${siteDir}`);
        }
        console.log(`LOG: Writing captured HTML to file: ${siteFile}`);
        fs.writeFileSync(siteFile, gameData);
        console.log(`LOG: Successfully saved page to: ${siteFile}`);

        console.log('LOG: Closing browser.');
        await browser.close();
        console.log('LOG: Browser closed.');
        res.json({ html: gameData, fromCache: false, path: urlObj.pathname });

    } catch (error) {
        console.error(`--- ERROR: Puppeteer capture failed: ${error.message} ---`);
        console.error('ERROR: Full error stack:', error.stack);
        if (browser) {
            console.log('LOG: Closing browser in error handler.');
            await browser.close();
            console.log('LOG: Browser closed in error handler.');
        }
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Deep Downloader: http://localhost:${port}`);
});