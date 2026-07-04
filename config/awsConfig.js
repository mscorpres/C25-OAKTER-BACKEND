const { S3Client, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();


const requiredEnvVars = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_S3_BUCKET_NAME",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}


const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});


const s3Config = {
  bucket: process.env.AWS_S3_BUCKET_NAME,
  
 
  getSignedUrl: async (key, inline = true) => {
    if (!key) throw new Error("Key is required for generating signed URL");

    const commandParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    };
    
  
    if (inline) {
      
      const ext = key.split('.').pop().toLowerCase();
      const contentTypeMap = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'pdf': 'application/pdf',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
      };
      
      const contentType = contentTypeMap[ext] || 'application/octet-stream';
      
      commandParams.ResponseContentDisposition = 'inline';
      commandParams.ResponseContentType = contentType;
    }

    const command = new GetObjectCommand(commandParams);

    return await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour
  },
  
  
  uploadFile: async (file, key) => {
    if (!file || !file.buffer)
      throw new Error("File buffer is required for upload");
    if (!key) throw new Error("Key is required for upload");
    if (!process.env.AWS_S3_BUCKET_NAME)
      throw new Error("AWS_S3_BUCKET_NAME is not configured");

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      
    });

    try {
      const response = await s3Client.send(command);
      return {
        Location: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        Key: key,
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        ETag: response.ETag,
      };
    } catch (error) {
      console.error("S3 Upload Error:", {
        error: error.message,
        bucket: process.env.AWS_S3_BUCKET_NAME,
        key: key,
      });
      throw error;
    }
  },
  
 
  headObject: async (key) => {
    const command = new HeadObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    });
    return await s3Client.send(command);
  },
  

  deleteObject: async (key) => {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    });
    return await s3Client.send(command);
  },
};


const verifyS3Connection = async () => {
  try {
    const command = new HeadBucketCommand({ 
      Bucket: process.env.AWS_S3_BUCKET_NAME 
    });
    await s3Client.send(command);
    console.log(
      "✓ Successfully connected to S3 bucket:",
      process.env.AWS_S3_BUCKET_NAME
    );
  } catch (error) {
    console.error("✗ Failed to connect to S3 bucket:", error.message);
    throw new Error(`S3 connection failed: ${error.message}`);
  }
};


verifyS3Connection().catch(console.error);

module.exports = {
  s3Client,
  s3Config,
};