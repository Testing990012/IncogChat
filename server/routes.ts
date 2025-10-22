import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { nanoid } from "nanoid";
import { 
  WsMessage, 
  WsMessageType, 
  InsertUser, 
  InsertRoom,
  InsertMessage,
  MessageType,
  rooms,
  insertRoomSchema,
  insertUserSchema,
  insertMessageSchema
} from "@shared/schema";
import { add, formatDistanceToNow } from "date-fns";
import { z } from "zod";
import { upload, uploadToCloudinary, getFileType } from "./fileService";

// Message Queue for HTTP-based fallback
interface MessageQueueItem {
  connectionId: string;
  message: WsMessage;
  timestamp: number;
}

// In-memory message queue with 5-minute TTL
const messageQueue: MessageQueueItem[] = [];
const MESSAGE_TTL = 5 * 60 * 1000; // 5 minutes

// Map for websocket connections and their IDs
const connectionMap = new Map<WebSocket, string>();

// Forward declarations for functions used throughout the file
// Handle user leaving via HTTP
async function handleLeaveViaHttp(connectionId: string): Promise<void> {
  try {
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) return;
    
    await storage.updateUserConnection(connectionId, false);
    
    // Add leave message to other users' queues
    const users = await storage.getUsersByRoom(user.roomId);
    for (const otherUser of users) {
      if (otherUser.id !== user.id && otherUser.connected) {
        messageQueue.push({
          connectionId: otherUser.connectionId,
          message: {
            type: WsMessageType.LEAVE,
            payload: { username: user.username, userId: user.id }
          },
          timestamp: Date.now()
        });
      }
    }
  } catch (error) {
    console.error('Error handling leave via HTTP:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Setup WebSocket server optimized for Replit environment
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    // Keep these settings minimal for Replit environment
    perMessageDeflate: false,
    clientTracking: true,
    maxPayload: 512 * 1024 // Reduce to 512KB
  });
  
  console.log("WebSocket server initialized on path: /ws");
  
  // Handle WebSocket connections
  wss.on('connection', (ws, req) => {
    // Generate a unique connection ID
    const connectionId = nanoid();
    console.log(`New WebSocket connection from: ${req.socket.remoteAddress}, connectionId: ${connectionId}`);
    
    // Store connection in map
    connectionMap.set(ws, connectionId);
    
    // Add 15 second timeout to close connection if no JOIN message received
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`Closing inactive connection ${connectionId} - no JOIN received`);
        sendError(ws, 'Connection timeout - no authentication received');
        ws.close(1000, 'Connection timeout');
      }
    }, 15000);
    
    // Handle incoming messages
    ws.on('message', async (message) => {
      try {
        const messageStr = message.toString();
        console.log(`Received WebSocket message on ${connectionId}:`, messageStr.substring(0, 100) + (messageStr.length > 100 ? '...' : ''));
        
        const parsedMessage = JSON.parse(messageStr) as WsMessage;
        
        // Clear timeout if we receive a JOIN message
        if (parsedMessage.type === WsMessageType.JOIN) {
          clearTimeout(connectionTimeout);
        }
        
        await handleWsMessage(ws, connectionId, parsedMessage);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        sendError(ws, 'Invalid message format');
      }
    });
    
    // Handle connection closed
    ws.on('close', async (code, reason) => {
      console.log(`WebSocket connection ${connectionId} closed: code=${code}, reason=${reason || 'No reason provided'}`);
      clearTimeout(connectionTimeout);
      
      try {
        await handleDisconnect(ws, connectionId);
      } catch (error) {
        console.error(`Error handling disconnect for ${connectionId}:`, error);
      } finally {
        connectionMap.delete(ws);
      }
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error on ${connectionId}:`, error);
      connectionMap.delete(ws);
    });
    
    // Send a ping to keep the connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch (error) {
          console.error(`Error sending ping to ${connectionId}:`, error);
          clearInterval(pingInterval);
        }
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // Send ping every 30 seconds
    
    // Handle pong responses to track latency
    ws.on('pong', () => {
      // Could track latency here if needed
    });
    
    // Clean up ping interval on close
    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  });
  
  // Schedule periodic cleanup of expired rooms
  setInterval(async () => {
    await storage.cleanupExpiredRooms();
  }, 60000); // Check every minute
  
  // API Routes
  
  // Get active rooms
  app.get('/api/rooms/active', async (req, res) => {
    const username = req.query.username as string;
    
    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }
    
    try {
      const rooms = await storage.getActiveRoomsByUser(username);
      res.json({ rooms });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch active rooms' });
    }
  });
  
  // Create a new room (instant)
  app.post('/api/rooms/instant', async (req, res) => {
    const createRoomSchema = z.object({
      nickname: z.string().min(1, "Nickname is required"),
      roomName: z.string().optional(),
      enableHistory: z.boolean().optional(),
      enableNotifications: z.boolean().optional()
    });
    
    try {
      const { nickname, roomName } = createRoomSchema.parse(req.body);
      
      const roomId = generateRoomCode();
      const expiresAt = add(new Date(), { hours: 24 });
      
      const room: InsertRoom = {
        id: roomId,
        name: roomName || `${nickname}'s Room`,
        createdBy: nickname,
        expiresAt,
        isScheduled: false,
        active: true
      };
      
      const createdRoom = await storage.createRoom(room);
      
      res.status(201).json({ 
        room: createdRoom,
        joinLink: `/room/${roomId}`
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Validation failed', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to create room' });
    }
  });
  
  // Create a scheduled room
  app.post('/api/rooms/scheduled', async (req, res) => {
    const scheduleRoomSchema = z.object({
      nickname: z.string().min(1, "Nickname is required"),
      roomName: z.string().min(1, "Room name is required"),
      scheduledDate: z.string().refine(val => !isNaN(Date.parse(val)), {
        message: "Invalid date format"
      }),
      duration: z.number().min(30).max(1440)
    });
    
    try {
      const { nickname, roomName, scheduledDate, duration } = scheduleRoomSchema.parse(req.body);
      
      const scheduledFor = new Date(scheduledDate);
      const roomId = generateRoomCode();
      
      // Expires at the end of the scheduled duration
      const expiresAt = add(scheduledFor, { minutes: duration });
      
      const room: InsertRoom = {
        id: roomId,
        name: roomName,
        createdBy: nickname,
        expiresAt,
        isScheduled: true,
        scheduledFor,
        duration,
        active: true
      };
      
      const createdRoom = await storage.createRoom(room);
      
      res.status(201).json({ 
        room: createdRoom,
        joinLink: `/room/${roomId}`
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Validation failed', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to create scheduled room' });
    }
  });
  
  // Get room by ID
  app.get('/api/rooms/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
      const room = await storage.getRoomById(id);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      if (!room.active) {
        return res.status(410).json({ message: 'Room has expired or been closed' });
      }
      
      res.json({ room });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch room' });
    }
  });
  
  // Close a room
  app.post('/api/rooms/:id/close', async (req, res) => {
    const { id } = req.params;
    
    try {
      const room = await storage.getRoomById(id);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      await storage.updateRoomStatus(id, false);
      
      // Notify all users in the room that it's closed
      broadcastToRoom(id, {
        type: WsMessageType.ROOM_CLOSED,
        payload: { roomId: id }
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to close room' });
    }
  });

  // === File Upload Endpoint ===
  // Handle file uploads
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      
      const connectionId = req.body.connectionId || '';
      const roomId = req.body.roomId;
      
      console.log('File upload request with connectionId:', connectionId, 'roomId:', roomId);
      
      if (!roomId) {
        return res.status(400).json({ 
          message: 'Room ID is required' 
        });
      }
      
      // If connectionId is present, get user from connection ID
      const user = connectionId ? await storage.getUserByConnectionId(connectionId) : null;
      
      // If we couldn't find a user via connectionId, try finding the users in the room
      let roomUser;
      if (!user) {
        // Get all users in the room
        const roomUsers = await storage.getUsersByRoom(roomId);
        console.log('Using room users fallback. Found users:', roomUsers.length);
        
        // If we have users in the room, just use the first one for file upload
        if (roomUsers.length > 0) {
          roomUser = roomUsers[0];
        } else {
          return res.status(403).json({ message: 'No users found in this room' });
        }
      }
      
      // Use either the connection user or a room user
      const selectedUser = user || roomUser;
      
      if (!selectedUser) {
        return res.status(403).json({ message: 'Not joined to any room' });
      }
      
      // Check if room is active
      const room = await storage.getRoomById(roomId);
      
      if (!room || !room.active) {
        return res.status(410).json({ message: 'Room has expired or been closed' });
      }
      
      // Upload file to Cloudinary
      const uploadResult = await uploadToCloudinary(req.file);
      
      // Determine file type
      const fileType = getFileType(req.file.mimetype);
      
      // Create message
      const messageData: InsertMessage = {
        roomId: selectedUser.roomId,
        userId: selectedUser._id.toString(),  // Convert ObjectId to string
        username: selectedUser.username,
        content: fileType === 'image' ? 'Sent an image' : 'Sent a file: ' + req.file.originalname,
        messageType: fileType,
        fileUrl: uploadResult.url,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        timestamp: new Date()
      };
      
      console.log('Creating message with data:', messageData);
      
      const message = await storage.addMessage(messageData);
      
      // Broadcast to all users in the room
      const wsMessageType = fileType === 'image' 
        ? WsMessageType.IMAGE_MESSAGE 
        : (fileType === 'document' ? WsMessageType.DOCUMENT_MESSAGE : WsMessageType.FILE_MESSAGE);
      
      broadcastToRoom(selectedUser.roomId, {
        type: wsMessageType,
        payload: message
      });
      
      // Update user's last activity if we have a valid connectionId
      if (connectionId && connectionId.length > 0) {
        await storage.updateUserConnection(connectionId, true);
      }
      
      res.json({ 
        success: true, 
        message,
        fileUrl: uploadResult.url
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(500).json({ message: 'Failed to upload file' });
    }
  });

  // === HTTP Fallback Endpoints for WebSocket functionality ===
  // These endpoints are used when WebSockets are not reliable (like in Replit)
  
  // Get a connection ID - alternative to WebSocket connection
  app.post('/api/ws/connect', (req, res) => {
    const connectionId = nanoid();
    console.log(`New HTTP connection established, connectionId: ${connectionId}`);
    res.json({ connectionId });
  });
  
  // Join a room using HTTP
  app.post('/api/ws/join', async (req, res) => {
    try {
      const { connectionId, roomId, username } = req.body;
      
      if (!connectionId || !roomId || !username) {
        return res.status(400).json({ 
          message: 'Connection ID, Room ID and username are required' 
        });
      }
      
      // Check if room exists and is active
      const room = await storage.getRoomById(roomId);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      if (!room.active) {
        return res.status(410).json({ message: 'Room has expired or been closed' });
      }
      
      // If it's a scheduled room, check if it's time
      if (room.isScheduled && room.scheduledFor) {
        const now = new Date();
        if (now < room.scheduledFor) {
          return res.status(400).json({ 
            message: `This room is scheduled to start ${formatDistanceToNow(room.scheduledFor, { addSuffix: true })}` 
          });
        }
      }
      
      // Add user to room
      const userData: InsertUser = {
        username,
        roomId,
        connectionId,
        connected: true,
        lastActivity: new Date()
      };
      
      const user = await storage.addUserToRoom(userData);
      
      // Add join message to the queue for this connection
      const joinMessage: WsMessage = {
        type: WsMessageType.JOIN,
        payload: { success: true, roomId, username }
      };
      
      // Add to message queue for polling
      messageQueue.push({
        connectionId,
        message: joinMessage,
        timestamp: Date.now()
      });
      
      // Broadcast to others in the room that a new user joined
      const users = await storage.getUsersByRoom(roomId);
      for (const otherUser of users) {
        if (otherUser.id !== user.id && otherUser.connected) {
          messageQueue.push({
            connectionId: otherUser.connectionId,
            message: {
              type: WsMessageType.JOIN,
              payload: { roomId, username, userId: user.id }
            },
            timestamp: Date.now()
          });
        }
      }
      
      // Prepare data to return to the client
      const usersList = await storage.getUsersByRoom(roomId);
      const messages = await storage.getMessagesByRoom(roomId);
      
      res.json({ 
        success: true, 
        user,
        users: usersList,
        messages
      });
    } catch (error) {
      console.error('Error handling HTTP JOIN:', error);
      res.status(500).json({ message: 'Failed to join room' });
    }
  });
  
  // Send a message using HTTP
  app.post('/api/ws/send', async (req, res) => {
    try {
      const { connectionId, message } = req.body;
      
      if (!connectionId || !message) {
        return res.status(400).json({ message: 'Connection ID and message are required' });
      }
      
      // Handle the message based on its type
      if (message.type === WsMessageType.CHAT_MESSAGE) {
        const { content } = message.payload;
        
        if (!content) {
          return res.status(400).json({ message: 'Message content is required' });
        }
        
        // Get user from connection ID
        const user = await storage.getUserByConnectionId(connectionId);
        
        if (!user) {
          return res.status(403).json({ message: 'Not joined to any room' });
        }
        
        // Check if room is active
        const room = await storage.getRoomById(user.roomId);
        
        if (!room || !room.active) {
          return res.status(410).json({ message: 'Room has expired or been closed' });
        }
        
        // Add message
        const messageData: InsertMessage = {
          roomId: user.roomId,
          userId: user.id,
          username: user.username,
          content
        };
        
        const chatMessage = await storage.addMessage(messageData);
        
        // Add to all users' message queues in the room
        const users = await storage.getUsersByRoom(user.roomId);
        for (const roomUser of users) {
          if (roomUser.connected) {
            messageQueue.push({
              connectionId: roomUser.connectionId,
              message: {
                type: WsMessageType.CHAT_MESSAGE,
                payload: chatMessage
              },
              timestamp: Date.now()
            });
          }
        }
        
        // Update user's last activity
        await storage.updateUserConnection(connectionId, true);
        
        res.json({ success: true, message: chatMessage });
      } else if (message.type === WsMessageType.LEAVE) {
        await handleLeaveViaHttp(connectionId);
        res.json({ success: true });
      } else if (message.type === WsMessageType.JOIN) {
        // This should be handled by the /api/ws/join endpoint
        res.status(400).json({ message: 'Use /api/ws/join endpoint to join a room' });
      } else {
        res.status(400).json({ message: 'Unsupported message type' });
      }
    } catch (error) {
      console.error('Error handling HTTP message:', error);
      res.status(500).json({ message: 'Failed to process message' });
    }
  });
  
  // Poll for new messages - for clients that can't use WebSockets
  app.get('/api/ws/poll', async (req, res) => {
    try {
      const connectionId = req.query.connectionId as string;
      const since = parseInt(req.query.since as string || '0');
      
      if (!connectionId) {
        return res.status(400).json({ message: 'Connection ID is required' });
      }
      
      // Update user's last activity
      try {
        await storage.updateUserConnection(connectionId, true);
      } catch (error) {
        console.warn(`Failed to update user connection for ${connectionId}:`, error);
      }
      
      // Get messages for this connection
      const now = Date.now();
      const cutoff = now - MESSAGE_TTL;
      const messages = messageQueue
        .filter(item => item.connectionId === connectionId && item.timestamp > since)
        .map(item => item.message);
      
      // Clean up old messages while we're here
      const initialLength = messageQueue.length;
      if (initialLength > 100) { // Only clean up if queue is getting large
        const filteredQueue = messageQueue.filter(item => item.timestamp > cutoff);
        messageQueue.length = 0; // Clear the array
        messageQueue.push(...filteredQueue); // Add back the filtered items
        
        console.log(`Cleaned up message queue: ${initialLength} -> ${messageQueue.length}`);
      }
      
      res.json({ messages });
    } catch (error) {
      console.error('Error handling HTTP poll:', error);
      res.status(500).json({ message: 'Failed to poll for messages' });
    }
  });
  
  // Disconnect using HTTP
  app.post('/api/ws/disconnect', async (req, res) => {
    try {
      const { connectionId } = req.body;
      
      if (!connectionId) {
        return res.status(400).json({ message: 'Connection ID is required' });
      }
      
      await handleLeaveViaHttp(connectionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error handling HTTP disconnect:', error);
      res.status(500).json({ message: 'Failed to disconnect' });
    }
  });
  
  return httpServer;
}

// Helper function for room code generation
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omitting similar characters
  let code = '';
  
  // Generate a 4-letter prefix
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  code += '-';
  
  // Generate a 4-digit suffix
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
}

