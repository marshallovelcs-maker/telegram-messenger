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
let users = new Map(); // socketId -> user object
let allUsers = new Map(); // userId -> user object (сохраняем всех пользователей)
let chats = new Map(); // chatId -> chat object

// ID общего чата (фиксированный)
const GENERAL_CHAT_ID = 'general_chat';

// Создание общего чата, если его нет
if (!chats.has(GENERAL_CHAT_ID)) {
  chats.set(GENERAL_CHAT_ID, {
    id: GENERAL_CHAT_ID,
    name: 'Общий чат',
    participants: [],
    messages: [],
    isPrivate: false,
    createdAt: new Date()
  });
  console.log('General chat created');
}

// Middleware для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  socket.on('register', (nick) => {
    console.log(`Registering user: ${nick}`);
    
    // Проверяем, есть ли уже пользователь с таким ником онлайн
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
    
    // Ищем пользователя в базе всех пользователей
    let userData = null;
    for (let [id, user] of allUsers) {
      if (user.nick === nick) {
        userData = user;
        break;
      }
    }
    
    // Если пользователь новый
    if (!userData) {
      userData = {
        id: socket.id,
        nick: nick,
        chats: [GENERAL_CHAT_ID], // Добавляем общий чат
        online: true,
        lastSeen: new Date()
      };
      allUsers.set(socket.id, userData);
    } else {
      // Пользователь уже был, обновляем данные
      userData.online = true;
      userData.lastSeen = new Date();
      userData.socketId = socket.id;
      // Убеждаемся, что общий чат есть в списке
      if (!userData.chats.includes(GENERAL_CHAT_ID)) {
        userData.chats.push(GENERAL_CHAT_ID);
      }
      allUsers.set(userData.id, userData);
    }
    
    // Сохраняем в активные пользователи
    users.set(socket.id, userData);
    
    // Добавляем пользователя в общий чат
    const generalChat = chats.get(GENERAL_CHAT_ID);
    if (generalChat && !generalChat.participants.includes(userData.id)) {
      generalChat.participants.push(userData.id);
    }
    socket.join(GENERAL_CHAT_ID);
    
    // Формируем список чатов пользователя
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
    
    // Формируем список всех пользователей
    const allUsersList = [];
    for (let [id, user] of allUsers) {
      allUsersList.push({
        id: user.id,
        nick: user.nick,
        online: user.online,
        lastSeen: user.lastSeen
      });
    }
    
    // Отправляем начальные данные
    socket.emit('initial_data', {
      user: { nick: nick, id: userData.id },
      chats: userChats,
      allUsers: allUsersList
    });
    
    // Уведомляем всех о новом/вернувшемся пользователе
    io.emit('user_online', { nick: nick, id: userData.id });
    
    console.log(`✅ User registered: ${nick} (${userData.id})`);
    console.log(`📊 Total users: ${allUsers.size}, Online: ${users.size}`);
    console.log(`💬 Chats: ${chats.size}, General chat participants: ${generalChat.participants.length}`);
  });
  
  socket.on('create_private_chat', (chatName, targetUserId) => {
    const creator = users.get(socket.id);
    const targetUser = allUsers.get(targetUserId);
    
    if (!creator || !targetUser) {
      console.log(`❌ Cannot create private chat: creator or target not found`);
      return;
    }
    
    // Проверяем, существует ли уже личный чат
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
    
    // Отправляем целевому пользователю
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
    
    console.log(`💬 Private chat created: ${chatName} between ${creator.nick} and ${targetUser.nick}`);
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
            participants: participants
          });
        }
      }
    });
    
    chats.set(chatId, newChat);
    socket.join(chatId);
    socket.emit('chat_created', { id: chatId, name: chatName, isPrivate: false });
    
    console.log(`👥 Group chat created: ${chatName} with ${participants.length} participants`);
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
    
    console.log(`✏️ ${oldNick} changed nick to ${newNick}`);
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
        participants: chat.participants
      });
      io.to(chatId).emit('user_joined', { nick: user.nick, chatId: chatId });
      
      console.log(`➕ ${user.nick} joined chat: ${chat.name}`);
    }
  });
  
  socket.on('delete_chat', (chatId) => {
    const user = users.get(socket.id);
    const chat = chats.get(chatId);
    
    if (chat && user && chatId !== GENERAL_CHAT_ID) { // Нельзя удалить общий чат
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
      console.log(`🗑️ Chat deleted: ${chat.name}`);
    } else if (chatId === GENERAL_CHAT_ID) {
      socket.emit('error', 'Нельзя удалить общий чат');
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
      
      console.log(`💬 Message in ${chat.name} from ${user.nick}: ${message.substring(0, 50)}`);
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
      console.log(`❌ User disconnected: ${user.nick}`);
      console.log(`📊 Total users: ${allUsers.size}, Online: ${users.size}`);
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`🦊 Fembo Messenger Server Started`);
  console.log(`=================================`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`💬 General chat ID: ${GENERAL_CHAT_ID}`);
  console.log(`=================================`);
});