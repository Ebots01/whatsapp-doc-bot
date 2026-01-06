const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { put } = require("@vercel/blob");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // NEW: We use this now

// 1. WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. RECEIVE MESSAGES
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("Incoming Webhook:", JSON.stringify(body, null, 2)); // LOGS

  if (!body.object) return res.sendStatus(404);

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from;
      const msgType = message.type;
      
      // Use the ID from env OR extract it if env is missing
      const businessPhoneId = PHONE_NUMBER_ID || value.metadata.phone_number_id;

      // REPLY TO TEXT
      if (msgType === "text") {
        await sendMessage(businessPhoneId, from, "I received your text! Send me a PDF.");
      } 
      // REPLY TO DOCUMENT/IMAGE
      else if (msgType === "document" || msgType === "image") {
        const mediaId = msgType === "document" ? message.document.id : message.image.id;
        const fileName = msgType === "document" ? message.document.filename : `image.jpg`;

        // 1. Get URL
        const urlRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        
        // 2. Download
        const imgRes = await axios.get(urlRes.data.url, {
          responseType: "arraybuffer",
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });

        // 3. Upload to Blob
        const blob = await put(fileName, imgRes.data, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN
        });

        // 4. Reply
        await sendMessage(businessPhoneId, from, `Saved! Download: ${blob.url}`);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("ERROR:", error.response ? error.response.data : error.message);
    res.sendStatus(500);
  }
});

// Helper function to send messages
async function sendMessage(phoneId, to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${phoneId}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));