// WebSocket message handler
async function handleWsMessage(ws: WebSocket, connectionId: string, message: WsMessage): Promise<void> {
  switch (message.type) {
    case WsMessageType.JOIN:
      await handleJoinRoom(ws, connectionId, message.payload);
      break;
      
    case WsMessageType.CHAT_MESSAGE:
      await handleChatMessage(ws, connectionId, message.payload);
      break;
    
    case WsMessageType.FILE_MESSAGE:
      await handleFileMessage(ws, connectionId, message.payload);
      break;
      
    case WsMessageType.IMAGE_MESSAGE:
      await handleImageMessage(ws, connectionId, message.payload);
      break;
      
    case WsMessageType.DOCUMENT_MESSAGE:
      await handleDocumentMessage(ws, connectionId, message.payload);
      break;
    
    case WsMessageType.VIDEO_CALL_START:
    case WsMessageType.VIDEO_CALL_ANSWER:
    case WsMessageType.VIDEO_CALL_ICE:
    case WsMessageType.VIDEO_CALL_HANGUP:
      await handleVideoCallSignaling(ws, connectionId, message);
      break;
      
    case WsMessageType.LEAVE:
      await handleLeaveRoom(ws, connectionId);
      break;
      
    default:
      sendError(ws, 'Unknown message type');
  }
}

