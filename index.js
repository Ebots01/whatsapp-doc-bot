// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// -------------------------------------------------------------
// CONFIGURATION
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'MY_VERIFY_TOKEN';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // Get this from Meta Developer Portal

// -------------------------------------------------------------
// IN-MEMORY STORAGE (Resets when server restarts)
// -------------------------------------------------------------
let receivedFiles = []; 

// -------------------------------------------------------------
// WEB UI (Make the server look good!)
// -------------------------------------------------------------
app.get('/', (req, res) => {
  const fileRows = receivedFiles.map(f => `
    <tr>
      <td class="px-4 py-2 border">${f.timestamp}</td>
      <td class="px-4 py-2 border font-bold text-green-700">${f.pathname}</td>
      <td class="px-4 py-2 border">${f.mime_type}</td>
      <td class="px-4 py-2 border">
        <a href="${f.url}" target="_blank" class="text-blue-500 hover:underline">Download</a>
      </td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp Doc Server</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 p-10 font-sans">
      <div class="max-w-4xl mx-auto bg-white shadow-lg rounded-lg overflow-hidden">
        <div class="bg-teal-600 p-6">
          <h1 class="text-white text-2xl font-bold">WhatsApp Document Server</h1>
          <p class="text-teal-100">Status: Online 🟢 | Files tracked: ${receivedFiles.length}</p>
        </div>
        
        <div class="p-6">
          <h2 class="text-xl font-semibold mb-4 text-gray-700">Received Documents</h2>
          <div class="overflow-x-auto">
            <table class="table-auto w-full text-left">
              <thead>
                <tr class="bg-gray-200 text-gray-600 text-sm">
                  <th class="px-4 py-2">Time</th>
                  <th class="px-4 py-2">Filename</th>
                  <th class="px-4 py-2">Type</th>
                  <th class="px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                ${receivedFiles.length > 0 ? fileRows : '<tr><td colspan="4" class="p-4 text-center text-gray-400">No documents received yet. Send a PDF to the bot!</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// -------------------------------------------------------------
// API FOR FLUTTER APP
// -------------------------------------------------------------

// 1. List Files Endpoint (Called by _apiService.getBlobList)
app.get('/api/files', (req, res) => {
  // Returns the format your Flutter app expects
  res.json(receivedFiles);
});

// 2. Proxy Download Endpoint (Called by _apiService.downloadFile)
// This fetches the file from WhatsApp and pipes it to Flutter
app.get('/api/proxy/:mediaId', async (req, res) => {
  const mediaId = req.params.mediaId;
  
  try {
    // A. Get the Media URL from WhatsApp Graph API
    const urlResponse = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    
    const mediaUrl = urlResponse.data.url;

    // B. Download the actual binary data
    const fileResponse = await axios({
      method: 'get',
      url: mediaUrl,
      responseType: 'stream',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });

    // C. Pipe it to the Flutter App
    res.setHeader('Content-Type', urlResponse.data.mime_type);
    fileResponse.data.pipe(res);

  } catch (error) {
    console.error("Download Error:", error.message);
    res.status(500).send("Failed to retrieve file from WhatsApp");
  }
});

// -------------------------------------------------------------
// WHATSAPP WEBHOOKS
// -------------------------------------------------------------

// Verification Challenge
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && 
      req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Receive Messages
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object) {
    if (body.entry && 
        body.entry[0].changes && 
        body.entry[0].changes[0].value.messages && 
        body.entry[0].changes[0].value.messages[0]
    ) {
      const msg = body.entry[0].changes[0].value.messages[0];

      // Check if message is a Document
      if (msg.type === 'document') {
        const doc = msg.document;
        
        // Create a record of this file
        // We construct a PROXY URL so Flutter can download it via our server
        const fileRecord = {
          pathname: doc.filename || `doc_${msg.timestamp}.pdf`,
          mime_type: doc.mime_type,
          timestamp: new Date().toLocaleTimeString(),
          // This URL points back to THIS server
          url: `${process.env.SERVER_URL || ''}/api/proxy/${doc.id}`
        };

        receivedFiles.unshift(fileRecord); // Add to top of list
        console.log(`Received Document: ${doc.filename}`);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
