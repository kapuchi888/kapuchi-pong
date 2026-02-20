const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const playerRooms = {};
const leaderboard = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createGameState() {
  return {
    ball: { x: 50, y: 50, vx: 0, vy: 0, speed: 1.5 },
    paddles: {
      player1: { x: 50, y: 92, width: 18, score: 0 },
      player2: { x: 50, y: 8,  width: 18, score: 0 }
    },
    status: 'waiting',
    pauseReason: null,
    readyVotes: 0,
    lastScorer: null,
    winner: null,
    maxScore: 7
  };
}

const TICK_RATE   = 1000 / 60;
const BALL_RADIUS = 1.5;
const PADDLE_H    = 2;

function gameTick(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state.status !== 'playing') return;

  const state = room.state;
  const ball  = state.ball;
  const p1    = state.paddles.player1;
  const p2    = state.paddles.player2;

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.x - BALL_RADIUS <= 0)   { ball.x = BALL_RADIUS;       ball.vx =  Math.abs(ball.vx); }
  if (ball.x + BALL_RADIUS >= 100) { ball.x = 100 - BALL_RADIUS; ball.vx = -Math.abs(ball.vx); }

  // paddle P1 (bottom)
  if (ball.vy > 0 &&
      ball.y + BALL_RADIUS >= p1.y - PADDLE_H / 2 &&
      ball.y - BALL_RADIUS <= p1.y + PADDLE_H / 2 &&
      ball.x >= p1.x - p1.width / 2 &&
      ball.x <= p1.x + p1.width / 2) {
    ball.y = p1.y - PADDLE_H / 2 - BALL_RADIUS;
    const off = (ball.x - p1.x) / (p1.width / 2);
    ball.speed = Math.min(ball.speed + 0.15, 5);
    ball.vx = off * ball.speed * 0.8;
    ball.vy = -ball.speed;
  }

  // paddle P2 (top)
  if (ball.vy < 0 &&
      ball.y - BALL_RADIUS <= p2.y + PADDLE_H / 2 &&
      ball.y + BALL_RADIUS >= p2.y - PADDLE_H / 2 &&
      ball.x >= p2.x - p2.width / 2 &&
      ball.x <= p2.x + p2.width / 2) {
    ball.y = p2.y + PADDLE_H / 2 + BALL_RADIUS;
    const off = (ball.x - p2.x) / (p2.width / 2);
    ball.speed = Math.min(ball.speed + 0.15, 5);
    ball.vx = off * ball.speed * 0.8;
    ball.vy = ball.speed;
  }

  if (ball.y > 105) {
    p2.score++;
    state.lastScorer = 'player2';
    handleGoal(roomCode, -1);
    return;
  }

  if (ball.y < -5) {
    p1.score++;
    state.lastScorer = 'player1';
    handleGoal(roomCode, 1);
    return;
  }

  io.to(roomCode).emit('gameState', state);
}

function handleGoal(roomCode, nextDirection) {
  const room = rooms[roomCode];
  if (!room) return;
  const state = room.state;

  if (state.paddles.player1.score >= state.maxScore ||
      state.paddles.player2.score >= state.maxScore) {
    state.status = 'finished';
    state.winner = state.paddles.player1.score >= state.maxScore ? 'player1' : 'player2';
    if (room.interval) { clearInterval(room.interval); room.interval = null; }
    updateLeaderboard(roomCode);
    io.to(roomCode).emit('gameState', state);
    io.to(roomCode).emit('gameOver', {
      winner: state.winner,
      scores: { p1: state.paddles.player1.score, p2: state.paddles.player2.score },
      leaderboard: getTopLeaderboard()
    });
    return;
  }

  state.status      = 'paused';
  state.pauseReason = 'goal';
  state.readyVotes  = 0;
  room.nextDirection = nextDirection;

  state.ball.x  = 50;
  state.ball.y  = 50;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.speed = 1.5;

  io.to(roomCode).emit('gameState', state);
  io.to(roomCode).emit('goalPause', {
    scorer: state.lastScorer,
    scores: { p1: state.paddles.player1.score, p2: state.paddles.player2.score }
  });
}