// Handle user joining a room
async function handleJoinRoom(ws: WebSocket, connectionId: string, payload: any): Promise<void> {
  try {
    const { roomId, username } = payload;
    
    if (!roomId || !username) {
      return sendError(ws, 'Room ID and username are required');
    }
    
    // Check if room exists and is active
    const room = await storage.getRoomById(roomId);
    
    if (!room) {
      return sendError(ws, 'Room not found');
    }
    
    if (!room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // If it's a scheduled room, check if it's time
    if (room.isScheduled && room.scheduledFor) {
      const now = new Date();
      if (now < room.scheduledFor) {
        return sendError(ws, `This room is scheduled to start ${formatDistanceToNow(room.scheduledFor, { addSuffix: true })}`);
      }
    }
    
    // Add user to room
    const userData: InsertUser = {
      username,
      roomId,
      connectionId,
      connected: true,
      lastActivity: new Date()
    };
    
    const user = await storage.addUserToRoom(userData);
    
    // Send confirmation to the user
    const wsMessage: WsMessage = {
      type: WsMessageType.JOIN,
      payload: { success: true, roomId, username }
    };
    
    send(ws, wsMessage);
    
    // Broadcast to others in the room that a new user joined
    broadcastToRoom(roomId, {
      type: WsMessageType.JOIN,
      payload: { roomId, username, userId: user.id }
    }, ws);
    
    // Send the user list to the newly joined user
    const users = await storage.getUsersByRoom(roomId);
    send(ws, {
      type: WsMessageType.USER_LIST,
      payload: { users }
    });
    
    // Send room messages to the user
    const messages = await storage.getMessagesByRoom(roomId);
    
    for (const message of messages) {
      send(ws, {
        type: WsMessageType.CHAT_MESSAGE,
        payload: message
      });
    }
  } catch (error) {
    console.error('Error handling JOIN message:', error);
    sendError(ws, 'Failed to join room');
  }
}

// Handle chat messages
async function handleChatMessage(ws: WebSocket, connectionId: string, payload: any): Promise<void> {
  try {
    const { content } = payload;
    
    if (!content) {
      return sendError(ws, 'Message content is required');
    }
    
    // Get user from connection ID
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) {
      return sendError(ws, 'Not joined to any room');
    }
    
    // Check if room is active
    const room = await storage.getRoomById(user.roomId);
    
    if (!room || !room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // Add message
    const messageData: InsertMessage = {
      roomId: user.roomId,
      userId: user.id,
      username: user.username,
      content
    };
    
    const message = await storage.addMessage(messageData);
    
    // Broadcast to all users in the room
    broadcastToRoom(user.roomId, {
      type: WsMessageType.CHAT_MESSAGE,
      payload: message
    });
    
    // Update user's last activity
    await storage.updateUserConnection(connectionId, true);
  } catch (error) {
    console.error('Error handling CHAT_MESSAGE:', error);
    sendError(ws, 'Failed to send message');
  }
}

// Handle user leaving a room
async function handleLeaveRoom(ws: WebSocket, connectionId: string): Promise<void> {
  try {
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) return;
    
    await storage.updateUserConnection(connectionId, false);
    
    // Broadcast to others that user left
    broadcastToRoom(user.roomId, {
      type: WsMessageType.LEAVE,
      payload: { username: user.username, userId: user.id }
    }, ws);
  } catch (error) {
    console.error('Error handling LEAVE:', error);
  }
}

