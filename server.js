// server.js (WebSocket + Sync + Logging)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let connectedClients = [];
const handledCalls = new Set();
const logFile = path.join(__dirname, 'call_logs.json');

wss.on('connection', (ws) => {
  console.log('🟢 New staff connected');
  connectedClients.push(ws);

  ws.on('close', () => {
    console.log('🔌 Staff disconnected');
    connectedClients = connectedClients.filter(client => client !== ws);
  });
});

function notifyStaff(data) {
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
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

app.get('/', (req, res) => {
  res.send('Twilio server is running with WebSocket + Sync + Logging support.');
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
  console.log(`🚀 Server listening on http://localhost:${port}`);
});
