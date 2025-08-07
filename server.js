// server.js (FIXED: Push registration, call logs, notifications working)
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

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let connectedSockets = [];
const handledCalls = new Set();
const pushTokensFile = path.join(__dirname, 'push_tokens.json');
const logFile = path.join(__dirname, 'call_logs.json');

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeJsonFileSafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

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
  const logs = readJsonFileSafe(logFile);
  logs.unshift(entry);
  writeJsonFileSafe(logFile, logs.slice(0, 100));
}

async function sendExpoPushNotifications() {
  const pushTokens = readJsonFileSafe(pushTokensFile);
  if (!pushTokens.length) {
    console.warn('⚠️ No Expo push tokens registered.');
    return;
  }

  const messages = pushTokens.map(token => ({
    to: token,
    sound: 'default',
    title: '📞 Incoming Call',
    body: 'Sidney Kiosk is calling for support.',
    data: { type: 'incoming_call' },
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages)
    });

    const data = await response.json();
    console.log('🔔 Expo push response:', data);
  } catch (err) {
    console.error('❌ Expo push error:', err);
  }
}

app.post('/register-token', (req, res) => {
  const { token } = req.body;
  if (token) {
    const tokens = readJsonFileSafe(pushTokensFile);
    if (!tokens.includes(token)) {
      tokens.push(token);
      writeJsonFileSafe(pushTokensFile, tokens);
      console.log('✅ Registered push token:', token);
    }
  }
  res.sendStatus(200);
});

app.post('/unregister-token', (req, res) => {
  const { token } = req.body;
  const tokens = readJsonFileSafe(pushTokensFile);
  const newTokens = tokens.filter(t => t !== token);
  writeJsonFileSafe(pushTokensFile, newTokens);
  console.log('🚫 Unregistered push token:', token);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Twilio server with Socket.IO + Expo Push + DND support is running.');
});

app.get('/logs', (req, res) => {
  const logs = readJsonFileSafe(logFile);
  res.status(200).json(logs);
});

app.post('/start-call', async (req, res) => {
  const { to } = req.body;
  if (!to) {
    console.error('❌ Missing phone number in request');
    return res.status(400).json({ message: 'Missing "to" field in body' });
  }

  try {
    const call = await client.calls.create({
      to,
      from: twilioNumber,
      url: `${process.env.PUBLIC_URL || 'https://twilio-voice-server-8uz5.onrender.com'}/voice`,
    });

    console.log(`✅ Call initiated successfully: SID=${call.sid}`);
    notifyStaff({ type: 'incoming_call', from: 'Sidney Kiosk', sid: call.sid });
    sendExpoPushNotifications();

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