// Handle WebSocket-based file messages (client already uploaded the file)
async function handleFileMessage(ws: WebSocket, connectionId: string, payload: any): Promise<void> {
  try {
    const { fileUrl, fileName, fileSize, mimeType } = payload;
    
    if (!fileUrl || !fileName) {
      return sendError(ws, 'File URL and file name are required');
    }
    
    // Get user from connection ID
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) {
      return sendError(ws, 'Not joined to any room');
    }
    
    // Check if room is active
    const room = await storage.getRoomById(user.roomId);
    
    if (!room || !room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // Determine file type based on mime type
    const fileType = mimeType ? getFileType(mimeType) : 'unknown';
    
    // Add message
    const messageData: InsertMessage = {
      roomId: user.roomId,
      userId: user.id,
      username: user.username,
      content: 'Sent a file: ' + fileName,
      messageType: fileType,
      fileUrl,
      fileName,
      fileSize,
      mimeType
    };
    
    const message = await storage.addMessage(messageData);
    
    // Broadcast to all users in the room
    broadcastToRoom(user.roomId, {
      type: WsMessageType.FILE_MESSAGE,
      payload: message
    });
    
    // Update user's last activity
    await storage.updateUserConnection(connectionId, true);
  } catch (error) {
    console.error('Error handling FILE_MESSAGE:', error);
    sendError(ws, 'Failed to send file message');
  }
}

