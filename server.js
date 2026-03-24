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
let users = new Map(); // socketId -> { id, nick, chats }
let chats = new Map(); // chatId -> { id, name, participants, messages, isPrivate, createdAt }

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

// API endpoints (для возможного расширения)
app.get('/api/chats', (req, res) => {
  const chatsList = Array.from(chats.values()).map(chat => ({
    id: chat.id,
    name: chat.name,
    participants: chat.participants.length,
    messages: chat.messages.length,
    isPrivate: chat.isPrivate
  }));
  res.json(chatsList);
});

app.get('/api/users', (req, res) => {
  const usersList = Array.from(users.values()).map(user => ({
    nick: user.nick,
    id: user.id,
    online: true
  }));
  res.json(usersList);
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Регистрация пользователя
  socket.on('register', (nick) => {
    // Проверяем, существует ли пользователь с таким ником
    const existingUser = Array.from(users.values()).find(u => u.nick === nick);
    
    if (existingUser) {
      socket.emit('registration_error', 'Ник уже занят');
      return;
    }
    
    // Сохраняем пользователя
    users.set(socket.id, {
      id: socket.id,
      nick: nick,
      chats: [testChatId]
    });
    
    // Добавляем пользователя в тестовый чат
    socket.join(testChatId);
    const testChat = chats.get(testChatId);
    if (testChat && !testChat.participants.includes(socket.id)) {
      testChat.participants.push(socket.id);
    }
    
    // Получаем чаты пользователя
    const userChats = Array.from(chats.entries())
      .filter(([chatId]) => users.get(socket.id).chats.includes(chatId))
      .map(([chatId, chat]) => ({
        id: chatId,
        name: chat.name,
        messages: chat.messages,
        isPrivate: chat.isPrivate,
        participants: chat.participants
      }));
    
    // Отправляем начальные данные
    socket.emit('initial_data', {
      user: { nick: nick, id: socket.id },
      chats: userChats,
      onlineUsers: Array.from(users.values()).map(u => ({ nick: u.nick, id: u.id }))
    });
    
    // Уведомляем всех о новом пользователе
    io.emit('user_online', { nick: nick, id: socket.id });
    
    console.log(`User registered: ${nick} (${socket.id})`);
    console.log(`Total users online: ${users.size}`);
  });
  
  // Создание личного чата
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = users.get(targetUserId);
    
    if (!creator || !targetUser) {
      console.log(`Failed to create private chat: creator or target not found`);
      return;
    }
    
    // Проверяем, не существует ли уже такой чат
    let existingChat = null;
    for (let [chatId, chat] of chats) {
      if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
        if (chat.participants.includes(socket.id) && chat.participants.includes(targetUserId)) {
          existingChat = chat;
          break;
        }
      }
    }
    
    if (existingChat) {
      console.log(`Private chat already exists between ${creator.nick} and ${targetUser.nick}`);
      socket.emit('chat_exists', { id: existingChat.id, name: existingChat.name });
      return;
    }
    
    const chatId = Date.now().toString();
    const newChat = {
      id: chatId,
      name: chatName,
      participants: [socket.id, targetUserId],
      messages: [],
      isPrivate: true,
      createdAt: new Date()
    };
    
    // Добавляем чат обоим пользователям
    creator.chats.push(chatId);
    targetUser.chats.push(chatId);
    
    chats.set(chatId, newChat);
    
    // Отправляем новому чату создателю
    socket.emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [socket.id, targetUserId]
    });
    
    // Отправляем новому чату второму пользователю
    io.to(targetUserId).emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [socket.id, targetUserId]
    });
    
    // Присоединяем обоих к комнате чата
    socket.join(chatId);
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) {
      targetSocket.join(chatId);
    }
    
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: true });
    
    console.log(`Private chat created: ${chatName} (${chatId}) between ${creator.nick} and ${targetUser.nick}`);
  });
  
  // Создание группового чата
  socket.on('create_group_chat', (chatName, participantNicks) => {
    const creator = users.get(socket.id);
    if (!creator) return;
    
    const chatId = Date.now().toString();
    const participants = [socket.id];
    
    // Находим ID участников по никам
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
    
    // Добавляем чат всем участникам
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
    
    console.log(`Group chat created: ${chatName} (${chatId}) with ${participants.length} participants`);
  });
  
  // Смена ника
  socket.on('change_nick', (newNick) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    // Проверяем, не занят ли новый ник
    const existingUser = Array.from(users.values()).find(u => u.nick === newNick);
    if (existingUser && existingUser.id !== socket.id) {
      socket.emit('nick_error', 'Ник уже занят');
      return;
    }
    
    const oldNick = user.nick;
    user.nick = newNick;
    users.set(socket.id, user);
    
    // Уведомляем всех о смене ника
    io.emit('nick_changed', { oldNick: oldNick, newNick: newNick, id: socket.id });
    socket.emit('nick_changed_success', { newNick: newNick });
    
    console.log(`${oldNick} changed nick to ${newNick}`);
  });
  
  // Поиск по нику
  socket.on('search_users', (query) => {
    const searchResults = Array.from(users.values())
      .filter(user => 
        user.nick.toLowerCase().includes(query.toLowerCase()) && 
        user.id !== socket.id
      )
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
      
      console.log(`${user.nick} joined chat: ${chat.name}`);
    }
  });
  
  // Удаление чата
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user) {
      // Удаляем чат у всех участников
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
      console.log(`Chat deleted: ${chat.name} (${chatId})`);
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
      
      // Отправляем сообщение всем в чате
      io.to(chatId).emit('new_message', {
        chatId: chatId,
        message: messageObj
      });
      
      console.log(`Message in ${chat.name} from ${user.nick}: ${message.substring(0, 50)}`);
    }
  });
  
  // Отключение пользователя
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      io.emit('user_offline', { nick: user.nick, id: socket.id });
      console.log(`User disconnected: ${user.nick} (${socket.id})`);
      console.log(`Total users online: ${users.size}`);
    }
  });
});

// Обработка всех остальных маршрутов - отдаем index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`Dark Messenger Server Started`);
  console.log(`=================================`);
  console.log(`Port: ${PORT}`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`=================================`);
  console.log(`Ready for connections`);
  console.log(`=================================`);
});