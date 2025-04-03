import mongoose from 'mongoose';
import { User, Room, Message, UserModel, RoomModel, MessageModel } from '@shared/schema';
import { nanoid } from 'nanoid';
import { add, isPast } from 'date-fns';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/chat-app';

// Configure mongoose
mongoose.set('strictQuery', false);

try {
  mongoose.connect(MONGODB_URL);
  console.log('Connected to MongoDB successfully');
} catch (error) {
  console.error('MongoDB connection error:', error);
}

export interface IStorage {
  // Room methods
  createRoom(room: Partial<Room>): Promise<Room>;
  getRoomById(id: string): Promise<Room | null>;
  getActiveRoomsByUser(username: string): Promise<Room[]>;
  updateRoomStatus(id: string, active: boolean): Promise<boolean>;

  // User methods
  addUserToRoom(user: Partial<User>): Promise<User>;
  getUserById(id: number): Promise<User | null>;
  getUsersByRoom(roomId: string): Promise<User[]>;
  updateUserConnection(connectionId: string, connected: boolean): Promise<boolean>;
  getUserByConnectionId(connectionId: string): Promise<User | null>;

  // Message methods
  addMessage(message: Partial<Message>): Promise<Message>;
  getMessagesByRoom(roomId: string): Promise<Message[]>;

  // Cleanup methods
  cleanupExpiredRooms(): Promise<void>;
}

class MongoStorage implements IStorage {
  async createRoom(room: Partial<Room>): Promise<Room> {
    return await RoomModel.create(room);
  }

  async getRoomById(id: string): Promise<Room | null> {
    return await RoomModel.findOne({ id });
  }

  async getActiveRoomsByUser(username: string): Promise<Room[]> {
    const rooms = await RoomModel.find({
      createdBy: username,
      active: true
    });
    return rooms;
  }

  async updateRoomStatus(id: string, active: boolean): Promise<boolean> {
    const result = await RoomModel.updateOne({ id }, { active });
    return result.modifiedCount > 0;
  }

  async addUserToRoom(user: Partial<User>): Promise<User> {
    return await UserModel.create(user);
  }

  async getUserById(id: number): Promise<User | null> {
    return await UserModel.findById(id);
  }

  async getUsersByRoom(roomId: string): Promise<User[]> {
    return await UserModel.find({ roomId });
  }

  async updateUserConnection(connectionId: string, connected: boolean): Promise<boolean> {
    const result = await UserModel.updateOne(
      { connectionId },
      {
        connected,
        lastActivity: new Date()
      }
    );
    return result.modifiedCount > 0;
  }

  async getUserByConnectionId(connectionId: string): Promise<User | null> {
    return await UserModel.findOne({ connectionId });
  }

  async addMessage(message: Partial<Message>): Promise<Message> {
    return await MessageModel.create(message);
  }

  async getMessagesByRoom(roomId: string): Promise<Message[]> {
    return await MessageModel.find({ roomId }).sort('timestamp');
  }

  async cleanupExpiredRooms(): Promise<void> {
    await RoomModel.updateMany(
      {
        active: true,
        expiresAt: { $lt: new Date() }
      },
      { active: false }
    );
  }
}

export const storage = new MongoStorage();