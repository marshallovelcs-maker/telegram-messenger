const socket = io();

// State
let currentUser = null;
let currentChat = null;
let chats = new Map();
let onlineUsers = new Set();
let allUsers = new Map(); // Добавляем хранилище всех пользователей

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

// Registration
let userNick = prompt('Введите ваш ник:', 'User' + Math.floor(Math.random() * 1000));
if (userNick) {
    socket.emit('register', userNick);
}

// Socket event handlers
socket.on('initial_data', (data) => {
    currentUser = data.user;
    currentNickSpan.textContent = data.user.nick;
    
    data.chats.forEach(chat => {
        chats.set(chat.id, chat);
    });
    
    data.onlineUsers.forEach(nick => {
        onlineUsers.add(nick);
    });
    
    updateOnlineUsersList();
    renderChatsList();
});

socket.on('registration_error', (error) => {
    alert(error);
    const newNick = prompt('Введите другой ник:');
    if (newNick) {
        socket.emit('register', newNick);
    }
});

socket.on('user_online', (user) => {
    onlineUsers.add(user.nick);
    allUsers.set(user.id, user); // Сохраняем пользователя
    updateOnlineUsersList();
});

socket.on('user_offline', (user) => {
    onlineUsers.delete(user.nick);
    updateOnlineUsersList();
});

socket.on('nick_changed', (data) => {
    if (currentUser && data.id === currentUser.id) {
        currentUser.nick = data.newNick;
        currentNickSpan.textContent = data.newNick;
    }
    
    onlineUsers.delete(data.oldNick);
    onlineUsers.add(data.newNick);
    updateOnlineUsersList();
    
    chats.forEach(chat => {
        chat.messages.forEach(msg => {
            if (msg.sender === data.oldNick) {
                msg.sender = data.newNick;
            }
        });
    });
    
    if (currentChat) {
        renderMessages(currentChat);
    }
});

socket.on('nick_changed_success', (data) => {
    currentUser.nick = data.newNick;
    currentNickSpan.textContent = data.newNick;
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
    renderChatsList();
});

socket.on('chat_created', (chat) => {
    // Не показываем уведомление для личных чатов
    if (!chat.isPrivate) {
        // alert(`Чат "${chat.name}" создан!`);
    }
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
    // alert('Чат удален');
});

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

// Функция для создания личного чата
function createPrivateChat(user) {
    // Проверяем, существует ли уже личный чат с этим пользователем
    let existingChat = null;
    for (let [chatId, chat] of chats) {
        // Если чат называется "Личный чат с [ник]" и в нем только 2 участника
        if (chat.name === `Личный чат с ${user.nick}` || 
            (chat.participants && chat.participants.length === 2 && 
             chat.messages.some(msg => msg.sender === user.nick))) {
            existingChat = chat;
            break;
        }
    }
    
    if (existingChat) {
        // Если чат уже существует, просто открываем его
        openChat(existingChat.id);
    } else {
        // Создаем новый личный чат
        const chatName = `Личный чат с ${user.nick}`;
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

// UI Functions
function updateOnlineUsersList() {
    onlineUsersList.innerHTML = '';
    const sortedUsers = Array.from(onlineUsers).sort();
    sortedUsers.forEach(nick => {
        if (nick !== currentUser?.nick) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = nick;
            div.style.cursor = 'pointer';
            div.onclick = () => {
                // Находим пользователя по нику и создаем личный чат
                const user = { nick: nick, id: null };
                // Ищем ID пользователя
                for (let [id, u] of allUsers) {
                    if (u.nick === nick) {
                        user.id = id;
                        break;
                    }
                }
                createPrivateChat(user);
            };
            onlineUsersList.appendChild(div);
        }
    });
}

function renderChatsList() {
    chatsList.innerHTML = '';
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
        if (currentChat && currentChat.id === chat.id) {
            div.classList.add('active');
        }
        
        const lastMessage = chat.messages[chat.messages.length - 1];
        const preview = lastMessage ? lastMessage.text.substring(0, 30) : 'Нет сообщений';
        
        div.innerHTML = `
            <div class="chat-name">${escapeHtml(chat.name)}</div>
            <div class="chat-preview">${escapeHtml(preview)}</div>
        `;
        
        div.onclick = () => openChat(chat.id);
        chatsList.appendChild(div);
    });
}

function openChat(chatId) {
    const chat = chats.get(chatId);
    if (chat) {
        currentChat = chat;
        const chatHeaderH3 = chatHeader.querySelector('h3');
        if (chatHeaderH3) chatHeaderH3.textContent = chat.name;
        deleteChatBtn.style.display = 'block';
        messageInputContainer.style.display = 'flex';
        renderMessages(chat);
        scrollToBottom();
    }
}

function renderMessages(chat) {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    chat.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.sender === currentUser.nick ? 'own' : 'other'}`;
        
        const time = new Date(msg.timestamp).toLocaleTimeString();
        
        messageDiv.innerHTML = `
            <div class="message-header">${escapeHtml(msg.sender)}</div>
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
        <div class="message-header">Система</div>
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
        onlineUsers.forEach(nick => {
            if (nick !== currentUser.nick) {
                const div = document.createElement('div');
                div.className = 'participant-checkbox';
                div.innerHTML = `
                    <input type="checkbox" value="${nick}">
                    <label>${escapeHtml(nick)}</label>
                `;
                participantsList.appendChild(div);
            }
        });
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

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (searchInput && searchResults && 
        !searchInput.contains(e.target) && 
        !searchResults.contains(e.target)) {
        searchResults.classList.remove('active');
    }
});