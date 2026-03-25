const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});

// State
let currentUser = null;
let currentChat = null;
let chats = new Map();
let allUsers = new Map();
let unreadMessages = new Map();
let newChats = new Set();

// DOM elements
const currentNickSpan = document.getElementById('currentNick');
const editNickBtn = document.getElementById('editNickBtn');
const newChatBtn = document.getElementById('newChatBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const onlineUsersList = document.getElementById('onlineUsersList');
const offlineUsersList = document.getElementById('offlineUsersList');
const chatsList = document.getElementById('chatsList');
const chatHeader = document.getElementById('chatHeader');
const messagesContainer = document.getElementById('messagesContainer');
const messageInputContainer = document.querySelector('.message-input-container');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const deleteChatBtn = document.getElementById('deleteChatBtn');

// Modals
const nickModal = document.getElementById('nickModal');
const newNickInput = document.getElementById('newNickInput');
const confirmNickBtn = document.getElementById('confirmNickBtn');
const cancelNickBtn = document.getElementById('cancelNickBtn');
const newChatModal = document.getElementById('newChatModal');
const chatNameInput = document.getElementById('chatNameInput');
const participantsList = document.getElementById('participantsList');
const createChatBtn = document.getElementById('createChatBtn');
const cancelChatBtn = document.getElementById('cancelChatBtn');

// localStorage functions
function saveUserNick(nick) {
    localStorage.setItem('fembo_user_nick', nick);
}

function getSavedNick() {
    return localStorage.getItem('fembo_user_nick');
}

// Registration
let userNick = getSavedNick();
if (!userNick) {
    userNick = prompt('Введите ваш ник:', 'User' + Math.floor(Math.random() * 1000));
    if (userNick) {
        saveUserNick(userNick);
    }
} else {
    const useSaved = confirm(`Использовать сохраненный ник "${userNick}"?`);
    if (!useSaved) {
        userNick = prompt('Введите новый ник:', userNick);
        if (userNick) {
            saveUserNick(userNick);
        }
    }
}

if (userNick) {
    socket.emit('register', userNick);
}

// Socket event handlers
socket.on('initial_data', (data) => {
    console.log('Initial data:', data);
    
    currentUser = data.user;
    currentNickSpan.textContent = data.user.nick;
    
    chats.clear();
    allUsers.clear();
    unreadMessages.clear();
    newChats.clear();
    
    // Load chats with unread counts
    if (data.chats && data.chats.length > 0) {
        data.chats.forEach(chat => {
            chats.set(chat.id, chat);
            const unreadCount = chat.unreadCount || 0;
            unreadMessages.set(chat.id, unreadCount);
        });
        console.log(`Loaded ${chats.size} chats`);
    }
    
    // Load users
    if (data.allUsers && data.allUsers.length > 0) {
        data.allUsers.forEach(user => {
            allUsers.set(user.id, user);
        });
        console.log(`Loaded ${allUsers.size} users`);
    }
    
    updateUsersLists();
    renderChatsList();
    
    // Показываем уведомление о непрочитанных сообщениях
    let totalUnread = 0;
    for (let count of unreadMessages.values()) {
        totalUnread += count;
    }
    if (totalUnread > 0) {
        console.log(`📨 You have ${totalUnread} unread messages`);
        if (Notification.permission === 'granted') {
            new Notification(`Fembo`, {
                body: `У вас ${totalUnread} непрочитанных сообщений`,
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="45" fill="%234a9eff"/%3E%3C/svg%3E'
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
    
    // Автоматически открываем общий чат
    const generalChat = Array.from(chats.values()).find(chat => chat.id === 'general_chat');
    if (generalChat) {
        openChat(generalChat.id);
    }
});

socket.on('registration_error', (error) => {
    alert(error);
    localStorage.removeItem('fembo_user_nick');
    const newNick = prompt('Введите другой ник:');
    if (newNick) {
        saveUserNick(newNick);
        socket.emit('register', newNick);
    }
});

socket.on('user_online', (user) => {
    const existingUser = allUsers.get(user.id);
    if (existingUser) {
        existingUser.online = true;
        existingUser.lastSeen = new Date();
        allUsers.set(user.id, existingUser);
    } else {
        allUsers.set(user.id, { ...user, online: true, lastSeen: new Date(), chats: [] });
    }
    updateUsersLists();
    renderChatsList();
    if (currentChat) {
        updateChatHeaderTitle(currentChat);
    }
});

socket.on('user_offline', (user) => {
    const existingUser = allUsers.get(user.id);
    if (existingUser) {
        existingUser.online = false;
        existingUser.lastSeen = new Date();
        allUsers.set(user.id, existingUser);
    }
    updateUsersLists();
    renderChatsList();
    if (currentChat) {
        updateChatHeaderTitle(currentChat);
    }
});

socket.on('nick_changed', (data) => {
    if (currentUser && data.id === currentUser.id) {
        currentUser.nick = data.newNick;
        currentNickSpan.textContent = data.newNick;
        saveUserNick(data.newNick);
    }
    
    const userData = allUsers.get(data.id);
    if (userData) {
        userData.nick = data.newNick;
        allUsers.set(data.id, userData);
    }
    
    updateUsersLists();
    
    chats.forEach(chat => {
        chat.messages.forEach(msg => {
            if (msg.sender === data.oldNick) {
                msg.sender = data.newNick;
            }
        });
        
        if (chat.isPrivate && chat.name.includes(data.oldNick)) {
            chat.name = chat.name.replace(data.oldNick, data.newNick);
        }
    });
    
    renderChatsList();
    
    if (currentChat) {
        renderMessages(currentChat);
        updateChatHeaderTitle(currentChat);
    }
});

socket.on('nick_changed_success', (data) => {
    currentUser.nick = data.newNick;
    currentNickSpan.textContent = data.newNick;
    saveUserNick(data.newNick);
});

socket.on('nick_error', (error) => {
    alert(error);
});

socket.on('search_results', (results) => {
    searchResults.innerHTML = '';
    if (results.length > 0) {
        results.forEach(user => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = user.nick;
            div.onclick = () => {
                createPrivateChat(user);
                searchResults.classList.remove('active');
                searchInput.value = '';
            };
            searchResults.appendChild(div);
        });
        searchResults.classList.add('active');
    } else {
        searchResults.classList.remove('active');
    }
});

socket.on('new_chat', (chat) => {
    chats.set(chat.id, chat);
    unreadMessages.set(chat.id, chat.unreadCount || 0);
    newChats.add(chat.id);
    renderChatsList();
    playNotificationSound();
});

socket.on('chat_created', (chat) => {
    newChatModal.classList.remove('active');
});

socket.on('chat_exists', (chat) => {
    openChat(chat.id);
});

socket.on('open_chat', (chat) => {
    const existingChat = chats.get(chat.id);
    if (existingChat) {
        openChat(chat.id);
    }
});

socket.on('joined_chat', (chat) => {
    chats.set(chat.id, chat);
    renderChatsList();
    openChat(chat.id);
});

socket.on('user_joined', (data) => {
    if (currentChat && currentChat.id === data.chatId) {
        addSystemMessage(`Пользователь ${data.nick} присоединился к чату`);
    }
});

socket.on('chat_deleted', (chatId) => {
    chats.delete(chatId);
    unreadMessages.delete(chatId);
    newChats.delete(chatId);
    
    if (currentChat && currentChat.id === chatId) {
        currentChat = null;
        const chatHeaderH3 = chatHeader.querySelector('h3');
        if (chatHeaderH3) chatHeaderH3.textContent = 'SELECT CHAT';
        deleteChatBtn.style.display = 'none';
        messageInputContainer.style.display = 'none';
        messagesContainer.innerHTML = '<div class="empty-chat-message"><p>➤ ВЫБЕРИТЕ ЧАТ</p></div>';
    }
    renderChatsList();
});

socket.on('chat_deleted_success', (chatId) => {});

socket.on('new_message', (data) => {
    const chat = chats.get(data.chatId);
    if (chat) {
        chat.messages.push(data.message);
        
        if (data.message.sender !== currentUser.nick && 
            (!currentChat || currentChat.id !== data.chatId)) {
            const currentCount = unreadMessages.get(data.chatId) || 0;
            unreadMessages.set(data.chatId, currentCount + 1);
            renderChatsList();
            playNotificationSound();
            updatePageTitle();
        }
        
        if (currentChat && currentChat.id === data.chatId) {
            renderMessages(chat);
            scrollToBottom();
            unreadMessages.set(data.chatId, 0);
            renderChatsList();
            socket.emit('mark_read', data.chatId);
        }
    }
});

function createPrivateChat(user) {
    if (!user || !user.id) return;
    
    let existingChat = null;
    for (let [chatId, chat] of chats) {
        if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
            if (chat.participants.includes(currentUser.id) && chat.participants.includes(user.id)) {
                existingChat = chat;
                break;
            }
        }
    }
    
    if (existingChat) {
        openChat(existingChat.id);
    } else {
        const chatName = `Личный чат с ${user.nick}`;
        socket.emit('create_private_chat', chatName, user.id);
    }
}

function createGroupChat() {
    const chatName = chatNameInput.value.trim();
    if (!chatName) {
        alert('Введите название чата');
        return;
    }
    
    const selectedParticipants = [];
    const checkboxes = participantsList.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        selectedParticipants.push(cb.value);
    });
    
    socket.emit('create_group_chat', chatName, selectedParticipants);
    newChatModal.classList.remove('active');
    chatNameInput.value = '';
}

function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
        audio.volume = 0.3;
        audio.play().catch(e => {});
    } catch(e) {}
}

