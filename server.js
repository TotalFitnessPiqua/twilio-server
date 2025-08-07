// server.js (Socket.IO + OneSignal + Twilio)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
const port = 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

const onesignalAppId = '0c936656-0b62-452c-81a8-6ab5c3bcca40';
const onesignalApiKey = process.env.ONESIGNAL_API_KEY;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let connectedSockets = [];
const handledCalls = new Set();
const logFile = path.join(__dirname, 'call_logs.json');

io.on('connection', (socket) => {
  console.log('🟢 Staff connected via Socket.IO');
  connectedSockets.push(socket);

  socket.on('disconnect', () => {
    console.log('🔌 Staff disconnected');
    connectedSockets = connectedSockets.filter(s => s !== socket);
  });
});

function notifyStaff(data) {
  connectedSockets.forEach(socket => {
    socket.emit(data.type, data);
  });
}

function saveCallLog(entry) {
  fs.readFile(logFile, 'utf8', (err, data) => {
    let logs = [];
    if (!err && data) {
      try {
        logs = JSON.parse(data);
      } catch {}
    }
    logs.unshift(entry);
    fs.writeFile(logFile, JSON.stringify(logs.slice(0, 100), null, 2), err => {
      if (err) console.error('❌ Failed to write log:', err);
    });
  });
}

async function sendPushNotification() {
  const payload = {
    app_id: onesignalAppId,
    included_segments: ["Subscribed Users"],
    headings: { en: "Incoming Call" },
    contents: { en: "Sidney Kiosk is calling for support." },
    url: "https://www.totalfitnessappstaff.netlify.app"
  };

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${onesignalApiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.ok) {
      console.log('🔔 Push notification sent:', data.id);
    } else {
      console.error('❌ Failed to send push:', data.errors || data);
    }
  } catch (err) {
    console.error('❌ Push error:', err);
  }
}

app.get('/', (req, res) => {
  res.send('Twilio server with Socket.IO + OneSignal integration is running.');
});

app.get('/logs', (req, res) => {
  fs.readFile(logFile, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ message: 'Could not read logs' });
    try {
      const logs = JSON.parse(data);
      res.status(200).json(logs);
    } catch {
      res.status(500).json({ message: 'Invalid log data' });
    }
  });
});

app.post('/start-call', async (req, res) => {
  const { to } = req.body;
  if (!to) {
    console.error('❌ Missing phone number in request');
    return res.status(400).json({ message: 'Missing \"to\" field in body' });
  }

  try {
    const call = await client.calls.create({
      to,
      from: twilioNumber,
      url: `${process.env.PUBLIC_URL || 'https://twilio-voice-server-8uz5.onrender.com'}/voice`,
    });

    console.log(`✅ Call initiated successfully: SID=${call.sid}`);
    notifyStaff({ type: 'incoming_call', from: 'Sidney Kiosk', sid: call.sid });
    sendPushNotification();

    res.status(200).json({ message: 'Call initiated', sid: call.sid });
  } catch (error) {
    console.error('❌ Call failed:', error.message);
    res.status(500).json({ message: 'Call failed', error: error.message });
  }
});

app.post('/call-response', (req, res) => {
  const { sid, accepted } = req.body;
  if (!sid || typeof accepted === 'undefined') {
    return res.status(400).json({ message: 'Missing sid or accepted flag.' });
  }
  if (handledCalls.has(sid)) {
    return res.status(409).json({ message: 'Call already handled by another staff.' });
  }
  handledCalls.add(sid);

  const logEntry = {
    sid,
    accepted,
    time: new Date().toISOString(),
    source: 'Sidney Kiosk'
  };
  saveCallLog(logEntry);

  notifyStaff({ type: 'call_resolved', sid, accepted });
  console.log(`📥 Staff responded to call SID=${sid}: ${accepted ? '✅ Accepted' : '❌ Declined'}`);
  res.status(200).json({ message: 'Response logged' });
});

app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Hello. You are receiving a support request from the Total Fitness Kiosk. Please assist as soon as possible.');
  res.type('text/xml');
  res.send(twiml.toString());
});

server.listen(port, () => {
  console.log(`🚀 Twilio Socket.IO server running on http://localhost:${port}`);
});
