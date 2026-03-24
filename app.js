const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// State
let currentUser = null;
let currentChat = null;
let chats = new Map();
let allUsers = new Map();

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
const imageUpload = document.getElementById('imageUpload');

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

// Сохранение ника
function saveUserNick(nick) {
    localStorage.setItem('fembo_nick', nick);
}

function getSavedNick() {
    return localStorage.getItem('fembo_nick');
}

// Регистрация
let userNick = getSavedNick();
if (!userNick) {
    userNick = prompt('Введите ваш ник:', 'User' + Math.floor(Math.random() * 1000));
    if (userNick) saveUserNick(userNick);
} else {
    const useSaved = confirm(`Использовать "${userNick}"?`);
    if (!useSaved) {
        userNick = prompt('Введите ник:', userNick);
        if (userNick) saveUserNick(userNick);
    }
}

if (userNick) {
    socket.emit('register', userNick);
}

// Отправка изображения
function sendImage(file) {
    if (!currentChat) {
        alert('Выберите чат');
        return;
    }
    if (!file.type.startsWith('image/')) {
        alert('Выберите изображение');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('Максимум 5MB');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        socket.emit('send_image', {
            chatId: currentChat.id,
            image: e.target.result
        });
    };
    reader.readAsDataURL(file);
}

// Socket handlers
socket.on('initial_data', (data) => {
    console.log('Initial data received');
    currentUser = data.user;
    currentNickSpan.textContent = data.user.nick;
    
    chats.clear();
    allUsers.clear();
    
    data.chats.forEach(chat => chats.set(chat.id, chat));
    data.allUsers.forEach(user => allUsers.set(user.id, user));
    
    updateUsersLists();
    renderChatsList();
    
    // Открываем общий чат
    const general = Array.from(chats.values()).find(c => c.id === 'general_chat');
    if (general) openChat(general.id);
});

socket.on('registration_error', (err) => {
    alert(err);
    localStorage.removeItem('fembo_nick');
    const newNick = prompt('Введите другой ник:');
    if (newNick) {
        saveUserNick(newNick);
        socket.emit('register', newNick);
    }
});

socket.on('user_online', (user) => {
    const existing = allUsers.get(user.id);
    if (existing) {
        existing.online = true;
        existing.lastSeen = new Date();
        allUsers.set(user.id, existing);
    } else {
        allUsers.set(user.id, { ...user, online: true, lastSeen: new Date() });
    }
    updateUsersLists();
    renderChatsList();
});

socket.on('user_offline', (user) => {
    const existing = allUsers.get(user.id);
    if (existing) {
        existing.online = false;
        existing.lastSeen = new Date();
        allUsers.set(user.id, existing);
    }
    updateUsersLists();
    renderChatsList();
});

socket.on('nick_changed', (data) => {
    if (currentUser && data.id === currentUser.id) {
        currentUser.nick = data.newNick;
        currentNickSpan.textContent = data.newNick;
        saveUserNick(data.newNick);
    }
    const user = allUsers.get(data.id);
    if (user) {
        user.nick = data.newNick;
        allUsers.set(data.id, user);
    }
    updateUsersLists();
    renderChatsList();
    if (currentChat) renderMessages(currentChat);
});

socket.on('nick_changed_success', (data) => {
    currentUser.nick = data.newNick;
    currentNickSpan.textContent = data.newNick;
});

socket.on('nick_error', (err) => alert(err));

