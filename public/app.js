const socket = io();

// State
let currentUser = null;
let currentChat = null;
let chats = new Map();
let onlineUsers = new Map();
let unreadMessages = new Map();
let newChats = new Set();

// DOM elements
const currentNickSpan = document.getElementById('currentNick');
const editNickBtn = document.getElementById('editNickBtn');
const newChatBtn = document.getElementById('newChatBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const onlineUsersList = document.getElementById('onlineUsersList');
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

// Функции для работы с localStorage
function saveUserNick(nick) {
    localStorage.setItem('messenger_user_nick', nick);
}

function getSavedNick() {
    return localStorage.getItem('messenger_user_nick');
}

// Registration - проверяем сохраненный ник
let userNick = getSavedNick();
if (!userNick) {
    userNick = prompt('Введите ваш ник:', 'User' + Math.floor(Math.random() * 1000));
    if (userNick) {
        saveUserNick(userNick);
    }
} else {
    // Спрашиваем, хочет ли пользователь использовать сохраненный ник
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
    currentUser = data.user;
    currentNickSpan.textContent = data.user.nick;
    
    data.chats.forEach(chat => {
        chats.set(chat.id, chat);
        if (!unreadMessages.has(chat.id)) {
            unreadMessages.set(chat.id, 0);
        }
    });
    
    data.onlineUsers.forEach(user => {
        onlineUsers.set(user.nick, user);
    });
    
    updateOnlineUsersList();
    renderChatsList();
});

socket.on('registration_error', (error) => {
    alert(error);
    // Очищаем сохраненный ник при ошибке
    localStorage.removeItem('messenger_user_nick');
    const newNick = prompt('Введите другой ник:');
    if (newNick) {
        saveUserNick(newNick);
        socket.emit('register', newNick);
    }
});

socket.on('user_online', (user) => {
    onlineUsers.set(user.nick, user);
    updateOnlineUsersList();
    // Обновляем отображение чатов (для обновления имен)
    renderChatsList();
    if (currentChat) {
        updateChatHeaderTitle(currentChat);
    }
});

socket.on('user_offline', (user) => {
    onlineUsers.delete(user.nick);
    updateOnlineUsersList();
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
    
    const userData = onlineUsers.get(data.oldNick);
    if (userData) {
        onlineUsers.delete(data.oldNick);
        onlineUsers.set(data.newNick, { ...userData, nick: data.newNick });
    }
    
    updateOnlineUsersList();
    
    chats.forEach(chat => {
        chat.messages.forEach(msg => {
            if (msg.sender === data.oldNick) {
                msg.sender = data.newNick;
            }
        });
        
        // Обновляем название личного чата если нужно
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
    console.log('New chat received:', chat);
    chats.set(chat.id, chat);
    unreadMessages.set(chat.id, 0);
    newChats.add(chat.id);
    renderChatsList();
    playNotificationSound();
});

socket.on('chat_created', (chat) => {
    console.log('Chat created:', chat);
    newChatModal.classList.remove('active');
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
        if (chatHeaderH3) chatHeaderH3.textContent = 'Выберите чат';
        deleteChatBtn.style.display = 'none';
        messageInputContainer.style.display = 'none';
        messagesContainer.innerHTML = '<div class="empty-chat-message"><p>Выберите чат для начала общения</p></div>';
    }
    renderChatsList();
});

socket.on('chat_deleted_success', (chatId) => {
    console.log('Chat deleted:', chatId);
});

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
        }
        
        if (currentChat && currentChat.id === data.chatId) {
            renderMessages(chat);
            scrollToBottom();
            unreadMessages.set(data.chatId, 0);
            renderChatsList();
        }
    }
});

// Функция для создания личного чата
function createPrivateChat(user) {
    console.log('Creating private chat with:', user);
    
    if (!user || !user.id) {
        console.error('Invalid user data:', user);
        return;
    }
    
    // Проверяем, существует ли уже личный чат с этим пользователем
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
        console.log('Existing chat found:', existingChat);
        openChat(existingChat.id);
    } else {
        // Название чата всегда "Личный чат с [ник собеседника]"
        const chatName = `Личный чат с ${user.nick}`;
        console.log('Creating new private chat:', chatName, user.id);
        socket.emit('create_private_chat', chatName, user.id);
    }
}

// Функция для создания группового чата
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

// Функция воспроизведения звука
function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
        audio.volume = 0.3;
        audio.play().catch(e => console.log('Audio play failed:', e));
    } catch(e) {
        console.log('Sound not supported');
    }
}

