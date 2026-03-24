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
let users = new Map(); // socketId -> { id, nick, chats, online, lastSeen }
let allUsers = new Map(); // id -> { id, nick, online, lastSeen, chats }
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

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('register', (nick) => {
    // Проверяем, существует ли пользователь с таким ником и онлайн
    let existingUser = null;
    for (let [id, user] of allUsers) {
      if (user.nick === nick && user.online === true) {
        existingUser = user;
        break;
      }
    }
    
    if (existingUser) {
      socket.emit('registration_error', 'Ник уже занят');
      return;
    }
    
    // Проверяем, был ли пользователь зарегистрирован ранее (оффлайн)
    let userData = null;
    for (let [id, user] of allUsers) {
      if (user.nick === nick) {
        userData = user;
        userData.online = true;
        userData.lastSeen = new Date();
        userData.socketId = socket.id;
        allUsers.set(id, userData);
        break;
      }
    }
    
    // Если новый пользователь
    if (!userData) {
      userData = {
        id: socket.id,
        nick: nick,
        chats: [testChatId],
        online: true,
        lastSeen: new Date()
      };
      allUsers.set(socket.id, userData);
    }
    
    users.set(socket.id, userData);
    
    // Добавляем в общий чат
    socket.join(testChatId);
    const testChat = chats.get(testChatId);
    if (testChat && !testChat.participants.includes(socket.id)) {
      testChat.participants.push(socket.id);
    }
    
    // Если у пользователя нет чатов в списке (восстановление)
    if (!userData.chats) {
      userData.chats = [testChatId];
    }
    
    const userChats = Array.from(chats.entries())
      .filter(([chatId]) => userData.chats.includes(chatId))
      .map(([chatId, chat]) => ({
        id: chatId,
        name: chat.name,
        messages: chat.messages,
        isPrivate: chat.isPrivate,
        participants: chat.participants
      }));
    
    // Отправляем начальные данные
    socket.emit('initial_data', {
      user: { nick: nick, id: userData.id },
      chats: userChats,
      allUsers: Array.from(allUsers.values()).map(u => ({ 
        nick: u.nick, 
        id: u.id, 
        online: u.online,
        lastSeen: u.lastSeen 
      }))
    });
    
    // Уведомляем всех о новом/вернувшемся пользователе
    io.emit('user_online', { nick: nick, id: userData.id });
    console.log(`User registered/online: ${nick} (${userData.id})`);
    console.log(`Total users: ${allUsers.size}, Online: ${Array.from(allUsers.values()).filter(u => u.online).length}`);
  });
  
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = allUsers.get(targetUserId);
    
    if (!creator || !targetUser) {
      console.log(`Cannot create private chat: creator or target not found`);
      return;
    }
    
    // Проверяем, не существует ли уже такой чат
    let existingChat = null;
    for (let [chatId, chat] of chats) {
      if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
        if (chat.participants.includes(creator.id) && chat.participants.includes(targetUser.id)) {
          existingChat = chat;
          break;
        }
      }
    }
    
    if (existingChat) {
      socket.emit('chat_exists', { id: existingChat.id, name: existingChat.name });
      return;
    }
    
    const chatId = Date.now().toString();
    const newChat = {
      id: chatId,
      name: chatName,
      participants: [creator.id, targetUser.id],
      messages: [],
      isPrivate: true,
      createdAt: new Date()
    };
    
    // Добавляем чат в списки пользователей
    creator.chats.push(chatId);
    targetUser.chats.push(chatId);
    
    chats.set(chatId, newChat);
    
    // Отправляем создателю
    socket.emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [creator.id, targetUser.id]
    });
    
    // Отправляем целевому пользователю (даже если оффлайн)
    const targetSocket = io.sockets.sockets.get(targetUser.id);
    if (targetSocket) {
      targetSocket.emit('new_chat', {
        id: chatId,
        name: chatName,
        messages: [],
        isPrivate: true,
        participants: [creator.id, targetUser.id]
      });
      targetSocket.join(chatId);
    }
    
    socket.join(chatId);
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: true });
    console.log(`Private chat created: ${chatName} between ${creator.nick} and ${targetUser.nick}`);
  });
  
  socket.on('create_group_chat', (chatName, participantNicks) => {
    const creator = users.get(socket.id);
    if (!creator) return;
    
    const chatId = Date.now().toString();
    const participants = [creator.id];
    
    participantNicks.forEach(nick => {
      const user = Array.from(allUsers.values()).find(u => u.nick === nick);
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
      const user = allUsers.get(participantId);
      if (user) {
        if (!user.chats) user.chats = [];
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
  
  socket.on('change_nick', (newNick) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    // Проверяем, не занят ли новый ник
    let nickTaken = false;
    for (let [id, u] of allUsers) {
      if (u.nick === newNick && id !== user.id) {
        nickTaken = true;
        break;
      }
    }
    
    if (nickTaken) {
      socket.emit('nick_error', 'Ник уже занят');
      return;
    }
    
    const oldNick = user.nick;
    user.nick = newNick;
    users.set(socket.id, user);
    allUsers.set(user.id, user);
    
    io.emit('nick_changed', { oldNick: oldNick, newNick: newNick, id: user.id });
    socket.emit('nick_changed_success', { newNick: newNick });
    console.log(`${oldNick} changed nick to ${newNick}`);
  });
  
  socket.on('search_users', (query) => {
    const searchResults = Array.from(allUsers.values())
      .filter(user => user.nick.toLowerCase().includes(query.toLowerCase()) && user.id !== socket.id)
      .map(user => ({ nick: user.nick, id: user.id }));
    socket.emit('search_results', searchResults);
  });
  
  socket.on('join_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && !user.chats.includes(chatId)) {
      user.chats.push(chatId);
      chat.participants.push(user.id);
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
  
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user) {
      chat.participants.forEach(participantId => {
        const participant = allUsers.get(participantId);
        if (participant && participant.chats) {
          const index = participant.chats.indexOf(chatId);
          if (index !== -1) participant.chats.splice(index, 1);
          const participantSocket = io.sockets.sockets.get(participantId);
          if (participantSocket) {
            participantSocket.emit('chat_deleted', chatId);
          }
        }
      });
      chats.delete(chatId);
      socket.emit('chat_deleted_success', chatId);
      console.log(`Chat deleted: ${chat.name}`);
    }
  });
  
  socket.on('send_message', (data) => {
    const { chatId, message } = data;
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && message && message.trim()) {
      const messageObj = {
        id: Date.now().toString(),
        text: message.trim(),
        sender: user.nick,
        senderId: user.id,
        timestamp: new Date().toISOString()
      };
      
      chat.messages.push(messageObj);
      
      // Отправляем сообщение всем участникам чата
      chat.participants.forEach(participantId => {
        const participantSocket = io.sockets.sockets.get(participantId);
        if (participantSocket) {
          participantSocket.emit('new_message', {
            chatId: chatId,
            message: messageObj
          });
        }
      });
      
      console.log(`Message in ${chat.name} from ${user.nick}: ${message.substring(0, 50)}`);
    }
  });
  
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      user.online = false;
      user.lastSeen = new Date();
      allUsers.set(user.id, user);
      users.delete(socket.id);
      
      io.emit('user_offline', { nick: user.nick, id: user.id });
      console.log(`User disconnected: ${user.nick}`);
      console.log(`Total users: ${allUsers.size}, Online: ${Array.from(allUsers.values()).filter(u => u.online).length}`);
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`Fembo Messenger Server Started 🦊`);
  console.log(`=================================`);
  console.log(`Port: ${PORT}`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`=================================`);
});