socket.on('search_results', (results) => {
    searchResults.innerHTML = '';
    if (results.length) {
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
    renderChatsList();
});

socket.on('chat_created', () => {
    newChatModal.classList.remove('active');
});

socket.on('chat_exists', (data) => {
    openChat(data.id);
});

socket.on('open_chat', (data) => {
    const chat = chats.get(data.id);
    if (chat) openChat(data.id);
});

socket.on('joined_chat', (chat) => {
    chats.set(chat.id, chat);
    renderChatsList();
    openChat(chat.id);
});

socket.on('user_joined', (data) => {
    if (currentChat && currentChat.id === data.chatId) {
        addSystemMessage(`${data.nick} присоединился`);
    }
});

socket.on('chat_deleted', (chatId) => {
    chats.delete(chatId);
    if (currentChat && currentChat.id === chatId) {
        currentChat = null;
        chatHeader.querySelector('h3').textContent = 'Выберите чат';
        deleteChatBtn.style.display = 'none';
        messageInputContainer.style.display = 'none';
        messagesContainer.innerHTML = '<div class="empty-chat-message"><p>Выберите чат</p></div>';
    }
    renderChatsList();
});

socket.on('chat_deleted_success', () => {});

socket.on('new_message', (data) => {
    const chat = chats.get(data.chatId);
    if (chat) {
        chat.messages.push(data.message);
        if (currentChat && currentChat.id === data.chatId) {
            renderMessages(chat);
            scrollToBottom();
        }
        renderChatsList();
    }
});

socket.on('new_image', (data) => {
    const chat = chats.get(data.chatId);
    if (chat) {
        const imgMsg = {
            id: Date.now(),
            type: 'image',
            image: data.image,
            sender: data.sender,
            senderId: data.senderId,
            timestamp: data.timestamp
        };
        chat.messages.push(imgMsg);
        if (currentChat && currentChat.id === data.chatId) {
            renderMessages(chat);
            scrollToBottom();
        }
        renderChatsList();
    }
});

// Функции UI
function createPrivateChat(user) {
    if (!user || !user.id) return;
    
    let existing = null;
    for (let [id, chat] of chats) {
        if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
            if (chat.participants.includes(currentUser.id) && chat.participants.includes(user.id)) {
                existing = chat;
                break;
            }
        }
    }
    
    if (existing) {
        openChat(existing.id);
    } else {
        socket.emit('create_private_chat', `Личный чат с ${user.nick}`, user.id);
    }
}

function createGroupChat() {
    const name = chatNameInput.value.trim();
    if (!name) {
        alert('Введите название');
        return;
    }
    const selected = [];
    document.querySelectorAll('#participantsList input:checked').forEach(cb => {
        selected.push(cb.value);
    });
    socket.emit('create_group_chat', name, selected);
    newChatModal.classList.remove('active');
    chatNameInput.value = '';
}

