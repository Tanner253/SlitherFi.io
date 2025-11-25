import { Schema, model } from 'mongoose';

export interface ICosmetic {
  id: string;
  name: string;
  description: string;
  category: 'trail' | 'headItem' | 'nameStyle';
  cost: number;
  rarity: string;
  renderData: any;
}

const cosmeticSchema = new Schema<ICosmetic>({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true, enum: ['trail', 'headItem', 'nameStyle'] },
  cost: { type: Number, required: true },
  rarity: { type: String, required: true },
  renderData: { type: Schema.Types.Mixed, required: true }
}, { timestamps: true });

export const Cosmetic = model<ICosmetic>('Cosmetic', cosmeticSchema);