// Handle WebSocket-based image messages
async function handleImageMessage(ws: WebSocket, connectionId: string, payload: any): Promise<void> {
  try {
    const { fileUrl, fileName, fileSize, mimeType } = payload;
    
    if (!fileUrl) {
      return sendError(ws, 'Image URL is required');
    }
    
    // Get user from connection ID
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) {
      return sendError(ws, 'Not joined to any room');
    }
    
    // Check if room is active
    const room = await storage.getRoomById(user.roomId);
    
    if (!room || !room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // Add message
    const messageData: InsertMessage = {
      roomId: user.roomId,
      userId: user.id,
      username: user.username,
      content: 'Sent an image',
      messageType: 'image',
      fileUrl,
      fileName: fileName || 'image.jpg',
      fileSize,
      mimeType: mimeType || 'image/jpeg'
    };
    
    const message = await storage.addMessage(messageData);
    
    // Broadcast to all users in the room
    broadcastToRoom(user.roomId, {
      type: WsMessageType.IMAGE_MESSAGE,
      payload: message
    });
    
    // Update user's last activity
    await storage.updateUserConnection(connectionId, true);
  } catch (error) {
    console.error('Error handling IMAGE_MESSAGE:', error);
    sendError(ws, 'Failed to send image message');
  }
}

