// Modificar cómo se registra el plugin multipart
const fastify = require('fastify')({ logger: true });
const multipart = require('@fastify/multipart');
const jwt = require('@fastify/jwt');
const minioClient = require('./src/infrastructure/storage/MinioClient');
const axios = require('axios');
const { Pool } = require('pg');

// Configurar la conexión a la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@postgres:5432/document_db'
});

// Register plugins with increased limits
fastify.register(multipart, {
  limits: {
    fieldNameSize: 100, // Max field name size in bytes
    fieldSize: 100,     // Max field value size in bytes
    fields: 10,         // Max number of non-file fields
    fileSize: 10 * 1024 * 1024, // 10MB - aumentado de 1MB (valor por defecto)
    files: 5,           // Max number of file fields
    headerPairs: 2000   // Max number of header key=>value pairs
  }
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey'
});

// Authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    // Verificar formato del token (Bearer token o solo token)
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new Error('No authorization header present');
    }
    
    const token = authHeader.startsWith('Bearer ') ? 
        authHeader.substring(7, authHeader.length) : authHeader;
    
    await request.jwtVerify({ token });
  } catch (err) {
    request.log.error(`Authentication error: ${err.message}`);
    reply.code(401).send({ message: 'Unauthorized' });
  }
});

// Document upload endpoint
fastify.post('/upload', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const data = await request.file();
      const userId = request.user.id;
      
      request.log.info(`Processing file upload for user ${userId}: ${data.filename}`);
      
      // Verificar el tipo de archivo (opcional)
      const allowedMimetypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      if (!allowedMimetypes.includes(data.mimetype)) {
        return reply.code(400).send({ 
          message: 'Tipo de archivo no soportado. Solo se permiten PDF, JPEG y PNG.'
        });
      }
      
      // Obtener el buffer del archivo
      const fileBuffer = await data.toBuffer();
      const originalSize = fileBuffer.length;
      
      // Subir a MinIO
      const fileData = await minioClient.uploadFile(userId, {
        filename: data.filename,
        mimetype: data.mimetype,
        file: fileBuffer
      });
      
      // Guardar información del documento en la base de datos
      const documentResult = await pool.query(
        `INSERT INTO documents 
         (user_id, filename, original_filename, mimetype, size, bucket_name, object_name, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING id`,
        [
          userId, 
          fileData.filename, 
          fileData.originalFilename,
          fileData.mimetype, 
          fileData.size, 
          fileData.bucket,
          fileData.objectName,
          'uploaded'
        ]
      );
      
      const documentId = documentResult.rows[0].id;
      
      // Procesar OCR en segundo plano
      processOcr(fileBuffer, documentId, userId).catch(err => {
        request.log.error(`Error processing OCR: ${err.message}`);
      });
      
      return { 
        message: 'File uploaded successfully',
        document: {
          id: documentId,
          filename: fileData.filename,
          originalFilename: fileData.originalFilename,
          mimetype: fileData.mimetype,
          size: fileData.size,
          bucket: fileData.bucket,
          objectName: fileData.objectName
        }
      };
    } catch (error) {
      request.log.error(`File upload error: ${error.message}`);
      return reply.code(500).send({ message: 'Error al subir el archivo' });
    }
  }
});

