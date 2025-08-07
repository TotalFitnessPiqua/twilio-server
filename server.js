// server.js (Socket.IO + Twilio + SMS Login)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

const { findUser, verifyPassword } = require('./auth');

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

const handledCalls = new Set();
const connectedSockets = [];
const logFile = path.join(__dirname, 'call_logs.json');
const sessionsFile = path.join(__dirname, 'sessions.json');

io.on('connection', (socket) => {
  console.log('🟢 Staff connected via Socket.IO');
  connectedSockets.push(socket);

  socket.on('disconnect', () => {
    console.log('🔌 Staff disconnected');
    const index = connectedSockets.indexOf(socket);
    if (index !== -1) connectedSockets.splice(index, 1);
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

function loadSessions() {
  try {
    const data = fs.readFileSync(sessionsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
}

// Routes

app.get('/', (req, res) => {
  res.send('Twilio server with login/session system running.');
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

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Missing credentials' });
  }

  const user = findUser(username);
  if (!user || !verifyPassword(password, user.hashedPassword)) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  const sessions = loadSessions();
  const token = crypto.randomBytes(16).toString('hex');
  sessions[token] = { username: user.username, createdAt: new Date().toISOString() };
  saveSessions(sessions);

  res.json({ token });
});

app.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No auth token' });

  const token = auth.replace('Bearer ', '');
  const sessions = loadSessions();
  const session = sessions[token];

  if (!session) return res.status(403).json({ message: 'Invalid or expired session' });

  const user = findUser(session.username);
  if (!user) return res.status(404).json({ message: 'User not found' });

  res.json({
    username: user.username,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    branch: user.branch || '',
    birthday: user.birthday || ''
  });
});

server.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