// Handle WebSocket-based document messages
async function handleDocumentMessage(ws: WebSocket, connectionId: string, payload: any): Promise<void> {
  try {
    const { fileUrl, fileName, fileSize, mimeType } = payload;
    
    if (!fileUrl || !fileName) {
      return sendError(ws, 'Document URL and file name are required');
    }
    
    // Get user from connection ID
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) {
      return sendError(ws, 'Not joined to any room');
    }
    
    // Check if room is active
    const room = await storage.getRoomById(user.roomId);
    
    if (!room || !room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // Add message
    const messageData: InsertMessage = {
      roomId: user.roomId,
      userId: user.id,
      username: user.username,
      content: 'Sent a document: ' + fileName,
      messageType: 'document',
      fileUrl,
      fileName,
      fileSize,
      mimeType
    };
    
    const message = await storage.addMessage(messageData);
    
    // Broadcast to all users in the room
    broadcastToRoom(user.roomId, {
      type: WsMessageType.DOCUMENT_MESSAGE,
      payload: message
    });
    
    // Update user's last activity
    await storage.updateUserConnection(connectionId, true);
  } catch (error) {
    console.error('Error handling DOCUMENT_MESSAGE:', error);
    sendError(ws, 'Failed to send document message');
  }
}

// Handle video call signaling
async function handleVideoCallSignaling(ws: WebSocket, connectionId: string, message: WsMessage): Promise<void> {
  try {
    const { target, joining, keepCallActive, ...signalData } = message.payload;
    
    // Get user from connection ID
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) {
      return sendError(ws, 'Not joined to any room');
    }
    
    // Check if room is active
    const room = await storage.getRoomById(user.roomId);
    
    if (!room || !room.active) {
      return sendError(ws, 'Room has expired or been closed');
    }
    
    // Special handling for hangup with keepCallActive flag
    if (message.type === WsMessageType.VIDEO_CALL_HANGUP && keepCallActive) {
      console.log(`User ${user.username} is leaving the call but keeping it active for others in room ${room.id}`);
      
      // Include the keepCallActive flag in the outgoing payload
      const hangupPayload = {
        ...message.payload,
        sender: {
          userId: user.id,
          username: user.username
        },
        // Explicitly include keepCallActive flag
        keepCallActive: true
      };
      
      // Broadcast to all users in the room
      broadcastToRoom(user.roomId, {
        type: message.type,
        payload: hangupPayload
      }, ws); // exclude the sender
      
      // Update user's last activity
      await storage.updateUserConnection(connectionId, true);
      return; // Exit early, we've handled the request
    }
    
    // Special handling for joining an existing call
    if (message.type === WsMessageType.VIDEO_CALL_START && joining === true) {
      console.log(`User ${user.username} is joining an existing call in room ${room.id}`);
      
      // Find connected users in the room
      const roomUsers = await storage.getUsersByRoom(room.id);
      const connectedUsers = roomUsers.filter(u => u.connected && u.id !== user.id);
      
      if (connectedUsers.length === 0) {
        console.log('No other users in the room to join call with');
        return sendError(ws, 'No active users in the call to join');
      }
      
      // Add sender info to the payload for the joining user
      const joiningPayload = {
        joining: true,
        roomId: room.id,
        caller: user.username,
        userId: user.id,
        sender: {
          userId: user.id,
          username: user.username
        }
      };
      
      // Send joining request to all other users (one of them should respond)
      broadcastToRoom(room.id, {
        type: WsMessageType.VIDEO_CALL_START,
        payload: joiningPayload
      }, ws); // exclude the sender
      
      return; // Exit early, we've handled the request
    }
    
    // Regular video call signaling
    // Add sender info to the payload
    const outgoingPayload = {
      ...message.payload,
      sender: {
        userId: user.id,
        username: user.username
      }
    };
    
    if (target) {
      // If there's a target user ID, only send to that user
      connectionMap.forEach((connId, targetWs) => {
        if (targetWs.readyState === WebSocket.OPEN) {
          storage.getUserByConnectionId(connId).then(targetUser => {
            if (targetUser && targetUser.id === target && targetUser.connected) {
              send(targetWs, {
                type: message.type,
                payload: outgoingPayload
              });
            }
          }).catch(err => {
            console.error('Error sending video call signal:', err);
          });
        }
      });
    } else {
      // Broadcast to all users in the room
      broadcastToRoom(user.roomId, {
        type: message.type,
        payload: outgoingPayload
      }, ws); // exclude the sender
    }
    
    // Update user's last activity
    await storage.updateUserConnection(connectionId, true);
  } catch (error) {
    console.error('Error handling video call signaling:', error);
    sendError(ws, 'Failed to process video call signal');
  }
}