function updateChatHeaderTitle(chat) {
    const chatHeaderH3 = chatHeader.querySelector('h3');
    if (chatHeaderH3) {
        let displayName = chat.name;
        if (chat.isPrivate && currentUser && chat.participants && chat.participants.length === 2) {
            const otherParticipantId = chat.participants.find(id => id !== currentUser.id);
            if (otherParticipantId) {
                const otherUser = allUsers.get(otherParticipantId);
                if (otherUser) {
                    displayName = otherUser.nick;
                }
            }
        }
        chatHeaderH3.textContent = displayName.toUpperCase();
    }
}

function updateUsersLists() {
    if (!onlineUsersList || !offlineUsersList) return;
    
    onlineUsersList.innerHTML = '';
    offlineUsersList.innerHTML = '';
    
    const sortedUsers = Array.from(allUsers.values()).sort((a, b) => a.nick.localeCompare(b.nick));
    let hasOnline = false;
    let hasOffline = false;
    
    sortedUsers.forEach(user => {
        if (user.id !== currentUser?.id) {
            const div = document.createElement('div');
            div.className = `user-item ${user.online ? 'online' : 'offline'}`;
            div.textContent = user.nick;
            div.style.cursor = 'pointer';
            div.title = user.online ? 'Нажмите для создания личного чата' : `Был(а) в сети: ${new Date(user.lastSeen).toLocaleString()}`;
            div.onclick = () => createPrivateChat(user);
            
            if (user.online) {
                hasOnline = true;
                onlineUsersList.appendChild(div);
            } else {
                hasOffline = true;
                offlineUsersList.appendChild(div);
            }
        }
    });
    
    if (!hasOnline) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'Нет пользователей онлайн';
        onlineUsersList.appendChild(emptyDiv);
    }
    
    if (!hasOffline) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'Нет пользователей оффлайн';
        offlineUsersList.appendChild(emptyDiv);
    }
}

