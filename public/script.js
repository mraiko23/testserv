// Socket.IO connection
const socket = io();

// DOM elements
const lastUpdateEl = document.getElementById('lastUpdate');
const seedsItemsEl = document.getElementById('seedsItems');
const gearItemsEl = document.getElementById('gearItems');
const eggsItemsEl = document.getElementById('eggsItems');
const weatherContentEl = document.getElementById('weatherContent');
const weatherStatusEl = document.getElementById('weatherStatus');
const notificationToggleEl = document.getElementById('notificationToggle');
const itemInputEl = document.getElementById('itemInput');
const addItemBtnEl = document.getElementById('addItemBtn');
const trackedItemsEl = document.getElementById('trackedItems');
const notificationToastEl = document.getElementById('notificationToast');
const toastMessageEl = document.getElementById('toastMessage');



// State
let currentStockData = {
    seeds: [],
    gear: [],
    eggs: []
};

let currentWeatherData = {};
let trackedItems = [];
let notificationsEnabled = true;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

function initializeApp() {
    // Load tracked items from localStorage
    const savedItems = localStorage.getItem('trackedItems');
    if (savedItems) {
        trackedItems = JSON.parse(savedItems);
        updateTrackedItemsDisplay();
    }

    // Load notification settings
    const savedNotifications = localStorage.getItem('notificationsEnabled');
    if (savedNotifications !== null) {
        notificationsEnabled = savedNotifications === 'true';
        notificationToggleEl.checked = notificationsEnabled;
    }

    // Check notification permission status
    if ('Notification' in window) {
        if (Notification.permission === 'denied') {
            notificationsEnabled = false;
            notificationToggleEl.checked = false;
            localStorage.setItem('notificationsEnabled', 'false');
            showNotification('Notification permission denied. Please enable notifications in browser settings.');
        } else if (Notification.permission === 'default' && notificationsEnabled) {
            // Request permission if notifications were previously enabled
            Notification.requestPermission().then(permission => {
                if (permission !== 'granted') {
                    notificationsEnabled = false;
                    notificationToggleEl.checked = false;
                    localStorage.setItem('notificationsEnabled', 'false');
                    showNotification('Notification permission denied. Notifications disabled.');
                }
            });
        }
    }
}

function setupEventListeners() {
    // Notification toggle
    notificationToggleEl.addEventListener('change', async (e) => {
        notificationsEnabled = e.target.checked;
        localStorage.setItem('notificationsEnabled', notificationsEnabled.toString());
        socket.emit('toggleNotifications', notificationsEnabled);
        
        // Request notification permission when enabling
        if (notificationsEnabled && 'Notification' in window) {
            if (Notification.permission === 'default') {
                try {
                    const permission = await Notification.requestPermission();
                    if (permission !== 'granted') {
                        notificationsEnabled = false;
                        notificationToggleEl.checked = false;
                        localStorage.setItem('notificationsEnabled', 'false');
                        socket.emit('toggleNotifications', false);
                        showNotification('Notification permission denied. Notifications disabled.');
                    } else {
                        showNotification('Notifications enabled successfully!');
                    }
                } catch (error) {
                    console.error('Error requesting notification permission:', error);
                    notificationsEnabled = false;
                    notificationToggleEl.checked = false;
                    localStorage.setItem('notificationsEnabled', 'false');
                    socket.emit('toggleNotifications', false);
                }
            } else if (Notification.permission === 'denied') {
                notificationsEnabled = false;
                notificationToggleEl.checked = false;
                localStorage.setItem('notificationsEnabled', 'false');
                socket.emit('toggleNotifications', false);
                showNotification('Notification permission denied. Please enable notifications in browser settings.');
            } else if (Notification.permission === 'granted') {
                showNotification('Notifications enabled successfully!');
            }
        } else if (!notificationsEnabled) {
            showNotification('Notifications disabled.');
        }
    });

    // Add item form
    addItemBtnEl.addEventListener('click', addTrackedItem);
    itemInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTrackedItem();
        }
    });
}

function addTrackedItem() {
    const itemName = itemInputEl.value.trim();
    if (itemName && !trackedItems.includes(itemName)) {
        trackedItems.push(itemName);
        localStorage.setItem('trackedItems', JSON.stringify(trackedItems));
        updateTrackedItemsDisplay();
        socket.emit('addNotificationItem', itemName);
        itemInputEl.value = '';
    }
}

function removeTrackedItem(itemName) {
    trackedItems = trackedItems.filter(item => item !== itemName);
    localStorage.setItem('trackedItems', JSON.stringify(trackedItems));
    updateTrackedItemsDisplay();
    socket.emit('removeNotificationItem', itemName);
}

