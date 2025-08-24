// === FIREBASE CONFIGURATION ===
const firebaseConfig = {
    apiKey: "AIzaSyDVrEG6fMMxcyhrDNf6_Ru_ZJIhILTMvvQ",
    authDomain: "vaanilink.firebaseapp.com",
    databaseURL: "https://vaanilink-default-rtdb.firebaseio.com",
    projectId: "vaanilink",
    storageBucket: "vaanilink.appspot.com",
    messagingSenderId: "416935212144",
    appId: "1:416935212144:web:5d0b8e83704e53b246b0b5"
};

// === INITIALIZE FIREBASE ===
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// === GLOBAL STATE VARIABLES ===
let currentUser = null;
let currentUserProfile = null;
let currentChatPartner = null;
let currentCallPartnerId = null;
let currentChatId = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let incomingCallData = null;
let chatListeners = {};
let activeListeners = {};
let typingTimeout = null;
let lastTypingTime = 0;
let userChatsListener = null;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// === UTILITY FUNCTIONS ===

function showView(viewId) {
    console.log('Switching to view:', viewId);
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
}

function showModal(modalId, show = true) {
    const modal = document.getElementById(modalId);
    if (show) {
        modal.classList.add('visible');
    } else {
        modal.classList.remove('visible');
    }
}

function closeModal(modalId) {
    showModal(modalId, false);
}

function showPanel(panelId) {
    document.querySelectorAll('.content-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.getElementById(panelId).classList.add('active');
    document.getElementById(`nav-${panelId.split('-')[0]}`).classList.add('active');
}

function showLoading(elementId, show = true) {
    const element = document.getElementById(elementId);
    const spinner = element.querySelector('.loading-spinner');
    const text = element.querySelector('.btn-text');
    
    if (show) {
        if (spinner) spinner.style.display = 'inline-block';
        if (text) text.style.display = 'none';
        element.disabled = true;
    } else {
        if (spinner) spinner.style.display = 'none';
        if (text) text.style.display = 'inline';
        element.disabled = false;
    }
}

function showError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('error');
        errorEl.style.display = 'block';
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }
}

function showSuccess(elementId, message) {
    const successEl = document.getElementById(elementId);
    if (successEl) {
        successEl.textContent = message;
        successEl.classList.add('success');
        successEl.style.display = 'block';
        setTimeout(() => {
            successEl.style.display = 'none';
        }, 3000);
    }
}

function generateChatId(uid1, uid2) {
    return [uid1, uid2].sort().join('_');
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
}

function getUserEmoji(displayName) {
    if (!displayName) return '👤';
    const emojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵'];
    const index = displayName.charCodeAt(0) % emojis.length;
    return emojis[index];
}

// === AUTHENTICATION ===

function initAuth() {
    console.log('Initializing authentication...');
    
    auth.onAuthStateChanged(async (user) => {
        console.log('Auth state changed:', user ? user.uid : 'null');
        
        if (user) {
            currentUser = user;
            await loadUserProfile();
        } else {
            currentUser = null;
            currentUserProfile = null;
            cleanupListeners();
            showView('auth-view');
        }
    });
}

async function signInWithGoogle() {
    try {
        showLoading('google-signin-btn');
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('profile');
        provider.addScope('email');
        
        const result = await auth.signInWithPopup(provider);
        console.log('Google sign-in successful:', result.user.uid);
    } catch (error) {
        console.error('Google sign-in error:', error);
        showError('auth-error', 'Failed to sign in. Please try again.');
    } finally {
        showLoading('google-signin-btn', false);
    }
}

