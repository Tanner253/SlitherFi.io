import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage extends Document {
  username: string;
  message: string;
  timestamp: number;
  createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  username: { type: String, required: true },
  message: { type: String, required: true, maxlength: 200 },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, expires: 604800 } // Auto-delete after 7 days
});

// Index for sorting by timestamp
ChatMessageSchema.index({ timestamp: -1 });

export const ChatMessage = mongoose.models.ChatMessage || mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);