function updateUsersLists() {
    if (!onlineUsersList || !offlineUsersList) return;
    
    onlineUsersList.innerHTML = '';
    offlineUsersList.innerHTML = '';
    
    const sorted = Array.from(allUsers.values()).sort((a, b) => a.nick.localeCompare(b.nick));
    let hasOnline = false, hasOffline = false;
    
    sorted.forEach(user => {
        if (user.id !== currentUser?.id) {
            const div = document.createElement('div');
            div.className = `user-item ${user.online ? 'online' : 'offline'}`;
            div.textContent = user.nick;
            div.style.cursor = 'pointer';
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
    
    if (!hasOnline) onlineUsersList.innerHTML = '<div class="empty-message">Нет онлайн</div>';
    if (!hasOffline) offlineUsersList.innerHTML = '<div class="empty-message">Нет оффлайн</div>';
}

function renderChatsList() {
    if (!chatsList) return;
    chatsList.innerHTML = '';
    
    if (chats.size === 0) {
        chatsList.innerHTML = '<div class="empty-message">Нет чатов</div>';
        return;
    }
    
    const sorted = Array.from(chats.values()).sort((a, b) => {
        const lastA = a.messages[a.messages.length - 1];
        const lastB = b.messages[b.messages.length - 1];
        if (!lastA && !lastB) return 0;
        if (!lastA) return 1;
        if (!lastB) return -1;
        return new Date(lastB.timestamp) - new Date(lastA.timestamp);
    });
    
    sorted.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        if (currentChat && currentChat.id === chat.id) div.classList.add('active');
        
        const last = chat.messages[chat.messages.length - 1];
        let preview = 'Нет сообщений';
        if (last) {
            if (last.type === 'image') preview = '📷 Изображение';
            else if (last.text) preview = last.text.substring(0, 30);
        }
        
        let name = chat.name;
        if (chat.isPrivate && chat.participants && chat.participants.length === 2) {
            const otherId = chat.participants.find(id => id !== currentUser.id);
            const other = allUsers.get(otherId);
            if (other) name = other.nick;
        }
        
        div.innerHTML = `<div class="chat-name">${escapeHtml(name)}</div><div class="chat-preview">${escapeHtml(preview)}</div>`;
        div.onclick = () => openChat(chat.id);
        chatsList.appendChild(div);
    });
}

function openChat(chatId) {
    const chat = chats.get(chatId);
    if (chat) {
        currentChat = chat;
        chatHeader.querySelector('h3').textContent = chat.isPrivate ? 
            (chat.participants?.find(id => id !== currentUser.id) ? 
                allUsers.get(chat.participants.find(id => id !== currentUser.id))?.nick || chat.name : chat.name) : chat.name;
        deleteChatBtn.style.display = 'block';
        messageInputContainer.style.display = 'flex';
        renderMessages(chat);
        scrollToBottom();
        renderChatsList();
    }
}

function renderMessages(chat) {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    
    if (!chat.messages || chat.messages.length === 0) {
        messagesContainer.innerHTML = '<div class="empty-chat-message"><p>Нет сообщений</p></div>';
        return;
    }
    
    chat.messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.sender === currentUser.nick ? 'own' : 'other'}`;
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let content = '';
        if (msg.type === 'image') {
            content = `<img src="${msg.image}" class="message-image" onclick="openImageModal('${msg.image}')" style="max-width:200px;max-height:200px;cursor:pointer">`;
        } else {
            content = `<div class="message-content">${escapeHtml(msg.text || '')}</div>`;
        }
        
        div.innerHTML = `<div class="message-header">${escapeHtml(msg.sender)}</div>${content}<div class="message-time">${time}</div>`;
        messagesContainer.appendChild(div);
    });
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message other';
    div.innerHTML = `<div class="message-header">Система</div><div class="message-content">${escapeHtml(text)}</div>`;
    messagesContainer.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.openImageModal = function(src) {
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = '<div class="close-image">&times;</div><img src="">';
        document.body.appendChild(modal);
        modal.onclick = (e) => {
            if (e.target === modal || e.target.className === 'close-image') {
                modal.classList.remove('active');
            }
        };
    }
    modal.querySelector('img').src = src;
    modal.classList.add('active');
};

// Event listeners
if (imageUpload) {
    imageUpload.onchange = (e) => {
        if (e.target.files && e.target.files[0]) {
            sendImage(e.target.files[0]);
            imageUpload.value = '';
        }
    };
}

if (editNickBtn) {
    editNickBtn.onclick = () => {
        newNickInput.value = currentUser?.nick || '';
        nickModal.classList.add('active');
    };
}

if (confirmNickBtn) {
    confirmNickBtn.onclick = () => {
        const newNick = newNickInput.value.trim();
        if (newNick && newNick !== currentUser?.nick) {
            saveUserNick(newNick);
            socket.emit('change_nick', newNick);
        }
        nickModal.classList.remove('active');
    };
}

if (cancelNickBtn) {
    cancelNickBtn.onclick = () => nickModal.classList.remove('active');
}

if (newChatBtn) {
    newChatBtn.onclick = () => {
        chatNameInput.value = '';
        participantsList.innerHTML = '';
        const others = Array.from(allUsers.values()).filter(u => u.id !== currentUser?.id);
        if (others.length === 0) {
            participantsList.innerHTML = '<div class="empty-message">Нет пользователей</div>';
        } else {
            others.forEach(user => {
                const div = document.createElement('div');
                div.className = 'participant-checkbox';
                div.innerHTML = `<input type="checkbox" value="${escapeHtml(user.nick)}"><label>${escapeHtml(user.nick)} ${user.online ? '🟢' : '⚫'}</label>`;
                participantsList.appendChild(div);
            });
        }
        newChatModal.classList.add('active');
    };
}

if (createChatBtn) createChatBtn.onclick = createGroupChat;
if (cancelChatBtn) cancelChatBtn.onclick = () => newChatModal.classList.remove('active');

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
            sendMessageBtn.click();
        }
    };
    messageInput.oninput = function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    };
}

if (deleteChatBtn) {
    deleteChatBtn.onclick = () => {
        if (currentChat && confirm(`Удалить "${currentChat.name}"?`)) {
            socket.emit('delete_chat', currentChat.id);
        }
    };
}

if (searchInput) {
    searchInput.oninput = (e) => {
        const q = e.target.value.trim();
        if (q) socket.emit('search_users', q);
        else searchResults.classList.remove('active');
    };
}

document.addEventListener('click', (e) => {
    if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.remove('active');
    }
});

console.log('🦊 Fembo ready');