function renderChatsList() {
    if (!chatsList) return;
    chatsList.innerHTML = '';
    
    if (chats.size === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'Нет чатов';
        chatsList.appendChild(emptyDiv);
        return;
    }
    
    const sortedChats = Array.from(chats.values()).sort((a, b) => {
        const lastMsgA = a.messages[a.messages.length - 1];
        const lastMsgB = b.messages[b.messages.length - 1];
        if (!lastMsgA && !lastMsgB) return 0;
        if (!lastMsgA) return 1;
        if (!lastMsgB) return -1;
        return new Date(lastMsgB.timestamp) - new Date(lastMsgA.timestamp);
    });
    
    sortedChats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        
        if (newChats.has(chat.id)) {
            div.classList.add('new-chat');
            setTimeout(() => {
                newChats.delete(chat.id);
                div.classList.remove('new-chat');
            }, 3000);
        }
        
        const unreadCount = unreadMessages.get(chat.id) || 0;
        if (unreadCount > 0 && (!currentChat || currentChat.id !== chat.id)) {
            div.classList.add('unread');
        }
        
        if (currentChat && currentChat.id === chat.id) {
            div.classList.add('active');
        }
        
        const lastMessage = chat.messages[chat.messages.length - 1];
        let preview = 'Нет сообщений';
        if (lastMessage) {
            preview = lastMessage.text.length > 30 ? lastMessage.text.substring(0, 30) + '...' : lastMessage.text;
        }
        
        let displayName = chat.name;
        if (chat.isPrivate && currentUser && chat.participants && chat.participants.length === 2) {
            const otherParticipantId = chat.participants.find(id => id !== currentUser.id);
            if (otherParticipantId) {
                const otherUser = allUsers.get(otherParticipantId);
                if (otherUser) {
                    displayName = otherUser.nick;
                }
            }
        }
        
        div.innerHTML = `
            <div class="chat-name">${escapeHtml(displayName)}</div>
            <div class="chat-preview">${escapeHtml(preview)}</div>
            ${unreadCount > 0 ? `<div class="unread-count">${unreadCount}</div>` : ''}
        `;
        
        div.onclick = () => openChat(chat.id);
        chatsList.appendChild(div);
    });
}

