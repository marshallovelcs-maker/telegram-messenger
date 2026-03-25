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
let userUnreadCounts = new Map();

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

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Функция для добавления непрочитанного сообщения
function addUnreadMessage(userId, chatId) {
  if (!userUnreadCounts.has(userId)) {
    userUnreadCounts.set(userId, new Map());
  }
  const userUnreads = userUnreadCounts.get(userId);
  const currentCount = userUnreads.get(chatId) || 0;
  userUnreads.set(chatId, currentCount + 1);
}

// Функция для получения непрочитанных сообщений
function getUnreadMessages(userId) {
  if (!userUnreadCounts.has(userId)) {
    return new Map();
  }
  return userUnreadCounts.get(userId);
}

// Функция для очистки непрочитанных
function clearUnreadMessages(userId, chatId) {
  if (userUnreadCounts.has(userId)) {
    const userUnreads = userUnreadCounts.get(userId);
    userUnreads.set(chatId, 0);
  }
}

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  
  socket.on('register', (nick) => {
    console.log(`📝 Registering user: ${nick}`);
    
    let existingOnline = false;
    for (let [id, user] of users) {
      if (user.nick === nick) {
        existingOnline = true;
        break;
      }
    }
    
    if (existingOnline) {
      socket.emit('registration_error', 'Ник уже занят');
      return;
    }
    
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
    
    const generalChat = chats.get(GENERAL_CHAT_ID);
    if (generalChat && !generalChat.participants.includes(userData.id)) {
      generalChat.participants.push(userData.id);
    }
    socket.join(GENERAL_CHAT_ID);
    
    const userChats = [];
    const userUnreads = getUnreadMessages(userData.id);
    
    for (let chatId of userData.chats) {
      const chat = chats.get(chatId);
      if (chat) {
        userChats.push({
          id: chat.id,
          name: chat.name,
          messages: chat.messages,
          isPrivate: chat.isPrivate,
          participants: chat.participants,
          unreadCount: userUnreads.get(chatId) || 0
        });
      }
    }
    
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
    
    console.log(`✅ User online: ${nick} (${userData.id})`);
    console.log(`📊 Total users: ${allUsers.size}, Online: ${users.size}`);
  });
  
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = allUsers.get(targetUserId);
    
    if (!creator || !targetUser) return;
    
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
    
    creator.chats.push(chatId);
    targetUser.chats.push(chatId);
    
    chats.set(chatId, newChat);
    
    socket.emit('new_chat', {
      id: chatId,
      name: chatName,
      messages: [],
      isPrivate: true,
      participants: [creator.id, targetUser.id],
      unreadCount: 0
    });
    
    const targetSocket = io.sockets.sockets.get(targetUser.id);
    if (targetSocket) {
      targetSocket.emit('new_chat', {
        id: chatId,
        name: chatName,
        messages: [],
        isPrivate: true,
        participants: [creator.id, targetUser.id],
        unreadCount: 0
      });
      targetSocket.join(chatId);
    }
    
    socket.join(chatId);
    socket.emit('open_chat', { id: chatId, name: chatName, isPrivate: true });
    
    console.log(`💬 Private chat: ${chatName} between ${creator.nick} and ${targetUser.nick}`);
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
    
    participants.forEach(participantId => {
      const user = allUsers.get(participantId);
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
            participants: participants,
            unreadCount: 0
          });
        }
      }
    });
    
    chats.set(chatId, newChat);
    socket.join(chatId);
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: false });
    
    console.log(`👥 Group chat: ${chatName} with ${participants.length} participants`);
  });
  
  socket.on('change_nick', (newNick) => {
    const user = users.get(socket.id);
    if (!user) return;
    
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
    
    console.log(`✏️ ${oldNick} -> ${newNick}`);
  });
  
  socket.on('search_users', (query) => {
    const searchResults = [];
    for (let [id, user] of allUsers) {
      if (user.nick.toLowerCase().includes(query.toLowerCase()) && user.id !== socket.id) {
        searchResults.push({ nick: user.nick, id: user.id });
      }
    }
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
        participants: chat.participants,
        unreadCount: 0
      });
      io.to(chatId).emit('user_joined', { nick: user.nick, chatId: chatId });
    }
  });
  
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user && chatId !== GENERAL_CHAT_ID) {
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
      if (userUnreadCounts.has(user.id)) {
        userUnreadCounts.get(user.id).delete(chatId);
      }
      socket.emit('chat_deleted_success', chatId);
      console.log(`🗑️ Chat deleted: ${chat.name}`);
    }
  });
  
  socket.on('send_message', (data) => {
    const { chatId, message } = data;
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (user && chat && message && message.trim()) {
      const messageObj = {
        id: Date.now().toString(),
        type: 'text',
        text: message.trim(),
        sender: user.nick,
        senderId: user.id,
        timestamp: new Date().toISOString()
      };
      
      chat.messages.push(messageObj);
      
      chat.participants.forEach(participantId => {
        const participantSocket = io.sockets.sockets.get(participantId);
        
        if (participantSocket) {
          participantSocket.emit('new_message', {
            chatId: chatId,
            message: messageObj
          });
        } else {
          addUnreadMessage(participantId, chatId);
        }
      });
      
      console.log(`💬 ${chat.name}: ${user.nick}: ${message.substring(0, 50)}`);
    }
  });
  
  socket.on('mark_read', (chatId) => {
    const user = users.get(socket.id);
    if (user) {
      clearUnreadMessages(user.id, chatId);
      console.log(`✅ Marked chat ${chatId} as read for ${user.nick}`);
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
      console.log(`❌ User offline: ${user.nick}`);
      console.log(`📊 Online: ${users.size}`);
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`🦊 FEMBO SERVER`);
  console.log(`=================================`);
  console.log(`📡 PORT: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`=================================`);
});