function updateTrackedItemsDisplay() {
    if (trackedItems.length === 0) {
        trackedItemsEl.innerHTML = '<div class="no-items">No items being tracked</div>';
        return;
    }

    trackedItemsEl.innerHTML = trackedItems.map(item => `
        <div class="tracked-item">
            <i class="fas fa-bell"></i>
            <span>${item}</span>
            <button class="btn btn-danger" onclick="removeTrackedItem('${item}')">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Stock display functions
function updateStockDisplay(stockType, items) {
    const element = document.getElementById(`${stockType}Items`);
    
    if (!items || items.length === 0) {
        element.innerHTML = '<div class="no-items">No items in stock</div>';
        return;
    }

    element.innerHTML = items.map(item => {
        const rarity = getItemRarity(item.name || item);
        const itemName = item.name || item;
        const quantity = item.quantity || 1;
        return `<div class="stock-item ${rarity}">
            <i class="fas fa-${getItemIcon(stockType)}"></i>
            <span data-full-name="${itemName}">${itemName}</span>
            <span class="quantity">x${quantity}</span>
        </div>`;
    }).join('');
}

function getItemRarity(item) {
    const itemLower = item.toLowerCase();
    
    if (itemLower.includes('legendary') || itemLower.includes('divine')) {
        return 'legendary';
    } else if (itemLower.includes('epic') || itemLower.includes('mythical')) {
        return 'epic';
    } else if (itemLower.includes('rare')) {
        return 'rare';
    }
    
    return '';
}

function getItemIcon(stockType) {
    const icons = {
        seeds: 'seedling',
        gear: 'cogs',
        eggs: 'egg',
        cosmetics: 'palette',
        events: 'calendar-alt'
    };
    return icons[stockType] || 'tag';
}

// Weather display functions
function updateWeatherDisplay(weatherData) {
    if (!weatherData || Object.keys(weatherData).length === 0) {
        weatherContentEl.innerHTML = '<div class="loading">Loading weather data...</div>';
        weatherStatusEl.textContent = 'Loading...';
        return;
    }

    const weatherItems = [];
    
    // Display weather icon and description
    if (weatherData.icon) {
        weatherItems.push(`<div class="weather-item">
            <span class="weather-icon">${weatherData.icon}</span>
            <span>${weatherData.description || weatherData.currentWeather}</span>
        </div>`);
    }
    
    // Display current weather
    if (weatherData.currentWeather) {
        weatherItems.push(`<div class="weather-item">
            <i class="fas fa-cloud-sun"></i>
            <span>Current: ${weatherData.currentWeather}</span>
        </div>`);
    }
    
    // Display end time if available
    if (weatherData.endTime) {
        const endTime = new Date(weatherData.endTime);
        const timeString = endTime.toLocaleTimeString();
        weatherItems.push(`<div class="weather-item">
            <i class="fas fa-clock"></i>
            <span>Ends: ${timeString}</span>
        </div>`);
    }
    
    // Display last update time
    if (weatherData.updatedAt) {
        const updateTime = new Date(weatherData.updatedAt);
        const timeString = updateTime.toLocaleTimeString();
        weatherItems.push(`<div class="weather-item">
            <i class="fas fa-sync-alt"></i>
            <span>Updated: ${timeString}</span>
        </div>`);
    }

    weatherContentEl.innerHTML = weatherItems.join('');
    weatherStatusEl.textContent = weatherData.currentWeather || weatherData.description || 'Unknown';
}



// Notification functions
function showNotification(message) {
    // Always show toast notification
    toastMessageEl.textContent = message;
    notificationToastEl.classList.add('show');
    
    setTimeout(() => {
        notificationToastEl.classList.remove('show');
    }, 5000);

    // Show browser notification only if enabled and permission granted
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('Grow A Garden Stock', {
                body: message,
                icon: '/favicon.ico'
            });
        } catch (error) {
            console.error('Error showing browser notification:', error);
        }
    }
}

// Socket.IO event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    document.querySelector('.status-dot').classList.add('online');
    document.querySelector('.status-text').textContent = 'Live';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    document.querySelector('.status-dot').classList.remove('online');
    document.querySelector('.status-text').textContent = 'Offline';
});

socket.on('stockUpdate', (data) => {
    currentStockData = data;
    
    // Update displays
    updateStockDisplay('seeds', data.seeds);
    updateStockDisplay('gear', data.gear);
    updateStockDisplay('eggs', data.eggs);
    
    // Update last update time
    lastUpdateEl.textContent = new Date().toLocaleTimeString();
});

socket.on('weatherUpdate', (data) => {
    currentWeatherData = data;
    updateWeatherDisplay(data);
});

socket.on('itemNotification', (data) => {
    showNotification(data.message);
});

// Error handling
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    document.querySelector('.status-dot').classList.remove('online');
    document.querySelector('.status-text').textContent = 'Error';
});

// Auto-refresh fallback (in case Discord bot is not working)
setInterval(() => {
    fetch('/api/stock')
        .then(response => response.json())
        .then(data => {
            if (data && Object.keys(data).length > 0) {
                socket.emit('stockUpdate', data);
            }
        })
        .catch(error => console.error('Error fetching stock data:', error));
}, 30000); // Every 30 seconds

// Weather auto-refresh
setInterval(() => {
    fetch('/api/weather')
        .then(response => response.json())
        .then(data => {
            if (data && Object.keys(data).length > 0) {
                socket.emit('weatherUpdate', data);
            }
        })
        .catch(error => console.error('Error fetching weather data:', error));
}, 30000); // Every 30 seconds

// Setup notifications on page load
socket.emit('setupNotifications', {
    items: trackedItems,
    enabled: notificationsEnabled
}); 