const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const { getAllStockData } = require('./stock-parsers');

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration for public access
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});

// Middleware for CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Serve static files
app.use(express.static('public'));

// Store stock and weather data
let stockData = {
  seeds: [],
  gear: [],
  eggs: []
};

let weatherData = {
  icon: '',
  description: '',
  currentWeather: '',
  endTime: null,
  updatedAt: null
};

let lastWeatherData = null;
let userNotifications = new Map(); // userId -> {items: [], enabled: true}
let isUpdating = false; // Flag to prevent concurrent updates
let isWeatherUpdating = false; // Flag to prevent concurrent weather updates
let lastStockUpdateTime = 0; // Track last stock update time
let lastWeatherUpdateTime = 0; // Track last weather update time

// Function to check user notifications
function checkUserNotifications(stocks) {
  userNotifications.forEach((userData, userId) => {
    if (!userData.enabled) return;

    userData.items.forEach(item => {
      const allItems = [...stocks.seeds, ...stocks.gear, ...stocks.eggs];
      if (allItems.some(stockItem => 
        stockItem.name && stockItem.name.toLowerCase().includes(item.toLowerCase())
      )) {
        // Send notification to user
        io.to(userId).emit('itemNotification', {
          item: item,
          message: `${item} is now in stock!`
        });
      }
    });
  });
}

// Function to fetch stock data
async function fetchStockData() {
  // Prevent concurrent updates
  if (isUpdating) {
    console.log('Update already in progress, skipping...');
    return;
  }
  
  isUpdating = true;
  lastStockUpdateTime = Date.now();
  
  try {
    const startTime = new Date();
    console.log(`[${startTime.toLocaleTimeString()}] Fetching stock data...`);
    const newStockData = await getAllStockData();
    
    if (newStockData) {
      // Always update data
      stockData = newStockData;
      // Send update to all connected clients via Socket.IO
      io.emit('stockUpdate', stockData);
      const endTime = new Date();
      console.log(`[${endTime.toLocaleTimeString()}] Updated stock data from API (took ${endTime.getTime() - startTime.getTime()}ms)`);
      console.log(`[${endTime.toLocaleTimeString()}] Stock counts - Seeds: ${stockData.seeds.length}, Gear: ${stockData.gear.length}, Eggs: ${stockData.eggs.length}`);
      
      // Check notifications after stock update (non-blocking)
      setImmediate(() => checkUserNotifications(stockData));
    } else {
      console.log(`[${startTime.toLocaleTimeString()}] No stock data received from API`);
    }
  } catch (error) {
    const errorTime = new Date();
    console.error(`[${errorTime.toLocaleTimeString()}] Error fetching stock data:`, error.message);
  } finally {
    isUpdating = false;
  }
}

// Function to fetch weather data (non-blocking)
async function fetchWeatherData() {
  // Prevent concurrent weather updates
  if (isWeatherUpdating) {
    console.log('Weather update already in progress, skipping...');
    return;
  }
  
  // Prevent too frequent updates (minimum 10 seconds between updates)
  const now = Date.now();
  if (now - lastWeatherUpdateTime < 10000) {
    return;
  }
  
  isWeatherUpdating = true;
  lastWeatherUpdateTime = now;
  
  try {
    console.log('Fetching weather data...');
    const response = await axios.get('https://growagardenstock.com/api/stock/weather', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 5000 // Reduced timeout for faster response
    });

    const data = response.data;
    
    // Check if weather data has changed
    const weatherChanged = !lastWeatherData || 
      JSON.stringify(data) !== JSON.stringify(lastWeatherData);
    
    if (weatherChanged) {
      weatherData = {
        icon: data.icon || '🌤️',
        description: data.description || data.effectDescription || 'Unknown weather',
        currentWeather: data.currentWeather || data.weatherType || 'Unknown',
        endTime: data.endTime,
        updatedAt: data.updatedAt || Date.now()
      };
      
      lastWeatherData = JSON.parse(JSON.stringify(data));
      io.emit('weatherUpdate', weatherData);
      console.log('Weather updated:', weatherData.currentWeather);
    }
  } catch (error) {
    console.error('Error fetching weather data:', error.message);
  } finally {
    isWeatherUpdating = false;
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Send current data to new user (non-blocking)
  setImmediate(() => {
    socket.emit('stockUpdate', stockData);
    socket.emit('weatherUpdate', weatherData);
  });
  
  // Handle user notification setup
  socket.on('setupNotifications', (data) => {
    const userId = socket.id;
    userNotifications.set(userId, {
      items: data.items || [],
      enabled: data.enabled !== false
    });
  });

  // Handle notification toggle
  socket.on('toggleNotifications', (enabled) => {
    const userId = socket.id;
    const userData = userNotifications.get(userId);
    if (userData) {
      userData.enabled = enabled;
      userNotifications.set(userId, userData);
    }
  });

  // Handle add notification item
  socket.on('addNotificationItem', (item) => {
    const userId = socket.id;
    const userData = userNotifications.get(userId) || { items: [], enabled: true };
    if (!userData.items.includes(item)) {
      userData.items.push(item);
      userNotifications.set(userId, userData);
    }
  });

  // Handle remove notification item
  socket.on('removeNotificationItem', (item) => {
    const userId = socket.id;
    const userData = userNotifications.get(userId);
    if (userData) {
      userData.items = userData.items.filter(i => i !== item);
      userNotifications.set(userId, userData);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    userNotifications.delete(socket.id);
  });
});