async function loadUserProfile() {
    try {
        const userRef = database.ref(`users/${currentUser.uid}`);
        const snapshot = await userRef.once('value');
        
        if (snapshot.exists()) {
            currentUserProfile = snapshot.val();
            console.log('User profile loaded:', currentUserProfile.username);
            initializeApp();
            showView('main-view');
        } else {
            console.log('No profile found, showing setup');
            showView('profile-setup-view');
            prefillProfileForm();
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
        showError('auth-error', 'Failed to load profile');
    }
}

function prefillProfileForm() {
    if (currentUser.displayName) {
        document.getElementById('display-name-input').value = currentUser.displayName;
    }
}

async function logout() {
    try {
        await setUserOnlineStatus(false);
        cleanupListeners();
        await auth.signOut();
        console.log('User logged out');
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// === PROFILE SETUP ===

let usernameCheckTimeout;
let profilePicDataUrl = null;

async function setupProfile(event) {
    event.preventDefault();
    
    const displayName = document.getElementById('display-name-input').value.trim();
    const username = document.getElementById('username-input').value.trim().toLowerCase();
    const bio = document.getElementById('bio-input').value.trim();

    if (!displayName || !username) {
        showError('profile-error', 'Please fill in all required fields');
        return;
    }

    if (username.length < 3) {
        showError('profile-error', 'Username must be at least 3 characters');
        return;
    }

    try {
        showLoading('save-profile-btn');

        const usernameExists = await checkUsernameAvailability(username);
        if (usernameExists) {
            showError('profile-error', 'Username is already taken');
            showLoading('save-profile-btn', false);
            return;
        }

        const userProfile = {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: displayName,
            username: username,
            bio: bio,
            profilePicture: profilePicDataUrl || null,
            emoji: getUserEmoji(displayName),
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            isOnline: true,
            followersCount: 0,
            followingCount: 0
        };

        await database.ref(`users/${currentUser.uid}`).set(userProfile);
        await database.ref(`usernames/${username}`).set(currentUser.uid);
        
        currentUserProfile = userProfile;
        console.log('Profile created successfully');
        
        showSuccess('profile-success', 'Profile created successfully!');
        setTimeout(() => {
            initializeApp();
            showView('main-view');
        }, 1000);

    } catch (error) {
        console.error('Profile setup error:', error);
        showError('profile-error', 'Failed to create profile. Please try again.');
    } finally {
        showLoading('save-profile-btn', false);
    }
}

async function checkUsernameAvailability(username) {
    try {
        const snapshot = await database.ref(`usernames/${username}`).once('value');
        const isAvailable = !snapshot.exists();
        
        const validationEl = document.getElementById('username-validation');
        if (isAvailable) {
            validationEl.textContent = 'Username is available!';
            validationEl.className = 'validation-message success';
            validationEl.style.display = 'block';
        } else {
            validationEl.textContent = 'Username is already taken';
            validationEl.className = 'validation-message error';
            validationEl.style.display = 'block';
        }
        
        return !isAvailable;
    } catch (error) {
        console.error('Username check error:', error);
        return false;
    }
}

function handleUsernameInput() {
    const username = document.getElementById('username-input').value.trim().toLowerCase();
    
    clearTimeout(usernameCheckTimeout);
    document.getElementById('username-validation').style.display = 'none';
    
    if (username.length >= 3) {
        usernameCheckTimeout = setTimeout(() => {
            checkUsernameAvailability(username);
        }, 500);
    }
}

function handleProfilePicUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        alert('Profile picture must be smaller than 5MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        profilePicDataUrl = e.target.result;
        const preview = document.getElementById('profile-pic-preview');
        preview.innerHTML = `<img src="${profilePicDataUrl}" alt="Profile">`;
    };
    reader.readAsDataURL(file);
}

// === APP INITIALIZATION ===

function initializeApp() {
    console.log('Initializing app for user:', currentUserProfile.username);
    
    setUserOnlineStatus(true);
    
    listenForFollowRequests();
    listenForIncomingCalls();
    loadUserChats();
    loadCallHistory();
    
    document.addEventListener('visibilitychange', () => {
        if (currentUserProfile) {
            setUserOnlineStatus(!document.hidden);
        }
    });
    
    window.addEventListener('beforeunload', (e) => {
        if (currentUserProfile) {
            setUserOnlineStatus(false);
        }
    });
}

async function setUserOnlineStatus(isOnline) {
    if (!currentUser) return;
    
    const userStatusRef = database.ref(`/users/${currentUser.uid}`);
    const onDisconnectRef = userStatusRef.onDisconnect();
    
    try {
        if (isOnline) {
            await userStatusRef.update({
                isOnline: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            await onDisconnectRef.update({
                isOnline: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
             await userStatusRef.update({
                isOnline: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        }
    } catch (error) {
        console.error('Error updating online status:', error);
    }
}

function cleanupListeners() {
    console.log('Cleaning up listeners');
    Object.values(activeListeners).forEach(listener => listener.ref.off(listener.event, listener.callback));
    activeListeners = {};
    Object.values(chatListeners).forEach(listener => listener.ref.off('value', listener.callback));
    chatListeners = {};
    if (userChatsListener) userChatsListener.ref.off('value', userChatsListener.callback);
}

// === USER SEARCH & DISCOVERY ===

let searchTimeout;

function handleUserSearch() {
    const query = document.getElementById('user-search-input').value.trim().toLowerCase();
    
    clearTimeout(searchTimeout);
    
    if (query.length < 2) {
        document.getElementById('search-results').innerHTML = `<div class="placeholder-text"><span class="emoji">🔍</span>Type at least 2 characters to search</div>`;
        return;
    }

    searchTimeout = setTimeout(() => searchUsers(query), 300);
}

async function searchUsers(query) {
    try {
        document.getElementById('search-results').innerHTML = `<div class="placeholder-text"><div class="loading-spinner"></div> Searching...</div>`;

        const usersRef = database.ref('users');
        const snapshot = await usersRef.orderByChild('username').startAt(query).endAt(query + '\uf8ff').limitToFirst(20).once('value');

        const results = [];
        snapshot.forEach(childSnapshot => {
            const user = childSnapshot.val();
            if (user.uid !== currentUser.uid) {
                results.push(user);
            }
        });

        displaySearchResults(results);
    } catch (error) {
        console.error('Search error:', error);
        document.getElementById('search-results').innerHTML = `<div class="placeholder-text"><span class="emoji">❌</span>Search failed.</div>`;
    }
}

function displaySearchResults(users) {
    const resultsContainer = document.getElementById('search-results');
    
    if (users.length === 0) {
        resultsContainer.innerHTML = `<div class="placeholder-text"><span class="emoji">😔</span>No users found</div>`;
        return;
    }

    resultsContainer.innerHTML = '';
    users.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'list-item';
        userEl.innerHTML = `
            <div class="avatar">${user.emoji}</div>
            <div class="item-content">
                <div class="item-title">${user.displayName}</div>
                <div class="item-subtitle">@${user.username}</div>
            </div>
            <button class="btn btn-primary btn-small follow-btn" data-uid="${user.uid}">Follow</button>
        `;
        resultsContainer.appendChild(userEl);
    });
}

// === FOLLOW SYSTEM ===

async function sendFollowRequest(targetUid) {
    try {
        const requestData = {
            from: currentUser.uid,
            fromUser: {
                uid: currentUser.uid,
                displayName: currentUserProfile.displayName,
                username: currentUserProfile.username,
                emoji: currentUserProfile.emoji
            },
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'pending'
        };

        await database.ref(`followRequests/${targetUid}/${currentUser.uid}`).set(requestData);
        console.log('Follow request sent to:', targetUid);
        
        const btn = document.querySelector(`.follow-btn[data-uid="${targetUid}"]`);
        if (btn) {
            btn.textContent = 'Requested';
            btn.disabled = true;
            btn.classList.replace('btn-primary', 'btn-secondary');
        }
    } catch (error) {
        console.error('Error sending follow request:', error);
        alert('Failed to send follow request');
    }
}

function listenForFollowRequests() {
    const requestsRef = database.ref(`followRequests/${currentUser.uid}`);
    const callback = (snapshot) => displayFollowRequests(snapshot.val() || {});
    requestsRef.on('value', callback);
    activeListeners.followRequests = { ref: requestsRef, event: 'value', callback };
}

function displayFollowRequests(requests) {
    const requestsContainer = document.getElementById('requests-content');
    const requestsArray = Object.values(requests);
    
    const badge = document.getElementById('requests-badge');
    badge.textContent = requestsArray.length;
    badge.classList.toggle('visible', requestsArray.length > 0);

    if (requestsArray.length === 0) {
        requestsContainer.innerHTML = `<div class="placeholder-text"><span class="emoji">👋</span>No follow requests</div>`;
        return;
    }

    requestsContainer.innerHTML = '';
    requestsArray.forEach(request => {
        const requestEl = document.createElement('div');
        requestEl.className = 'follow-request-card';
        requestEl.innerHTML = `
            <div class="list-item" style="border: none; padding: 0; background: transparent;">
                <div class="avatar">${request.fromUser.emoji}</div>
                <div class="item-content">
                    <div class="item-title">${request.fromUser.displayName}</div>
                    <div class="item-subtitle">@${request.fromUser.username} wants to follow you</div>
                </div>
            </div>
            <div class="action-buttons" style="margin-top: 16px;">
                <button class="btn btn-success btn-small accept-request-btn" data-uid="${request.from}">Accept</button>
                <button class="btn btn-secondary btn-small reject-request-btn" data-uid="${request.from}">Decline</button>
            </div>
        `;
        requestsContainer.appendChild(requestEl);
    });
}

async function acceptFollowRequest(requesterUid) {
    try {
        const updates = {};
        updates[`userRelations/${currentUser.uid}/followers/${requesterUid}`] = true;
        updates[`userRelations/${requesterUid}/following/${currentUser.uid}`] = true;
        updates[`users/${currentUser.uid}/followersCount`] = firebase.database.ServerValue.increment(1);
        updates[`users/${requesterUid}/followingCount`] = firebase.database.ServerValue.increment(1);
        updates[`followRequests/${currentUser.uid}/${requesterUid}`] = null;
        
        const chatId = generateChatId(currentUser.uid, requesterUid);
        updates[`userChats/${currentUser.uid}/${chatId}`] = true;
        updates[`userChats/${requesterUid}/${chatId}`] = true;
        updates[`chats/${chatId}/participants/${currentUser.uid}`] = true;
        updates[`chats/${chatId}/participants/${requesterUid}`] = true;

        await database.ref().update(updates);
    } catch (error) {
        console.error('Error accepting follow request:', error);
    }
}

async function rejectFollowRequest(requesterUid) {
    try {
        await database.ref(`followRequests/${currentUser.uid}/${requesterUid}`).remove();
    } catch (error) {
        console.error('Error rejecting follow request:', error);
    }
}

// === CHAT SYSTEM ===

function loadUserChats() {
    if (userChatsListener) userChatsListener.ref.off('value', userChatsListener.callback);
    const userChatsRef = database.ref(`userChats/${currentUser.uid}`);
    const callback = (snapshot) => displayUserChats(snapshot.val() || {});
    userChatsRef.on('value', callback);
    userChatsListener = { ref: userChatsRef, callback };
}

async function displayUserChats(userChats) {
    const chatsContainer = document.getElementById('home-content');
    const chatIds = Object.keys(userChats);
    
    if (chatIds.length === 0) {
        chatsContainer.innerHTML = `<div class="placeholder-text"><span class="emoji">💬</span>No chats yet</div>`;
        return;
    }

    try {
        const chatPromises = chatIds.map(async (chatId) => {
            const chatSnapshot = await database.ref(`chats/${chatId}`).once('value');
            const chatData = chatSnapshot.val();
            if (!chatData || !chatData.participants) return null;

            const partnerUid = Object.keys(chatData.participants).find(uid => uid !== currentUser.uid);
            if (!partnerUid) return null;
            
            const partnerSnapshot = await database.ref(`users/${partnerUid}`).once('value');
            return partnerSnapshot.exists() ? { chatId, chatData, partner: partnerSnapshot.val() } : null;
        });

        const chats = (await Promise.all(chatPromises)).filter(Boolean);
        chats.sort((a, b) => (b.chatData.lastMessage?.timestamp || 0) - (a.chatData.lastMessage?.timestamp || 0));

        chatsContainer.innerHTML = '';
        chats.forEach(({ chatId, chatData, partner }) => {
            const lastMessage = chatData.lastMessage;
            const chatEl = document.createElement('div');
            chatEl.className = 'list-item';
            chatEl.onclick = () => openChat(partner, chatId);
            chatEl.innerHTML = `
                <div class="avatar ${partner.isOnline ? 'online' : ''}">${partner.emoji}</div>
                <div class="item-content">
                    <div class="item-title">${partner.displayName}</div>
                    <div class="item-subtitle">${lastMessage ? (lastMessage.senderId === currentUser.uid ? 'You: ' : '') + lastMessage.text : '...'}</div>
                </div>
                <div class="item-meta"><div class="timestamp">${formatTimestamp(lastMessage?.timestamp)}</div></div>
            `;
            chatsContainer.appendChild(chatEl);
        });
    } catch (error) {
        console.error('Error displaying chats:', error);
        chatsContainer.innerHTML = `<div class="placeholder-text"><span class="emoji">❌</span>Error loading chats</div>`;
    }
}

function openChat(partner, chatId) {
    currentChatPartner = partner;
    currentChatId = chatId;
    
    document.getElementById('chat-partner-name').textContent = partner.displayName;
    document.getElementById('chat-partner-avatar').textContent = partner.emoji;
    document.getElementById('chat-partner-avatar').className = `avatar ${partner.isOnline ? 'online' : ''}`;
    document.getElementById('chat-partner-status').innerHTML = `<div class="online-status"><div class="status-dot ${partner.isOnline ? '' : 'offline'}"></div><span>${partner.isOnline ? 'Online' : 'Offline'}</span></div>`;
    
    listenForMessages(chatId);
    listenForTyping(chatId);
    showView('chat-view');
}

function listenForMessages(chatId) {
    if (chatListeners[chatId]) chatListeners[chatId].ref.off('value', chatListeners[chatId].callback);
    
    const messagesRef = database.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
    const callback = (snapshot) => displayMessages(snapshot.val() || {});
    messagesRef.on('value', callback);
    chatListeners[chatId] = { ref: messagesRef, callback };
}

function displayMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = Object.values(messages).map(message => {
        const isSent = message.senderId === currentUser.uid;
        return `
            <div class="message-bubble ${isSent ? 'sent' : 'received'}">
                <div>${message.text}</div>
                <div class="message-timestamp">${formatTimestamp(message.timestamp)}</div>
            </div>
        `;
    }).join('');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    input.value = '';
    updateSendButtonState();
    autoResizeTextarea(input);

    try {
        const messageData = {
            text,
            senderId: currentUser.uid,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        const updates = {};
        const messageRef = database.ref(`chats/${currentChatId}/messages`).push();
        updates[`chats/${currentChatId}/messages/${messageRef.key}`] = messageData;
        updates[`chats/${currentChatId}/lastMessage`] = { text, senderId: currentUser.uid, timestamp: firebase.database.ServerValue.TIMESTAMP };
        
        await database.ref().update(updates);
        clearTypingIndicator();
    } catch (error) {
        console.error('Error sending message:', error);
        input.value = text;
        updateSendButtonState();
    }
}

// === TYPING INDICATORS ===

function handleTyping() {
    if (!currentChatId) return;
    
    const now = Date.now();
    if (now - lastTypingTime > 2000) { // Send typing indicator every 2s
        lastTypingTime = now;
        database.ref(`typing/${currentChatId}/${currentUser.uid}`).set(true);
    }
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(clearTypingIndicator, 3000);
}

function clearTypingIndicator() {
    if (currentChatId) {
        database.ref(`typing/${currentChatId}/${currentUser.uid}`).remove();
    }
}

function listenForTyping(chatId) {
    const typingRef = database.ref(`typing/${chatId}`);
    const callback = (snapshot) => {
        const typingData = snapshot.val() || {};
        delete typingData[currentUser.uid];
        const isPartnerTyping = Object.keys(typingData).length > 0;
        
        document.getElementById('typing-indicator').classList.toggle('visible', isPartnerTyping);
        if (isPartnerTyping) {
            document.getElementById('typing-user').textContent = currentChatPartner.displayName;
        }
    };
    typingRef.on('value', callback);
    if(activeListeners.typing) activeListeners.typing.ref.off(activeListeners.typing.event, activeListeners.typing.callback);
    activeListeners.typing = { ref: typingRef, event: 'value', callback };
}

function updateSendButtonState() {
    const input = document.getElementById('chat-input');
    document.getElementById('chat-send-btn').disabled = !input.value.trim();
}

// === WEBRTC CALLING SYSTEM ===

async function initializeCall(targetUid, isVideo) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return alert('Your browser does not support calling features.');
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        if (isVideo) document.getElementById('local-video').srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            const remoteMediaElement = document.getElementById(isVideo ? 'remote-video' : 'remote-audio');
            remoteMediaElement.srcObject = remoteStream;
            remoteMediaElement.play().catch(e => console.error("Autoplay failed:", e));
        };

        const callId = database.ref('calls').push().key;
        currentCallPartnerId = targetUid;
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                database.ref(`calls/${callId}/iceCandidates/${currentUser.uid}`).push(event.candidate.toJSON());
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        const callData = {
            callId,
            callerId: currentUser.uid,
            receiverId: targetUid,
            callerInfo: { displayName: currentUserProfile.displayName, emoji: currentUserProfile.emoji },
            offer,
            isVideo,
            status: 'calling'
        };
        
        await database.ref(`users/${targetUid}/incomingCall`).set(callData);
        listenForCallUpdates(callId, targetUid);

        if (isVideo) {
            document.querySelector('#video-call-info .name').textContent = currentChatPartner.displayName;
            showView('video-call-view');
        } else {
            document.querySelector('#voice-call-info .avatar').textContent = currentChatPartner.emoji;
            document.querySelector('#voice-call-info .name').textContent = currentChatPartner.displayName;
            showView('voice-call-view');
        }

    } catch (error) {
        console.error('Error initializing call:', error);
        cleanupCall();
    }
}

function listenForCallUpdates(callId, partnerId) {
    const callRef = database.ref(`calls/${callId}`);
    const callback = async (snapshot) => {
        const callData = snapshot.val();
        if (!callData) return;

        if (callData.answer && !peerConnection.currentRemoteDescription) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.answer));
        }
        
        if (callData.status === 'ended' || callData.status === 'rejected') {
            console.log(`Call ${callData.status}`);
            cleanupCall();
        }
    };
    callRef.on('value', callback);
    activeListeners.callUpdates = { ref: callRef, event: 'value', callback };
    
    const iceCandidatesRef = database.ref(`calls/${callId}/iceCandidates/${partnerId}`);
    const iceCallback = (snapshot) => {
        if(snapshot.exists()) {
             peerConnection.addIceCandidate(new RTCIceCandidate(snapshot.val()));
        }
    };
    iceCandidatesRef.on('child_added', iceCallback);
    activeListeners.iceCandidates = { ref: iceCandidatesRef, event: 'child_added', callback: iceCallback };
}

