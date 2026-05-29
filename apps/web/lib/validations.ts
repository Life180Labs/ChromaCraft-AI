import { z } from 'zod';

export const ColorSchema = z.string().min(1).max(50);

export const ColorsArraySchema = z.array(ColorSchema).min(1).max(48);

export const GridSettingsSchema = z.object({
  cols: z.number().int().min(1).max(8).default(4),
  rows: z.number().int().min(1).max(8).default(3),
});

export const GenerationSettingsSchema = z.object({
  prefix: z.string().max(100).optional(),
  colors: ColorsArraySchema.optional(),
  cols: z.number().int().min(1).max(8).default(4),
  rows: z.number().int().min(1).max(8).default(3),
  industry: z.string().max(100).optional(),
  targetMarket: z.string().max(100).optional(),
  targetAudience: z.string().max(100).optional(),
  targetPurpose: z.string().max(200).optional(),
  lifestyleEnabled: z.boolean().default(false),
  videoEnabled: z.boolean().default(false),
  spinEnabled: z.boolean().default(false),
  cropsEnabled: z.boolean().default(false),
  imageSize: z.string().regex(/^\d+x\d+$/).default('800x600'),
  spinFrames: z.number().int().min(8).max(72).default(36),
  fps: z.number().int().min(1).max(30).default(12),
  strategy: z.enum(['stability', 'sdxl_controlnet', 'controlnet', 'hsl_shift']).optional(),
  denoiseStrength: z.number().min(0).max(1).default(0.4),
  qualityThreshold: z.number().min(0).max(1).default(0.92),
  identityLock: z.boolean().default(true),
  additionalContext: z.string().max(2000).optional(),
});

export const GenerateRequestSchema = z.object({
  jobId: z.number().int().positive(),
  prompt: z.string().min(10).max(5000),
  providerId: z.number().int().positive().optional(),
  settings: GenerationSettingsSchema.optional(),
});

export const UploadRequestSchema = z.object({
  file: z.instanceof(File).refine((f) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    return validTypes.includes(f.type);
  }, 'File must be PNG, JPEG, or WebP image').refine((f) => {
    return f.size <= 50_000_000;
  }, 'File must be under 50MB'),
  name: z.string().max(200).optional(),
  jobId: z.string().optional(),
  color: z.string().max(50).optional(),
});

export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});

export const ProfileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
  twoFactorEnabled: z.boolean().optional(),
});

export const QaRequestSchema = z.object({
  jobId: z.number().int().positive(),
  assetIds: z.array(z.number().int().positive()).min(1),
  action: z.enum(['approve', 'reject']),
});

export const ExportRequestSchema = z.object({
  jobId: z.number().int().positive(),
  format: z.enum(['png', 'jpeg', 'jpg', 'webp']).default('png'),
  mode: z.enum(['stream', 'url']).default('stream'),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;
export type QaRequest = z.infer<typeof QaRequestSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
