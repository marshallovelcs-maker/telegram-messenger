const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище данных
let users = new Map();
let chats = new Map();

// Создание тестового чата
const testChatId = Date.now().toString();
chats.set(testChatId, {
  id: testChatId,
  name: 'Общий чат',
  participants: [],
  messages: [],
  isPrivate: false,
  createdAt: new Date()
});

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Регистрация пользователя
  socket.on('register', (nick) => {
    const existingUser = Array.from(users.values()).find(u => u.nick === nick);
    
    if (existingUser) {
      socket.emit('registration_error', 'Ник уже занят');
      return;
    }
    
    users.set(socket.id, {
      id: socket.id,
      nick: nick,
      chats: [testChatId]
    });
    
    socket.join(testChatId);
    
    const testChat = chats.get(testChatId);
    if (testChat && !testChat.participants.includes(socket.id)) {
      testChat.participants.push(socket.id);
    }
    
    const userChats = Array.from(chats.entries())
      .filter(([chatId]) => users.get(socket.id).chats.includes(chatId))
      .map(([chatId, chat]) => ({
        id: chatId,
        name: chat.name,
        messages: chat.messages,
        isPrivate: chat.isPrivate,
        participants: chat.participants
      }));
    
    socket.emit('initial_data', {
      user: { nick: nick, id: socket.id },
      chats: userChats,
      onlineUsers: Array.from(users.values()).map(u => u.nick)
    });
    
    io.emit('user_online', { nick: nick, id: socket.id });
    console.log(`User registered: ${nick}`);
  });
  
  // Создание личного чата
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = users.get(targetUserId);
    
    if (!creator || !targetUser) return;
    
    const chatId = Date.now().toString();
    const newChat = {
      id: chatId,
      name: chatName,
      participants: [socket.id, targetUserId],
      messages: [],
      isPrivate: true,
      createdAt: new Date()
    };
    
    creator.chats.push(chatId);
    targetUser.chats.push(chatId);
    
    chats.set(chatId, newChat);
    
    socket.emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [socket.id, targetUserId]
    });
    
    io.to(targetUserId).emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [socket.id, targetUserId]
    });
    
    socket.join(chatId);
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) {
      targetSocket.join(chatId);
    }
    
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: true });
    console.log(`Private chat created: ${chatName} between ${creator.nick} and ${targetUser.nick}`);
  });
  
  // Создание группового чата
  socket.on('create_group_chat', (chatName, participantNicks) => {
    const creator = users.get(socket.id);
    if (!creator) return;
    
    const chatId = Date.now().toString();
    const participants = [socket.id];
    
    participantNicks.forEach(nick => {
      const user = Array.from(users.values()).find(u => u.nick === nick);
      if (user && !participants.includes(user.id)) {
        participants.push(user.id);
      }
    });
    
    const newChat = {
      id: chatId,
      name: chatName,
      participants: participants,
      messages: [],
      isPrivate: false,
      createdAt: new Date()
    };
    
    participants.forEach(participantId => {
      const user = users.get(participantId);
      if (user) {
        user.chats.push(chatId);
        const participantSocket = io.sockets.sockets.get(participantId);
        if (participantSocket) {
          participantSocket.join(chatId);
          participantSocket.emit('new_chat', {
            id: chatId,
            name: chatName,
            messages: [],
            isPrivate: false,
            participants: participants
          });
        }
      }
    });
    
    chats.set(chatId, newChat);
    socket.join(chatId);
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: false });
    console.log(`Group chat created: ${chatName} with ${participants.length} participants`);
  });
  
  // Смена ника
  socket.on('change_nick', (newNick) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    const existingUser = Array.from(users.values()).find(u => u.nick === newNick);
    if (existingUser && existingUser.id !== socket.id) {
      socket.emit('nick_error', 'Ник уже занят');
      return;
    }
    
    const oldNick = user.nick;
    user.nick = newNick;
    users.set(socket.id, user);
    
    io.emit('nick_changed', { oldNick: oldNick, newNick: newNick, id: socket.id });
    socket.emit('nick_changed_success', { newNick: newNick });
    console.log(`${oldNick} changed nick to ${newNick}`);
  });
  
  // Поиск по нику
  socket.on('search_users', (query) => {
    const searchResults = Array.from(users.values())
      .filter(user => user.nick.toLowerCase().includes(query.toLowerCase()) && user.id !== socket.id)
      .map(user => ({ nick: user.nick, id: user.id }));
    socket.emit('search_results', searchResults);
  });
  
  // Присоединение к чату
  socket.on('join_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && !user.chats.includes(chatId)) {
      user.chats.push(chatId);
      chat.participants.push(socket.id);
      socket.join(chatId);
      socket.emit('joined_chat', { 
        id: chatId, 
        name: chat.name, 
        messages: chat.messages,
        isPrivate: chat.isPrivate,
        participants: chat.participants
      });
      io.to(chatId).emit('user_joined', { nick: user.nick, chatId: chatId });
    }
  });
  
  // Удаление чата
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user) {
      chat.participants.forEach(participantId => {
        const participant = users.get(participantId);
        if (participant) {
          const index = participant.chats.indexOf(chatId);
          if (index !== -1) participant.chats.splice(index, 1);
          io.to(participantId).emit('chat_deleted', chatId);
        }
      });
      chats.delete(chatId);
      socket.emit('chat_deleted_success', chatId);
      console.log(`Chat deleted: ${chat.name}`);
    }
  });
  
  // Отправка сообщения
  socket.on('send_message', (data) => {
    const { chatId, message } = data;
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && message && message.trim()) {
      const messageObj = {
        id: Date.now().toString(),
        text: message.trim(),
        sender: user.nick,
        senderId: socket.id,
        timestamp: new Date().toISOString()
      };
      
      chat.messages.push(messageObj);
      io.to(chatId).emit('new_message', {
        chatId: chatId,
        message: messageObj
      });
      console.log(`Message in ${chat.name} from ${user.nick}: ${message}`);
    }
  });
  
  // Отключение пользователя
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      io.emit('user_offline', { nick: user.nick, id: socket.id });
      console.log(`User disconnected: ${user.nick}`);
    }
  });
});

// Обработка всех остальных маршрутов
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`Server is running!`);
  console.log(`Port: ${PORT}`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`=================================`);
});