// API routes
app.get('/api/stock', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: stockData
  });
});

app.get('/api/weather', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: weatherData
  });
});

// API endpoints for easy parsing
app.get('/api/v1/stock', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: stockData
  });
});

app.get('/api/v1/stock/seeds', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: stockData.seeds
  });
});

app.get('/api/v1/stock/gear', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: stockData.gear
  });
});

app.get('/api/v1/stock/eggs', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: stockData.eggs
  });
});

app.get('/api/v1/weather', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    data: weatherData
  });
});

// Raw data endpoints (without wrapper)
app.get('/api/raw/stock', (req, res) => {
  res.json(stockData);
});

app.get('/api/raw/weather', (req, res) => {
  res.json(weatherData);
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: Date.now(),
    uptime: process.uptime(),
    connections: io.engine.clientsCount,
    lastUpdate: {
      stock: stockData.seeds.length + stockData.gear.length + stockData.eggs.length > 0 ? 'recent' : 'none',
      weather: weatherData.currentWeather ? 'recent' : 'none'
    }
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working!',
    timestamp: Date.now(),
    endpoints: [
      '/api/v1/stock',
      '/api/v1/stock/seeds', 
      '/api/v1/stock/gear',
      '/api/v1/stock/eggs',
      '/api/v1/weather',
      '/api/raw/stock',
      '/api/raw/weather',
      '/api/status'
    ]
  });
});

// Initial data fetch
// REMOVED: Immediate stock fetch. Only cron will trigger stock updates.
fetchWeatherData();

// Schedule stock updates using cron (every 5 minutes at :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55, :00)
// This is more reliable than setTimeout for long-running processes
cron.schedule('0,5,10,15,20,25,30,35,40,45,50,55 * * * *', () => {
  const now = new Date();
  console.log(`[${now.toLocaleTimeString()}] Cron triggered stock update...`);
  // Add 30-second delay before fetching stock data (run at XX:05:30, XX:10:30, etc)
  setTimeout(() => {
    fetchStockData();
  }, 30000);
}, {
  scheduled: true,
  timezone: "UTC" // Use UTC to avoid timezone issues
});

// Weather updates every 10 seconds for instant detection
setInterval(fetchWeatherData, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
  console.log(`Public access: http://YOUR_IP:${PORT}`);
  console.log(`To make it public, use: ngrok http ${PORT}`);
  console.log('Stock updates scheduled every 5 minutes using cron');
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Gracefully shutting down...');
  server.close(() => {
    console.log('Server closed. Exiting...');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Gracefully shutting down...');
  server.close(() => {
    console.log('Server closed. Exiting...');
    process.exit(0);
  });
});

// Export functions for testing
module.exports = {
  fetchStockData,
  fetchWeatherData
}; 