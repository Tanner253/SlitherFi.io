/**
 * MongoDB Connection
 * 
 * Singleton connection for server deployment
 */

import mongoose from 'mongoose';

interface CachedConnection {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: CachedConnection | undefined;
}

let cached: CachedConnection = global.mongooseCache || {
  conn: null,
  promise: null,
};

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

/**
 * Connect to MongoDB
 * 
 * @returns Promise<typeof mongoose> - Mongoose instance
 */
export async function connectDB(): Promise<typeof mongoose> {
  // Return cached connection if exists
  if (cached.conn) {
    return cached.conn;
  }

  // Return pending connection promise if exists
  if (cached.promise) {
    cached.conn = await cached.promise;
    return cached.conn;
  }

  // Check for MongoDB URI
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.warn('⚠️ MONGODB_URI not configured - database features disabled');
    throw new Error('MONGODB_URI not configured');
  }

  // Create new connection
  cached.promise = mongoose.connect(mongoURI, {
    bufferCommands: false,
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 5000,
  }).then((mongoose) => {
    console.log('✅ MongoDB connected');
    return mongoose;
  }).catch((error) => {
    console.error('❌ MongoDB connection error:', error.message);
    cached.promise = null;
    throw error;
  });

  cached.conn = await cached.promise;
  return cached.conn;
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDB(): Promise<void> {
  if (cached.conn) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
    console.log('✅ MongoDB disconnected');
  }
}

/**
 * Check if MongoDB is connected
 */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export default connectDB;


