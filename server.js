const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" } // local dev aur deployment ke liye open
});
const path = require('path');

// Serve both user-client & admin-client
app.use('/user', express.static(path.join(__dirname, '../user-client')));
app.use('/admin', express.static(path.join(__dirname, '../admin-client')));

const PORT = process.env.PORT || 3000; // Render ke liye dynamic port

// In-memory storage
let sessions = {}; // { sessionId: [{role:'user'|'assistant', text, ts}] }
let queue = [];    // pending user questions

// Utility to generate unique session IDs
function genSessionId() {
  return 'S' + Math.random().toString(36).substring(2, 8);
}

// Optional root route
app.get('/', (req, res) => {
  res.send('Lucky AI Chat Server is running!');
});

// ----- Socket.io -----
const userNS = io.of('/user');
const adminNS = io.of('/admin');

// --- User namespace ---
userNS.on('connection', socket => {
  console.log('User connected:', socket.id);

  let sessionId = genSessionId();
  socket.data.sessionId = sessionId;
  sessions[sessionId] = sessions[sessionId] || [];

  socket.on('question', ({ text }) => {
    const msg = { role: 'user', text, ts: Date.now() };
    sessions[sessionId].push(msg);

    queue.push({ sessionId, lastQuestion: text, ts: msg.ts, text });
    adminNS.emit('question', { sessionId, lastQuestion: text, ts: msg.ts, text });
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

// --- Admin namespace ---
adminNS.on('connection', socket => {
  console.log('Admin connected:', socket.id);

  // Send current queue
  socket.on('fetchQueue', () => {
    socket.emit('queue', queue);
  });

  // Send session history
  socket.on('history', ({ sessionId }) => {
    const msgs = sessions[sessionId] || [];
    socket.emit('history', { sessionId, messages: msgs });
  });

  // Receive answer from admin
  socket.on('answer', ({ sessionId, text }) => {
    if(!sessions[sessionId]) return;

    const msg = { role:'assistant', text, ts: Date.now() };
    sessions[sessionId].push(msg);

    // Notify the user
    userNS.sockets.forEach(s => {
      if(s.data.sessionId === sessionId){
        s.emit('answer', msg);
      }
    });

    // Remove from queue
    queue = queue.filter(q => q.sessionId !== sessionId);

    // Update queue for all admins
    adminNS.emit('queue', queue);
  });

  socket.on('disconnect', () => console.log('Admin disconnected:', socket.id));
});

// Start server
http.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
