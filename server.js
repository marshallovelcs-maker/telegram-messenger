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
let users = new Map(); // socketId -> { nick, chats }
let chats = new Map(); // chatId -> { name, participants, messages }

// Создание тестового чата
const testChatId = Date.now().toString();
chats.set(testChatId, {
  id: testChatId,
  name: 'Общий чат',
  participants: [],
  messages: [],
  createdAt: new Date()
});

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// API endpoints
app.get('/api/chats', (req, res) => {
  const chatsList = Array.from(chats.values()).map(chat => ({
    id: chat.id,
    name: chat.name,
    participants: chat.participants.length,
    messages: chat.messages.length
  }));
  res.json(chatsList);
});

app.post('/api/chats', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Chat name required' });
  }
  
  const chatId = Date.now().toString();
  const newChat = {
    id: chatId,
    name: name,
    participants: [],
    messages: [],
    createdAt: new Date()
  };
  
  chats.set(chatId, newChat);
  res.json({ id: chatId, name: name });
});

app.delete('/api/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  if (chats.has(chatId)) {
    chats.delete(chatId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Chat not found' });
  }
});

app.get('/api/users', (req, res) => {
  const usersList = Array.from(users.values()).map(user => ({
    nick: user.nick,
    online: true
  }));
  res.json(usersList);
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
    
    // Отправляем историю чатов
    const userChats = Array.from(chats.entries())
      .filter(([chatId]) => users.get(socket.id).chats.includes(chatId))
      .map(([chatId, chat]) => ({
        id: chatId,
        name: chat.name,
        messages: chat.messages
      }));
    
    socket.emit('initial_data', {
      user: { nick: nick, id: socket.id },
      chats: userChats,
      onlineUsers: Array.from(users.values()).map(u => u.nick)
    });
    
    // Уведомляем всех о новом пользователе
    io.emit('user_online', { nick: nick, id: socket.id });
    
    console.log(`User registered: ${nick}`);
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
      .filter(user => user.nick.toLowerCase().includes(query.toLowerCase()))
      .map(user => ({ nick: user.nick, id: user.id }));
    
    socket.emit('search_results', searchResults);
  });
  
  // Создание нового чата
  socket.on('create_chat', (chatName, participants) => {
    const chatId = Date.now().toString();
    const newChat = {
      id: chatId,
      name: chatName,
      participants: [],
      messages: [],
      createdAt: new Date()
    };
    
    // Добавляем создателя
    const creator = users.get(socket.id);
    if (creator) {
      newChat.participants.push(creator.id);
      creator.chats.push(chatId);
    }
    
    // Добавляем выбранных участников
    if (participants && participants.length) {
      participants.forEach(participantId => {
        const participant = users.get(participantId);
        if (participant && !newChat.participants.includes(participantId)) {
          newChat.participants.push(participantId);
          participant.chats.push(chatId);
        }
      });
    }
    
    chats.set(chatId, newChat);
    
    // Уведомляем всех участников о новом чате
    newChat.participants.forEach(participantId => {
      io.to(participantId).emit('new_chat', {
        id: chatId,
        name: chatName,
        messages: []
      });
    });
    
    socket.emit('chat_created', { id: chatId, name: chatName });
    console.log(`Chat created: ${chatName}`);
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
        messages: chat.messages 
      });
      
      io.to(chatId).emit('user_joined', { nick: user.nick, chatId: chatId });
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
      
      // Отправляем сообщение всем в чате
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

// Обработка всех остальных маршрутов - отдаем index.html
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