function listenForIncomingCalls() {
    const incomingCallRef = database.ref(`users/${currentUser.uid}/incomingCall`);
    const callback = (snapshot) => {
        const callData = snapshot.val();
        if (callData && callData.status === 'calling') {
            handleIncomingCall(callData);
        } else {
            closeModal('incoming-call-modal');
        }
    };
    incomingCallRef.on('value', callback);
    activeListeners.incomingCalls = { ref: incomingCallRef, event: 'value', callback };
}

function handleIncomingCall(callData) {
    incomingCallData = callData;
    document.getElementById('incoming-caller-avatar').textContent = callData.callerInfo.emoji;
    document.getElementById('incoming-caller-name').textContent = callData.callerInfo.displayName;
    document.getElementById('incoming-call-type').textContent = `Incoming ${callData.isVideo ? 'video' : 'voice'} call`;
    
    document.getElementById('ringtone').play().catch(e => console.log("Ringtone play failed", e));
    showModal('incoming-call-modal');
}

async function acceptIncomingCall() {
    if (!incomingCallData) return;
    
    closeModal('incoming-call-modal');
    document.getElementById('ringtone').pause();
    
    const { callId, callerId, offer, isVideo } = incomingCallData;
    currentCallPartnerId = callerId;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        if (isVideo) document.getElementById('local-video').srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            const remoteMediaElement = document.getElementById(isVideo ? 'remote-video' : 'remote-audio');
            remoteMediaElement.srcObject = remoteStream;
            remoteMediaElement.play().catch(e => console.error("Autoplay failed:", e));
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                database.ref(`calls/${callId}/iceCandidates/${currentUser.uid}`).push(event.candidate.toJSON());
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        await database.ref(`calls/${callId}`).update({ status: 'active', answer });
        await database.ref(`users/${currentUser.uid}/incomingCall`).remove();
        
        listenForCallUpdates(callId, callerId);
        
        if (isVideo) showView('video-call-view');
        else showView('voice-call-view');
    } catch (error) {
        console.error('Error accepting call:', error);
        await rejectIncomingCall();
    }
}

