const Minio = require('minio');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class MinioClient {
  constructor() {
    // Define internal and external endpoints
    this.internalEndpoint = process.env.MINIO_ENDPOINT || 'minio';
    this.internalPort = parseInt(process.env.MINIO_PORT || '9000');
    
    // Para URL generation - usar la IP real del servidor
    this.externalEndpoint = process.env.EXTERNAL_MINIO_HOST?.split(':')[0] || this.getServerIP();
    this.externalPort = parseInt(process.env.EXTERNAL_MINIO_HOST?.split(':')[1] || '9001');
    
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 30;
    
    // Create MinIO client for internal operations
    this.minioClient = new Minio.Client({
      endPoint: this.internalEndpoint,
      port: this.internalPort,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
    });
    
    // Create a separate client for URL generation
    this.urlGenerationClient = new Minio.Client({
      endPoint: this.externalEndpoint,
      port: this.externalPort,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
    });
    
    this.defaultBucket = 'documents';
    this.thumbnailBucket = 'thumbnails';
    
    // No inicializar los buckets inmediatamente
    // Intenta inicializar pero no bloquea
    this.initializationPromise = this.initBucketsWithRetry();
  }
  
  // Método para obtener la IP del servidor automáticamente
  getServerIP() {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    
    for (const interfaceName in networkInterfaces) {
      const addresses = networkInterfaces[interfaceName];
      for (const address of addresses) {
        // Buscar IPv4 no local
        if (address.family === 'IPv4' && !address.internal) {
          return address.address;
        }
      }
    }
    return '127.0.0.1'; // fallback
  }
  
  // Método para intentar inicializar los buckets con reintentos
  async initBucketsWithRetry() {
    while (this.connectionAttempts < this.maxConnectionAttempts) {
      try {
        console.log(`Intentando conectar con MinIO (intento ${this.connectionAttempts + 1}/${this.maxConnectionAttempts})...`);
        
        // Intentar una operación simple para probar la conexión
        await this.minioClient.listBuckets();
        
        // Si llegamos aquí, la conexión es exitosa
        console.log('Conexión con MinIO establecida correctamente');
        
        // Inicializar buckets
        await this.initBuckets();
        
        this.isConnected = true;
        return true;
      } catch (error) {
        this.connectionAttempts++;
        console.error(`Error conectando con MinIO (intento ${this.connectionAttempts}): ${error.message}`);
        
        // Si alcanzamos el máximo de intentos, dejar de intentar
        if (this.connectionAttempts >= this.maxConnectionAttempts) {
          console.error('Se alcanzó el máximo número de intentos de conexión a MinIO');
          return false;
        }
        
        // Esperar antes del siguiente intento (espera exponencial)
        const waitTime = Math.min(1000 * Math.pow(2, this.connectionAttempts / 3), 30000);
        console.log(`Esperando ${waitTime}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    return false;
  }
  
  // Método para asegurar que tenemos conexión antes de ejecutar operaciones
  async ensureConnection() {
    if (!this.isConnected) {
      // Si ya estamos intentando conectar, esperar a que termine
      await this.initializationPromise;
      
      // Si todavía no estamos conectados, intentar una vez más
      if (!this.isConnected) {
        this.connectionAttempts = 0;
        this.initializationPromise = this.initBucketsWithRetry();
        await this.initializationPromise;
      }
      
      if (!this.isConnected) {
        throw new Error('No se pudo establecer conexión con MinIO');
      }
    }
  }
  
  async initBuckets() {
    try {
      // Ensure the default bucket exists
      const defaultBucketExists = await this.minioClient.bucketExists(this.defaultBucket);
      if (!defaultBucketExists) {
        await this.minioClient.makeBucket(this.defaultBucket);
        console.log(`Bucket '${this.defaultBucket}' created successfully`);
      }
      
      // Siempre establecer la política de acceso público para el bucket documents
      // incluso si ya existe (por si la política no se aplicó correctamente antes)
      const publicPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.defaultBucket}/*`]
          }
        ]
      });
      
      await this.minioClient.setBucketPolicy(this.defaultBucket, publicPolicy);
      console.log(`Public read policy set on bucket '${this.defaultBucket}'`);
      
      // Ensure the thumbnail bucket exists
      const thumbnailBucketExists = await this.minioClient.bucketExists(this.thumbnailBucket);
      if (!thumbnailBucketExists) {
        await this.minioClient.makeBucket(this.thumbnailBucket);
        console.log(`Bucket '${this.thumbnailBucket}' created successfully`);
      }
      
      // Set public read access on the thumbnail bucket
      const thumbnailPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.thumbnailBucket}/*`]
          }
        ]
      };
      
      await this.minioClient.setBucketPolicy(
        this.thumbnailBucket,
        JSON.stringify(thumbnailPolicy)
      );
      
    } catch (error) {
      console.error('Error initializing MinIO buckets:', error);
      throw error;
    }
  }
  
  // Generate a user-specific path for objects
  getUserPath(userId) {
    return `user-${userId}/`;
  }
  
  // Generate a unique filename to avoid collisions
  generateUniqueFilename(originalFilename) {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);
    const sanitizedName = basename.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    return `${sanitizedName}-${uuidv4()}${ext}`;
  }
  
  // Upload a file to user's directory
  async uploadFile(userId, file, metadata = {}) {
    try {
      await this.ensureConnection();
      
      const userPath = this.getUserPath(userId);
      const uniqueFilename = this.generateUniqueFilename(file.filename);
      const objectName = `${userPath}${uniqueFilename}`;
      
      // No modificar el buffer original
      const fileBuffer = file.file;
      
      // Usar metadatos estándares sin transformaciones adicionales
      const contentType = file.mimetype;
      
      // Metadatos más simples, evitando transformaciones innecesarias
      const fileMetadata = {
        'content-type': contentType,
        'original-filename': file.filename,
        'user-id': userId.toString()
      };
      
      // Usar putObject con configuraciones explícitas
      await this.minioClient.putObject(
        this.defaultBucket,
        objectName,
        fileBuffer,
        fileBuffer.length,
        fileMetadata
      );
      
      return {
        bucket: this.defaultBucket,
        objectName,
        filename: uniqueFilename,
        originalFilename: file.filename,
        mimetype: contentType,
        size: fileBuffer.length,
        metadata: fileMetadata
      };
    } catch (error) {
      console.error('Error uploading file to MinIO:', error);
      throw error;
    }
  }
  
  // List files for a specific user
  async listUserFiles(userId) {
    try {
      // Verificar conexión antes de operar
      await this.ensureConnection();
      
      const userPath = this.getUserPath(userId);
      const objectsList = [];
      
      const stream = this.minioClient.listObjects(
        this.defaultBucket,
        userPath,
        true
      );
      
      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          objectsList.push(obj);
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
        
        stream.on('end', () => {
          resolve(objectsList);
        });
      });
    } catch (error) {
      console.error('Error listing user files from MinIO:', error);
      throw error;
    }
  }
  
  // Get file download URL
  async getFileUrl(bucket, objectName, expiryInSeconds = 3600) {
    try {
      // Use the URL generation client with external endpoint
      return await this.urlGenerationClient.presignedGetObject(
        bucket,
        objectName,
        expiryInSeconds
      );
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw error;
    }
  }
  
  // Add a method to get a direct public URL (for anonymous access)
  getPublicUrl(bucket, objectName) {
    // Asegurarse de que la URL esté correctamente formada sin doble slash
    return `http://${this.externalEndpoint}:${this.externalPort}/${bucket}/${objectName}`;
  }
  
  // Delete a file
  async deleteFile(bucket, objectName) {
    try {
      await this.minioClient.removeObject(bucket, objectName);
      return true;
    } catch (error) {
      console.error('Error deleting file from MinIO:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const minioClient = new MinioClient();
module.exports = minioClient;