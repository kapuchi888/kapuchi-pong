const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game rooms
const rooms = {};
const playerRooms = {};

// Leaderboard (in-memory)
const leaderboard = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createGameState() {
  return {
    ball: { x: 50, y: 50, vx: 1.5, vy: 1.5, speed: 1.5 },
    paddles: {
      player1: { x: 50, y: 92, width: 18, score: 0 },
      player2: { x: 50, y: 8, width: 18, score: 0 }
    },
    status: 'waiting', // waiting, playing, paused, finished
    winner: null,
    maxScore: 7
  };
}

const TICK_RATE = 1000 / 60; // 60fps
const BALL_RADIUS = 1.5;
const PADDLE_HEIGHT = 2;

function gameTick(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state.status !== 'playing') return;

  const state = room.state;
  const ball = state.ball;
  const p1 = state.paddles.player1;
  const p2 = state.paddles.player2;

  // Move ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Wall bounce (left/right)
  if (ball.x - BALL_RADIUS <= 0) { ball.x = BALL_RADIUS; ball.vx = Math.abs(ball.vx); }
  if (ball.x + BALL_RADIUS >= 100) { ball.x = 100 - BALL_RADIUS; ball.vx = -Math.abs(ball.vx); }

  // Paddle collision - Player1 (bottom, y~92)
  if (ball.vy > 0 && ball.y + BALL_RADIUS >= p1.y - PADDLE_HEIGHT / 2 && ball.y - BALL_RADIUS <= p1.y + PADDLE_HEIGHT / 2) {
    if (ball.x >= p1.x - p1.width / 2 && ball.x <= p1.x + p1.width / 2) {
      ball.y = p1.y - PADDLE_HEIGHT / 2 - BALL_RADIUS;
      const offset = (ball.x - p1.x) / (p1.width / 2);
      ball.speed = Math.min(ball.speed + 0.15, 5);
      ball.vx = offset * ball.speed * 0.8;
      ball.vy = -ball.speed;
    }
  }

  // Paddle collision - Player2 (top, y~8)
  if (ball.vy < 0 && ball.y - BALL_RADIUS <= p2.y + PADDLE_HEIGHT / 2 && ball.y + BALL_RADIUS >= p2.y - PADDLE_HEIGHT / 2) {
    if (ball.x >= p2.x - p2.width / 2 && ball.x <= p2.x + p2.width / 2) {
      ball.y = p2.y + PADDLE_HEIGHT / 2 + BALL_RADIUS;
      const offset = (ball.x - p2.x) / (p2.width / 2);
      ball.speed = Math.min(ball.speed + 0.15, 5);
      ball.vx = offset * ball.speed * 0.8;
      ball.vy = ball.speed;
    }
  }

  // Score - ball goes past player1 (bottom)
  if (ball.y > 105) {
    p2.score++;
    checkWinner(roomCode);
    resetBall(state, -1);
  }

  // Score - ball goes past player2 (top)
  if (ball.y < -5) {
    p1.score++;
    checkWinner(roomCode);
    resetBall(state, 1);
  }

  // Broadcast state
  io.to(roomCode).emit('gameState', state);
}

function resetBall(state, direction) {
  state.ball.x = 50;
  state.ball.y = 50;
  state.ball.speed = 1.5;
  state.ball.vx = (Math.random() - 0.5) * 2;
  state.ball.vy = direction * 1.5;
}

function checkWinner(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const state = room.state;
  const p1 = state.paddles.player1;
  const p2 = state.paddles.player2;

  if (p1.score >= state.maxScore) {
    state.status = 'finished';
    state.winner = 'player1';
    endGame(roomCode, room.players[0], room.players[1]);
  } else if (p2.score >= state.maxScore) {
    state.status = 'finished';
    state.winner = 'player2';
    endGame(roomCode, room.players[1], room.players[0]);
  }
}

function endGame(roomCode, winnerId, loserId) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.interval) clearInterval(room.interval);

  // Update leaderboard
  if (winnerId) {
    leaderboard[winnerId] = leaderboard[winnerId] || { wins: 0, losses: 0, name: room.playerNames[winnerId] || 'Player' };
    leaderboard[winnerId].wins++;
  }
  if (loserId) {
    leaderboard[loserId] = leaderboard[loserId] || { wins: 0, losses: 0, name: room.playerNames[loserId] || 'Player' };
    leaderboard[loserId].losses++;
  }

  io.to(roomCode).emit('gameOver', {
    winner: room.state.winner,
    scores: { p1: room.state.paddles.player1.score, p2: room.state.paddles.player2.score },
    leaderboard: getTopLeaderboard()
  });
}

function getTopLeaderboard() {
  return Object.entries(leaderboard)
    .map(([id, data]) => ({ name: data.name, wins: data.wins, losses: data.losses }))
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('createRoom', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [socket.id],
      playerNames: { [socket.id]: playerName || 'Player 1' },
      state: createGameState(),
      interval: null
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

    // Start countdown then game
    let count = 3;
    io.to(roomCode).emit('countdown', { count });
    const cd = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(roomCode).emit('countdown', { count });
      } else {
        clearInterval(cd);
        room.state.status = 'playing';
        io.to(roomCode).emit('gameStart');
        room.interval = setInterval(() => gameTick(roomCode), TICK_RATE);
      }
    }, 1000);
  });

  socket.on('paddleMove', ({ x }) => {
    const roomCode = playerRooms[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room || room.state.status !== 'playing') return;

    const role = room.players[0] === socket.id ? 'player1' : 'player2';
    const paddle = room.state.paddles[role];
    paddle.x = Math.max(paddle.width / 2, Math.min(100 - paddle.width / 2, x));
  });

  socket.on('rematch', () => {
    const roomCode = playerRooms[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room) return;

    room.rematchVotes = (room.rematchVotes || 0) + 1;
    io.to(roomCode).emit('rematchVote', { votes: room.rematchVotes });

    if (room.rematchVotes >= 2) {
      room.rematchVotes = 0;
      room.state = createGameState();
      room.state.status = 'playing';
      io.to(roomCode).emit('rematchStart');
      if (room.interval) clearInterval(room.interval);
      room.interval = setInterval(() => gameTick(roomCode), TICK_RATE);
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