async function rejectIncomingCall() {
    if (!incomingCallData) return;
    
    const { callId, callerId } = incomingCallData;
    
    await database.ref(`calls/${callId}`).update({ status: 'rejected' });
    await database.ref(`users/${currentUser.uid}/incomingCall`).remove();
    
    closeModal('incoming-call-modal');
    document.getElementById('ringtone').pause();
    incomingCallData = null;
}

async function endCall() {
    if (incomingCallData) {
        await rejectIncomingCall();
        return;
    }
    
    const callId = activeListeners.callUpdates?.ref.key;
    if(callId) {
        await database.ref(`calls/${callId}`).update({ status: 'ended' });
    }
    cleanupCall();
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (activeListeners.callUpdates) activeListeners.callUpdates.ref.off('value', activeListeners.callUpdates.callback);
    if (activeListeners.iceCandidates) activeListeners.iceCandidates.ref.off('child_added', activeListeners.iceCandidates.callback);
    
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('remote-audio').srcObject = null;
    document.getElementById('ringtone').pause();
    
    currentCallPartnerId = null;
    incomingCallData = null;
    
    if(document.querySelector('.call-view.active')) {
        showView('main-view');
    }
}

// === DUMMY CALL HISTORY (for UI) ===
function loadCallHistory() {
    document.getElementById('calls-content').innerHTML = `<div class="placeholder-text"><span class="emoji">📞</span>No call history</div>`;
}