// Handle user disconnection
async function handleDisconnect(ws: WebSocket, connectionId: string): Promise<void> {
  try {
    const user = await storage.getUserByConnectionId(connectionId);
    
    if (!user) return;
    
    await storage.updateUserConnection(connectionId, false);
    
    // Broadcast to others that user disconnected
    broadcastToRoom(user.roomId, {
      type: WsMessageType.LEAVE,
      payload: { username: user.username, userId: user.id }
    }, ws);
  } catch (error) {
    console.error('Error handling disconnect:', error);
  }
}

// Send a message to a WebSocket client
function send(ws: WebSocket, message: WsMessage): void {
  // Important: Need to import WebSocket directly from 'ws' package
  // In Replit environment, we must check readyState against the constant
  if (ws.readyState === WebSocket.OPEN) {
    try {
      // Break message into smaller chunks if needed (to avoid large payloads)
      const messageStr = JSON.stringify(message);
      console.log("Sending WebSocket message:", messageStr.substring(0, 100) + (messageStr.length > 100 ? '...' : ''));
      
      // Add delay or use setImmediate to avoid overwhelming the socket
      setImmediate(() => {
        try {
          ws.send(messageStr, (err) => {
            if (err) {
              console.error("WebSocket send callback error:", err);
            }
          });
        } catch (sendError) {
          console.error("Error in setImmediate send:", sendError);
        }
      });
    } catch (error) {
      console.error("Error preparing WebSocket message:", error);
    }
  } else {
    console.warn(`Cannot send message, WebSocket is not open (state: ${ws.readyState}, expected: ${WebSocket.OPEN})`);
  }
}

// Send an error message to a WebSocket client
function sendError(ws: WebSocket, errorMessage: string): void {
  send(ws, {
    type: WsMessageType.ERROR,
    payload: { message: errorMessage }
  });
}

// Broadcast a message to all clients in a room
function broadcastToRoom(roomId: string, message: WsMessage, excludeWs?: WebSocket): void {
  connectionMap.forEach((connId, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      storage.getUserByConnectionId(connId).then(user => {
        if (user && user.roomId === roomId && user.connected) {
          send(ws, message);
        }
      }).catch(err => {
        console.error('Error broadcasting to room:', err);
      });
    }
  });
}