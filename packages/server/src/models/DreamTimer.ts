import mongoose, { Schema, Document } from 'mongoose';

export interface IDreamTimer extends Document {
  id: string;
  lastGameEnd: number;
  updatedAt: Date;
}

const DreamTimerSchema = new Schema<IDreamTimer>({
  id: { type: String, required: true, unique: true, default: 'global' },
  lastGameEnd: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

export const DreamTimer = mongoose.models.DreamTimer || mongoose.model<IDreamTimer>('DreamTimer', DreamTimerSchema);