// Обновление заголовка чата
function updateChatHeaderTitle(chat) {
    const chatHeaderH3 = chatHeader.querySelector('h3');
    if (chatHeaderH3) {
        let displayName = chat.name;
        if (chat.isPrivate && currentUser) {
            // Для личных чатов показываем имя собеседника
            if (chat.participants && chat.participants.length === 2) {
                const otherParticipantId = chat.participants.find(id => id !== currentUser.id);
                if (otherParticipantId) {
                    const otherUser = Array.from(onlineUsers.values()).find(u => u.id === otherParticipantId);
                    if (otherUser) {
                        displayName = otherUser.nick;
                    } else {
                        // Если пользователь не онлайн, извлекаем из названия
                        displayName = chat.name.replace('Личный чат с ', '');
                    }
                }
            }
        }
        chatHeaderH3.textContent = displayName;
    }
}

// Обновление списка онлайн пользователей
function updateOnlineUsersList() {
    onlineUsersList.innerHTML = '';
    const sortedUsers = Array.from(onlineUsers.values()).sort((a, b) => a.nick.localeCompare(b.nick));
    let hasUsers = false;
    
    sortedUsers.forEach(user => {
        if (user.nick !== currentUser?.nick) {
            hasUsers = true;
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = user.nick;
            div.style.cursor = 'pointer';
            div.title = 'Нажмите для создания личного чата';
            div.onclick = () => {
                console.log('Clicked on user:', user);
                createPrivateChat(user);
            };
            onlineUsersList.appendChild(div);
        }
    });
    
    if (!hasUsers) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'Нет других пользователей онлайн';
        onlineUsersList.appendChild(emptyDiv);
    }
}

// Рендер списка чатов
function renderChatsList() {
    chatsList.innerHTML = '';
    
    if (chats.size === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'Нет чатов. Создайте новый чат или начните диалог с пользователем';
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
        
        // Формируем отображаемое название чата
        let displayName = chat.name;
        if (chat.isPrivate && currentUser) {
            // Для личных чатов показываем имя собеседника
            if (chat.participants && chat.participants.length === 2) {
                const otherParticipantId = chat.participants.find(id => id !== currentUser.id);
                if (otherParticipantId) {
                    const otherUser = Array.from(onlineUsers.values()).find(u => u.id === otherParticipantId);
                    if (otherUser) {
                        displayName = otherUser.nick;
                    } else {
                        // Если пользователь не онлайн, извлекаем из названия
                        displayName = chat.name.replace('Личный чат с ', '');
                    }
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

// Открытие чата
function openChat(chatId) {
    const chat = chats.get(chatId);
    if (chat) {
        currentChat = chat;
        updateChatHeaderTitle(chat);
        deleteChatBtn.style.display = 'block';
        messageInputContainer.style.display = 'flex';
        renderMessages(chat);
        scrollToBottom();
        
        unreadMessages.set(chatId, 0);
        newChats.delete(chatId);
        renderChatsList();
    }
}

// Рендер сообщений
function renderMessages(chat) {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    chat.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.sender === currentUser.nick ? 'own' : 'other'}`;
        
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-header">${escapeHtml(msg.sender)}</div>
            <div class="message-content">${escapeHtml(msg.text)}</div>
            <div class="message-time">${time}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
    });
}

// Добавление системного сообщения
function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message other';
    messageDiv.innerHTML = `
        <div class="message-header">Система</div>
        <div class="message-content">${escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

// Скролл вниз
function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Эскейп HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обновление заголовка страницы
function updatePageTitle() {
    let totalUnread = 0;
    for (let count of unreadMessages.values()) {
        totalUnread += count;
    }
    
    if (totalUnread > 0) {
        document.title = `(${totalUnread}) Dark Messenger`;
    } else {
        document.title = 'Dark Messenger';
    }
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
        const onlineUsersArray = Array.from(onlineUsers.values());
        const otherUsers = onlineUsersArray.filter(u => u.nick !== currentUser.nick);
        
        if (otherUsers.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-message';
            emptyDiv.textContent = 'Нет других пользователей онлайн для создания группового чата';
            participantsList.appendChild(emptyDiv);
        } else {
            otherUsers.forEach(user => {
                const div = document.createElement('div');
                div.className = 'participant-checkbox';
                div.innerHTML = `
                    <input type="checkbox" value="${escapeHtml(user.nick)}" id="user_${escapeHtml(user.nick)}">
                    <label for="user_${escapeHtml(user.nick)}">${escapeHtml(user.nick)}</label>
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
        if (currentChat && confirm(`Удалить чат "${currentChat.name}"?\nВсе сообщения будут удалены безвозвратно.`)) {
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

console.log('App initialized');