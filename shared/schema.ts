
import { Schema, model, Document } from 'mongoose';
import { z } from 'zod';

// User Schema
export interface User extends Document {
  username: string;
  roomId: string;
  connectionId: string;
  connected: boolean;
  lastActivity: Date;
}

const userSchema = new Schema({
  username: { type: String, required: true },
  roomId: { type: String, required: true },
  connectionId: { type: String, required: true },
  connected: { type: Boolean, default: true },
  lastActivity: { type: Date, default: Date.now }
});

// Room Schema
export interface Room extends Document {
  id: string;
  name?: string;
  createdAt: Date;
  expiresAt: Date;
  createdBy: string;
  isScheduled: boolean;
  scheduledFor?: Date;
  duration: number;
  active: boolean;
}

const roomSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  createdBy: { type: String, required: true },
  isScheduled: { type: Boolean, default: false },
  scheduledFor: Date,
  duration: { type: Number, default: 1440 },
  active: { type: Boolean, default: true }
});

// Message Schema
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  VIDEO_CALL = 'video_call'
}

export interface Message extends Document {
  roomId: string;
  userId: number;
  username: string;
  content: string;
  messageType: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  timestamp: Date;
}

const messageSchema = new Schema({
  roomId: { type: String, required: true },
  userId: { type: Number, required: true },
  username: { type: String, required: true },
  content: { type: String, required: true },
  messageType: { type: String, default: 'text' },
  fileUrl: String,
  fileName: String,
  fileSize: Number,
  mimeType: String,
  timestamp: { type: Date, default: Date.now }
});

// Models
export const UserModel = model<User>('User', userSchema);
export const RoomModel = model<Room>('Room', roomSchema);
export const MessageModel = model<Message>('Message', messageSchema);

// Websocket message types (unchanged)
export enum WsMessageType {
  JOIN = 'join',
  LEAVE = 'leave',
  CHAT_MESSAGE = 'chat_message',
  FILE_MESSAGE = 'file_message',
  IMAGE_MESSAGE = 'image_message',
  DOCUMENT_MESSAGE = 'document_message',
  VIDEO_CALL_START = 'video_call_start',
  VIDEO_CALL_ANSWER = 'video_call_answer',
  VIDEO_CALL_ICE = 'video_call_ice',
  VIDEO_CALL_HANGUP = 'video_call_hangup',
  USER_LIST = 'user_list',
  ERROR = 'error',
  ROOM_CLOSED = 'room_closed',
  ROOM_EXPIRING = 'room_expiring'
}

export interface WsMessage {
  type: WsMessageType;
  payload: any;
}