function handleReadyVote(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state.status !== 'paused') return;

  room.state.readyVotes++;
  io.to(roomCode).emit('readyVotes', { votes: room.state.readyVotes });

  if (room.state.readyVotes >= 2) {
    room.state.readyVotes  = 0;
    room.state.status      = 'playing';
    room.state.pauseReason = null;
    const dir = room.nextDirection || 1;
    room.state.ball.vx = (Math.random() - 0.5) * 2;
    room.state.ball.vy = dir * 1.5;
    io.to(roomCode).emit('resumeGame');
  }
}

function updateLeaderboard(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const state    = room.state;
  const winnerId = state.winner === 'player1' ? room.players[0] : room.players[1];
  const loserId  = state.winner === 'player1' ? room.players[1] : room.players[0];
  if (winnerId) {
    leaderboard[winnerId] = leaderboard[winnerId] || { wins: 0, losses: 0, name: room.playerNames[winnerId] };
    leaderboard[winnerId].wins++;
  }
  if (loserId) {
    leaderboard[loserId] = leaderboard[loserId] || { wins: 0, losses: 0, name: room.playerNames[loserId] };
    leaderboard[loserId].losses++;
  }
}

function getTopLeaderboard() {
  return Object.values(leaderboard)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10)
    .map(e => ({ name: e.name, wins: e.wins, losses: e.losses }));
}

function startCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  let count = 3;
  io.to(roomCode).emit('countdown', { count });
  const cd = setInterval(() => {
    count--;
    if (count > 0) {
      io.to(roomCode).emit('countdown', { count });
    } else {
      clearInterval(cd);
      room.state.status  = 'playing';
      room.state.ball.vx = (Math.random() - 0.5) * 2;
      room.state.ball.vy = 1.5;
      io.to(roomCode).emit('gameStart');
      if (room.interval) clearInterval(room.interval);
      room.interval = setInterval(() => gameTick(roomCode), TICK_RATE);
    }
  }, 1000);
}

io.on('connection', (socket) => {

  socket.on('createRoom', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [socket.id],
      playerNames: { [socket.id]: playerName || 'Player 1' },
      state: createGameState(),
      interval: null,
      nextDirection: 1
    };
    playerRooms[socket.id] = code;
    socket.join(code);
    socket.emit('roomCreated', { code, role: 'player1' });
  });

  socket.on('joinRoom', ({ code, playerName }) => {
    const roomCode = code.toUpperCase();
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', { message: 'Sala no encontrada' });
    if (room.players.length >= 2) return socket.emit('error', { message: 'Sala llena' });

    room.players.push(socket.id);
    room.playerNames[socket.id] = playerName || 'Player 2';
    playerRooms[socket.id] = roomCode;
    socket.join(roomCode);

    socket.emit('roomJoined', { code: roomCode, role: 'player2' });
    io.to(roomCode).emit('playerJoined', {
      names: {
        player1: room.playerNames[room.players[0]],
        player2: room.playerNames[room.players[1]]
      }
    });
    startCountdown(roomCode);
  });

  socket.on('paddleMove', ({ x }) => {
    const roomCode = playerRooms[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room || (room.state.status !== 'playing' && room.state.status !== 'paused')) return;
    const role   = room.players[0] === socket.id ? 'player1' : 'player2';
    const paddle = room.state.paddles[role];
    paddle.x = Math.max(paddle.width / 2, Math.min(100 - paddle.width / 2, x));
  });

  socket.on('readyAfterGoal', () => {
    const roomCode = playerRooms[socket.id];
    if (roomCode) handleReadyVote(roomCode);
  });

  socket.on('rematch', () => {
    const roomCode = playerRooms[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room) return;

    room.rematchVotes = (room.rematchVotes || 0) + 1;
    io.to(roomCode).emit('rematchVote', { votes: room.rematchVotes });

    if (room.rematchVotes >= 2) {
      room.rematchVotes  = 0;
      room.nextDirection = 1;
      if (room.interval) { clearInterval(room.interval); room.interval = null; }
      room.state = createGameState();
      io.to(roomCode).emit('rematchStart');
      startCountdown(roomCode);
    }
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboard', getTopLeaderboard());
  });

  socket.on('disconnect', () => {
    const roomCode = playerRooms[socket.id];
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (room.interval) clearInterval(room.interval);
      io.to(roomCode).emit('playerDisconnected');
      delete rooms[roomCode];
    }
    delete playerRooms[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`KAPUCHI PONG server running on port ${PORT}`));
