import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { Request } from 'express';
import path from 'path';
import { createHash } from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter to check file types
const fileFilter = (req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback) => {
  // Accept images, documents, and videos
  const allowedMimeTypes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    // Documents
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Videos (for video chat preview thumbnails)
    'video/mp4', 'video/webm'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    callback(null, true);
  } else {
    callback(new Error('Invalid file type. Only images, documents, and videos are allowed.'));
  }
};

// Configure multer with 10MB size limit
export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

// Function to generate a unique filename
const generateUniqueFilename = (originalname: string) => {
  const timestamp = Date.now();
  const hash = createHash('md5').update(`${originalname}-${timestamp}`).digest('hex').substring(0, 8);
  const extension = path.extname(originalname);
  return `${path.basename(originalname, extension)}-${hash}${extension}`;
};

// Function to upload file to Cloudinary
export const uploadToCloudinary = async (
  file: Express.Multer.File, 
  folderName = 'chat_uploads'
): Promise<{ url: string; publicId: string; }> => {
  return new Promise((resolve, reject) => {
    // Check if Cloudinary credentials are available
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      reject(new Error('Cloudinary configuration is missing'));
      return;
    }
    
    // Create a buffer from file data
    const uniqueFilename = generateUniqueFilename(file.originalname);
    
    // Setup stream for uploading to Cloudinary
    const uploadOptions = { 
      folder: folderName,
      resource_type: 'auto' as 'auto',
      public_id: path.basename(uniqueFilename, path.extname(uniqueFilename))
    };
    
    // Convert buffer to base64 for Cloudinary
    const base64Data = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    
    // Upload to Cloudinary
    cloudinary.uploader.upload(base64Data, uploadOptions, (error, result) => {
      if (error) {
        console.error('Cloudinary upload error:', error);
        reject(error);
      } else if (result) {
        resolve({
          url: result.secure_url,
          publicId: result.public_id
        });
      } else {
        reject(new Error('Unknown error during file upload'));
      }
    });
  });
};

// Function to determine file type
export const getFileType = (mimetype: string): 'image' | 'document' | 'video' | 'unknown' => {
  if (mimetype.startsWith('image/')) {
    return 'image';
  } else if (
    mimetype === 'application/pdf' || 
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimetype === 'text/plain' ||
    mimetype === 'application/vnd.ms-excel' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'document';
  } else if (mimetype.startsWith('video/')) {
    return 'video';
  } else {
    return 'unknown';
  }
};