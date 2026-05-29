import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import { storageService } from '../services/storage.service';
import { prisma } from '../config/database';
import { AuthRequest } from '../types';

const router = Router();
router.use(authMiddleware);

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// POST /api/v1/upload/asset
router.post('/asset', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
      return;
    }

    const purpose = (req.body.purpose as string) || 'general';
    const key = await storageService.uploadBuffer(req.file.buffer, req.file.mimetype, 'assets');
    const url = await storageService.getSignedUrl(key);

    // Save asset record
    const asset = await prisma.asset.create({
      data: {
        userId: req.user!.id,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        s3Key: key,
        s3Url: key, // store key, generate signed URL on demand
        purpose,
      },
    });

    res.json({
      success: true,
      data: { asset_id: asset.id, url, s3_key: key },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: err.message } });
  }
});

// GET /api/v1/upload/assets — list user's uploaded assets
router.get('/assets', async (req: AuthRequest, res: Response) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Generate fresh signed URLs
    const assetsWithUrls = await Promise.all(
      assets.map(async (a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        purpose: a.purpose,
        url: await storageService.getSignedUrl(a.s3Key),
        createdAt: a.createdAt,
      }))
    );

    res.json({ success: true, data: { assets: assetsWithUrls } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
  }
});

export default router;
