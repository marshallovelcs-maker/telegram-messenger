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
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище данных
let users = new Map();
let allUsers = new Map();
let chats = new Map();

// ID общего чата
const GENERAL_CHAT_ID = 'general_chat';

// Создание общего чата
if (!chats.has(GENERAL_CHAT_ID)) {
  chats.set(GENERAL_CHAT_ID, {
    id: GENERAL_CHAT_ID,
    name: 'Общий чат',
    participants: [],
    messages: [],
    isPrivate: false,
    createdAt: new Date()
  });
  console.log('✅ General chat created');
}

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  
  socket.on('register', (nick) => {
    console.log(`📝 Registering: ${nick}`);
    
    // Проверяем онлайн
    let online = false;
    for (let [id, user] of users) {
      if (user.nick === nick) {
        online = true;
        break;
      }
    }
    
    if (online) {
      socket.emit('registration_error', 'Ник уже занят');
      return;
    }
    
    // Ищем существующего пользователя
    let userData = null;
    for (let [id, user] of allUsers) {
      if (user.nick === nick) {
        userData = user;
        break;
      }
    }
    
    if (!userData) {
      userData = {
        id: socket.id,
        nick: nick,
        chats: [GENERAL_CHAT_ID],
        online: true,
        lastSeen: new Date()
      };
      allUsers.set(socket.id, userData);
    } else {
      userData.online = true;
      userData.lastSeen = new Date();
      userData.socketId = socket.id;
      if (!userData.chats.includes(GENERAL_CHAT_ID)) {
        userData.chats.push(GENERAL_CHAT_ID);
      }
      allUsers.set(userData.id, userData);
    }
    
    users.set(socket.id, userData);
    
    // Добавляем в общий чат
    const generalChat = chats.get(GENERAL_CHAT_ID);
    if (generalChat && !generalChat.participants.includes(userData.id)) {
      generalChat.participants.push(userData.id);
    }
    socket.join(GENERAL_CHAT_ID);
    
    // Формируем список чатов
    const userChats = [];
    for (let chatId of userData.chats) {
      const chat = chats.get(chatId);
      if (chat) {
        userChats.push({
          id: chat.id,
          name: chat.name,
          messages: chat.messages,
          isPrivate: chat.isPrivate,
          participants: chat.participants
        });
      }
    }
    
    // Формируем список пользователей
    const allUsersList = [];
    for (let [id, user] of allUsers) {
      allUsersList.push({
        id: user.id,
        nick: user.nick,
        online: user.online,
        lastSeen: user.lastSeen
      });
    }
    
    socket.emit('initial_data', {
      user: { nick: nick, id: userData.id },
      chats: userChats,
      allUsers: allUsersList
    });
    
    io.emit('user_online', { nick: nick, id: userData.id });
    console.log(`✅ ${nick} online, total: ${users.size}`);
  });
  
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = allUsers.get(targetUserId);
    
    if (!creator || !targetUser) return;
    
    // Проверяем существующий чат
    let existing = null;
    for (let [id, chat] of chats) {
      if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
        if (chat.participants.includes(creator.id) && chat.participants.includes(targetUser.id)) {
          existing = chat;
          break;
        }
      }
    }
    
    if (existing) {
      socket.emit('chat_exists', { id: existing.id });
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
    
    creator.chats.push(chatId);
    targetUser.chats.push(chatId);
    chats.set(chatId, newChat);
    
    socket.emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [creator.id, targetUser.id]
    });
    
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
    socket.emit('open_chat', { id: chatId });
    console.log(`💬 Private chat: ${creator.nick} with ${targetUser.nick}`);
  });
  
  socket.on('create_group_chat', (chatName, participantNicks) => {
    const creator = users.get(socket.id);
    if (!creator) return;
    
    const chatId = Date.now().toString();
    const participants = [creator.id];
    
    participantNicks.forEach(nick => {
      for (let [id, user] of allUsers) {
        if (user.nick === nick && !participants.includes(id)) {
          participants.push(id);
          break;
        }
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
    
    participants.forEach(pid => {
      const user = allUsers.get(pid);
      if (user) {
        user.chats.push(chatId);
        const psocket = io.sockets.sockets.get(pid);
        if (psocket) {
          psocket.join(chatId);
          psocket.emit('new_chat', {
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
    socket.emit('chat_created', { id: chatId });
    console.log(`👥 Group chat: ${chatName}`);
  });
  
  socket.on('change_nick', (newNick) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    let taken = false;
    for (let [id, u] of allUsers) {
      if (u.nick === newNick && id !== user.id) {
        taken = true;
        break;
      }
    }
    
    if (taken) {
      socket.emit('nick_error', 'Ник занят');
      return;
    }
    
    const oldNick = user.nick;
    user.nick = newNick;
    users.set(socket.id, user);
    allUsers.set(user.id, user);
    
    io.emit('nick_changed', { oldNick: oldNick, newNick: newNick, id: user.id });
    socket.emit('nick_changed_success', { newNick: newNick });
  });
  
  socket.on('search_users', (query) => {
    const results = [];
    for (let [id, user] of allUsers) {
      if (user.nick.toLowerCase().includes(query.toLowerCase()) && user.id !== socket.id) {
        results.push({ nick: user.nick, id: user.id });
      }
    }
    socket.emit('search_results', results);
  });
  
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user && chatId !== GENERAL_CHAT_ID) {
      chat.participants.forEach(pid => {
        const p = allUsers.get(pid);
        if (p && p.chats) {
          const idx = p.chats.indexOf(chatId);
          if (idx !== -1) p.chats.splice(idx, 1);
          const psocket = io.sockets.sockets.get(pid);
          if (psocket) psocket.emit('chat_deleted', chatId);
        }
      });
      chats.delete(chatId);
      socket.emit('chat_deleted_success', chatId);
    }
  });
  
  socket.on('send_message', (data) => {
    const { chatId, message } = data;
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && message && message.trim()) {
      const msgObj = {
        id: Date.now().toString(),
        type: 'text',
        text: message.trim(),
        sender: user.nick,
        senderId: user.id,
        timestamp: new Date().toISOString()
      };
      
      chat.messages.push(msgObj);
      
      chat.participants.forEach(pid => {
        const psocket = io.sockets.sockets.get(pid);
        if (psocket) {
          psocket.emit('new_message', { chatId: chatId, message: msgObj });
        }
      });
    }
  });
  
  socket.on('send_image', (data) => {
    const { chatId, image } = data;
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && image) {
      const imgObj = {
        id: Date.now().toString(),
        type: 'image',
        image: image,
        sender: user.nick,
        senderId: user.id,
        timestamp: new Date().toISOString()
      };
      
      chat.messages.push(imgObj);
      
      chat.participants.forEach(pid => {
        const psocket = io.sockets.sockets.get(pid);
        if (psocket) {
          psocket.emit('new_image', {
            chatId: chatId,
            image: image,
            sender: user.nick,
            senderId: user.id,
            timestamp: imgObj.timestamp
          });
        }
      });
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
      console.log(`❌ ${user.nick} offline`);
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`🦊 Fembo Server Started`);
  console.log(`=================================`);
  console.log(`Port: ${PORT}`);
  console.log(`=================================`);
});