// Función para procesar OCR y almacenar resultados
async function processOcr(fileBuffer, documentId, userId) {
  try {
    // Crear un FormData para enviar el archivo al servicio OCR
    const formData = new FormData();
    const blob = new Blob([fileBuffer]);
    formData.append('file', blob, 'document.pdf');
    
    // Enviar el archivo al servicio OCR
    const ocrResponse = await axios.post('http://ocr-service:8000/process', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    // Obtener los resultados del OCR
    const ocrData = ocrResponse.data;
    
    // Guardar resultados OCR en la base de datos
    await pool.query(
      `INSERT INTO ocr_results (document_id, full_text, extracted_data, confidence)
       VALUES ($1, $2, $3, $4)`,
      [
        documentId,
        ocrData.text,
        JSON.stringify(ocrData.extracted_data),
        ocrData.extracted_data.confidence || 0.0
      ]
    );
    
    // Actualizar el estado del documento
    await pool.query(
      `UPDATE documents SET ocr_processed = true, status = 'processed' WHERE id = $1`,
      [documentId]
    );
    
    // Si se extrajo un monto, crear una transacción financiera
    if (ocrData.extracted_data.amount) {
      await createFinancialTransaction(userId, documentId, ocrData.extracted_data);
    }
    
    console.log(`OCR processing completed for document ${documentId}`);
  } catch (error) {
    console.error(`OCR processing error for document ${documentId}:`, error);
    
    // Actualizar el estado del documento en caso de error
    await pool.query(
      `UPDATE documents SET status = 'error_ocr' WHERE id = $1`,
      [documentId]
    );
  }
}

// Función para crear transacción financiera
async function createFinancialTransaction(userId, documentId, extractedData) {
  try {
    // Extraer el monto (eliminar el símbolo $ y convertir a número)
    let amount = extractedData.amount;
    if (typeof amount === 'string') {
      amount = amount.replace(/[$\s,]/g, '');
    }
    amount = parseFloat(amount);
    
    // Formatear la fecha si existe
    let transactionDate = extractedData.date || new Date().toISOString().split('T')[0];
    
    // Enviar datos al servicio financiero
    await axios.post('http://financial-service:3003/transactions', {
      userId,
      documentId,
      amount,
      date: transactionDate,
      description: extractedData.description || 'Transacción generada por OCR',
      category_id: null, // Categoría pendiente
      transaction_type: 'expense', // Por defecto asumimos que es un gasto
      source: 'ocr'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Financial transaction created for document ${documentId}`);
  } catch (error) {
    console.error(`Error creating financial transaction for document ${documentId}:`, error);
  }
}

// List user documents endpoint
fastify.get('/documents', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      let files = [];
      
      try {
        files = await minioClient.listUserFiles(userId);
      } catch (minioError) {
        request.log.error(`Error accessing MinIO: ${minioError.message}`);
        // Devolver una lista vacía en lugar de un error si MinIO no está disponible
        return { 
          documents: [],
          warning: "El servicio de almacenamiento está temporalmente no disponible"
        };
      }
      
      // Transform the file list to a user-friendly format
      const documents = files.map((file) => {
        // Codificar el nombre del objeto para evitar problemas con las barras
        const encodedObjectName = encodeURIComponent(file.name);
        const downloadUrl = `/api/documents/view-encoded/${encodedObjectName}`;
        
        return {
          filename: file.name.split('/').pop(),
          size: file.size,
          lastModified: file.lastModified,
          downloadUrl
        };
      });
      
      return { documents };
    } catch (error) {
      request.log.error(`Error listing documents: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener los documentos' });
    }
  }
});

// Get document details endpoint
fastify.get('/documents/:documentId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    // This would typically fetch from a database and verify user ownership
    // For this example, we'll just return a placeholder
    return {
      message: 'Endpoint not fully implemented'
    };
  }
});

// Health check
fastify.get('/health', async () => {
  return { status: 'UP' };
});

// Añadir este nuevo endpoint para servir archivos directamente
fastify.get('/view/:objectName', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const objectName = request.params.objectName;
      
      // Verificar que el archivo pertenece al usuario (seguridad)
      const userPrefix = `user-${userId}/`;
      if (!objectName.startsWith(userPrefix)) {
        return reply.code(403).send({ message: 'No tienes permiso para acceder a este archivo' });
      }
      
      // Obtener los metadatos del objeto para determinar el tipo MIME
      const stat = await minioClient.minioClient.statObject(
        minioClient.defaultBucket,
        objectName
      );
      
      // Obtener el stream del archivo
      const fileStream = await minioClient.minioClient.getObject(
        minioClient.defaultBucket,
        objectName
      );
      
      // Configurar los encabezados para la respuesta
      reply.header('Content-Type', stat.metaData['content-type'] || 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${objectName.split('/').pop()}"`);
      
      // Enviar el stream directamente como respuesta
      return reply.send(fileStream);
    } catch (error) {
      request.log.error(`Error serving file: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener el archivo' });
    }
  }
});

// Mejorar el endpoint de visualización codificada
fastify.get('/view-encoded/:encodedObjectName', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      // Decodificar el nombre del objeto
      const objectName = decodeURIComponent(request.params.encodedObjectName);
      
      // Verificar que el archivo pertenece al usuario (seguridad)
      const userPrefix = `user-${userId}/`;
      if (!objectName.startsWith(userPrefix)) {
        return reply.code(403).send({ 
          message: 'No tienes permiso para acceder a este archivo',
          requested: objectName,
          expected: userPrefix
        });
      }
      
      try {
        // Obtener los metadatos del objeto
        const stat = await minioClient.minioClient.statObject(
          minioClient.defaultBucket,
          objectName
        );
        
        request.log.info(`File metadata: ${JSON.stringify(stat.metaData)}`);
        request.log.info(`File size from metadata: ${stat.size} bytes`);
        
        // Configurar los encabezados para la respuesta
        reply.header('Content-Type', stat.metaData['content-type'] || 'application/octet-stream');
        reply.header('Content-Length', stat.size);
        reply.header('Content-Disposition', `inline; filename="${objectName.split('/').pop()}"`);
        reply.header('Cache-Control', 'max-age=86400'); // Caché por 24 horas
        
        // Usar un método más directo para descargar y enviar el archivo
        const fileStream = await minioClient.minioClient.getObject(
          minioClient.defaultBucket,
          objectName
        );
        
        // Enviar el stream directamente como respuesta
        return reply.send(fileStream);
      } catch (fileError) {
        request.log.error(`Error al obtener el archivo: ${fileError.message}`);
        if (fileError.code === 'NoSuchKey') {
          return reply.code(404).send({ 
            message: 'El archivo solicitado no existe',
            objectName
          });
        }
        throw fileError;
      }
    } catch (error) {
      request.log.error(`Error serving file: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener el archivo' });
    }
  }
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3002, host: '0.0.0.0' });
    fastify.log.info(`Document service listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();