function openChat(chatId) {
    const chat = chats.get(chatId);
    if (chat) {
        currentChat = chat;
        updateChatHeaderTitle(chat);
        deleteChatBtn.style.display = 'block';
        messageInputContainer.style.display = 'flex';
        renderMessages(chat);
        scrollToBottom();
        
        if (unreadMessages.get(chatId) > 0) {
            unreadMessages.set(chatId, 0);
            socket.emit('mark_read', chatId);
            renderChatsList();
            updatePageTitle();
        }
        
        newChats.delete(chatId);
        renderChatsList();
    }
}

function renderMessages(chat) {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    
    if (!chat.messages || chat.messages.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-chat-message';
        emptyDiv.innerHTML = '<p>➤ НЕТ СООБЩЕНИЙ</p><p>➤ НАПИШИТЕ ЧТО-НИБУДЬ</p>';
        messagesContainer.appendChild(emptyDiv);
        return;
    }
    
    chat.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.sender === currentUser.nick ? 'own' : 'other'}`;
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-header">${msg.sender === currentUser.nick ? '[ YOU ]' : `[ ${msg.sender.toUpperCase()} ]`}</div>
            <div class="message-content">${escapeHtml(msg.text)}</div>
            <div class="message-time">${time}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
    });
}

function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message other';
    messageDiv.innerHTML = `
        <div class="message-header">[ SYSTEM ]</div>
        <div class="message-content">${escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updatePageTitle() {
    let totalUnread = 0;
    for (let count of unreadMessages.values()) {
        totalUnread += count;
    }
    document.title = totalUnread > 0 ? `(${totalUnread}) FEMBO` : 'FEMBO';
}

setInterval(updatePageTitle, 1000);

// Event listeners
if (editNickBtn) {
    editNickBtn.onclick = () => {
        newNickInput.value = currentUser.nick;
        nickModal.classList.add('active');
    };
}

if (confirmNickBtn) {
    confirmNickBtn.onclick = () => {
        const newNick = newNickInput.value.trim();
        if (newNick && newNick !== currentUser.nick) {
            saveUserNick(newNick);
            socket.emit('change_nick', newNick);
        }
        nickModal.classList.remove('active');
    };
}

if (cancelNickBtn) {
    cancelNickBtn.onclick = () => {
        nickModal.classList.remove('active');
    };
}

if (newChatBtn) {
    newChatBtn.onclick = () => {
        chatNameInput.value = '';
        participantsList.innerHTML = '';
        const otherUsers = Array.from(allUsers.values()).filter(u => u.id !== currentUser.id);
        
        if (otherUsers.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-message';
            emptyDiv.textContent = 'Нет других пользователей';
            participantsList.appendChild(emptyDiv);
        } else {
            otherUsers.forEach(user => {
                const div = document.createElement('div');
                div.className = 'participant-checkbox';
                div.innerHTML = `
                    <input type="checkbox" value="${escapeHtml(user.nick)}" id="user_${escapeHtml(user.nick)}">
                    <label for="user_${escapeHtml(user.nick)}">${escapeHtml(user.nick)} ${user.online ? '🟢' : '⚫'}</label>
                `;
                participantsList.appendChild(div);
            });
        }
        newChatModal.classList.add('active');
    };
}

if (createChatBtn) {
    createChatBtn.onclick = createGroupChat;
}

if (cancelChatBtn) {
    cancelChatBtn.onclick = () => {
        newChatModal.classList.remove('active');
    };
}

if (sendMessageBtn) {
    sendMessageBtn.onclick = () => {
        if (currentChat && messageInput.value.trim()) {
            socket.emit('send_message', {
                chatId: currentChat.id,
                message: messageInput.value.trim()
            });
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
    };
}

if (messageInput) {
    messageInput.onkeypress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (sendMessageBtn) sendMessageBtn.click();
        }
    };
    
    messageInput.oninput = function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    };
}

if (deleteChatBtn) {
    deleteChatBtn.onclick = () => {
        if (currentChat && confirm(`Удалить чат "${currentChat.name}"?`)) {
            socket.emit('delete_chat', currentChat.id);
        }
    };
}

if (searchInput) {
    searchInput.oninput = (e) => {
        const query = e.target.value.trim();
        if (query) {
            socket.emit('search_users', query);
        } else {
            searchResults.classList.remove('active');
        }
    };
}

document.addEventListener('click', (e) => {
    if (searchInput && searchResults && 
        !searchInput.contains(e.target) && 
        !searchResults.contains(e.target)) {
        searchResults.classList.remove('active');
    }
});

console.log('🦊 FEMBO Messenger ready');