// === PROFILE MANAGEMENT ===
function showOwnProfile() {
    document.getElementById('own-profile-avatar').textContent = currentUserProfile.emoji;
    document.getElementById('own-profile-display-name').textContent = currentUserProfile.displayName;
    document.getElementById('own-profile-username').textContent = `@${currentUserProfile.username}`;
    document.getElementById('followers-count').textContent = currentUserProfile.followersCount || 0;
    document.getElementById('following-count').textContent = currentUserProfile.followingCount || 0;
    showModal('own-profile-modal');
}

// === EVENT LISTENERS ===
function setupEventListeners() {
    document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('profile-setup-form').addEventListener('submit', setupProfile);
    document.getElementById('username-input').addEventListener('input', handleUsernameInput);
    document.getElementById('profile-pic-input').addEventListener('change', handleProfilePicUpload);
    document.querySelector('.profile-pic-upload').addEventListener('click', () => document.getElementById('profile-pic-input').click());
    
    document.getElementById('nav-home').addEventListener('click', () => showPanel('home-content'));
    document.getElementById('nav-requests').addEventListener('click', () => showPanel('requests-content'));
    document.getElementById('nav-calls').addEventListener('click', () => showPanel('calls-content'));
    
    document.getElementById('search-users-btn').addEventListener('click', () => showView('search-view'));
    document.getElementById('menu-btn').addEventListener('click', showOwnProfile);
    document.getElementById('search-back-btn').addEventListener('click', () => showView('main-view'));
    document.getElementById('user-search-input').addEventListener('input', handleUserSearch);
    
    document.getElementById('search-results').addEventListener('click', (e) => {
        if (e.target.classList.contains('follow-btn')) sendFollowRequest(e.target.dataset.uid);
    });
    
    document.getElementById('requests-content').addEventListener('click', (e) => {
        const uid = e.target.dataset.uid;
        if (e.target.classList.contains('accept-request-btn')) acceptFollowRequest(uid);
        if (e.target.classList.contains('reject-request-btn')) rejectFollowRequest(uid);
    });
    
    document.getElementById('chat-back-btn').addEventListener('click', () => {
        clearTypingIndicator();
        showView('main-view');
    });
    
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('input', () => {
        updateSendButtonState();
        handleTyping();
        autoResizeTextarea(chatInput);
    });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
    
    document.getElementById('voice-call-btn').addEventListener('click', () => initializeCall(currentChatPartner.uid, false));
    document.getElementById('video-call-btn').addEventListener('click', () => initializeCall(currentChatPartner.uid, true));
    
    document.getElementById('accept-call-btn').addEventListener('click', acceptIncomingCall);
    document.getElementById('reject-call-btn').addEventListener('click', rejectIncomingCall);
    document.getElementById('end-voice-call-btn').addEventListener('click', endCall);
    document.getElementById('end-video-call-btn').addEventListener('click', endCall);
    
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });
    
    makeElementDraggable(document.getElementById('local-video'));
}

// === DRAGGABLE LOCAL VIDEO ===
function makeElementDraggable(element) {
    let isDragging = false, startX, startY, initialX, initialY;
    const container = document.getElementById('app-container');

    function handleStart(e) {
        isDragging = true;
        const touch = e.type === 'touchstart' ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        initialX = element.offsetLeft;
        initialY = element.offsetTop;
        element.style.transition = 'none';
    }
    
    function handleMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.type === 'touchmove' ? e.touches[0] : e;
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        let newX = initialX + deltaX;
        let newY = initialY + deltaY;

        // Constrain to container bounds
        newX = Math.max(0, Math.min(container.offsetWidth - element.offsetWidth, newX));
        newY = Math.max(0, Math.min(container.offsetHeight - element.offsetHeight, newY));

        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    }
    
    function handleEnd() {
        isDragging = false;
        element.style.transition = '';
    }
    
    element.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    element.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
}

// === APP STARTUP ===
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    setupEventListeners();
});
