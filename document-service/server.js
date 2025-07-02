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
  secret: process.env.JWT_SECRET || 'supersecretkey123' // MISMA clave por defecto
});

// Authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    // Verificar formato del token (Bearer token o solo token)
    const authHeader = request.headers.authorization;
    console.log('Document service - Auth header:', authHeader); // Debug log
    
    if (!authHeader) {
      console.log('Document service - No authorization header');
      throw new Error('No authorization header present');
    }
    
    const token = authHeader.startsWith('Bearer ') ? 
        authHeader.substring(7, authHeader.length) : authHeader;
    
    console.log('Document service - Token extracted:', token.substring(0, 20) + '...'); // Debug log
    
    // Verificar el token
    const decoded = await request.jwtVerify({ token });
    console.log('Document service - Token verified for user:', decoded.id); // Debug log
    
  } catch (err) {
    console.error(`Document service - Authentication error:`, err.message);
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

// Modificar la función processOcr para no crear la transacción automáticamente
async function processOcr(fileBuffer, documentId, userId) {
  try {
    // En lugar de usar FormData y Blob que son experimentales en Node.js,
    // usemos un enfoque más directo con el módulo form-data
    const FormData = require('form-data');
    const form = new FormData();
    
    // Añadir el buffer directamente como un archivo
    form.append('file', fileBuffer, {
      filename: 'document.pdf',
      contentType: 'application/pdf', // Importante: especificar el tipo de contenido
    });
    
    console.log(`Enviando documento ${documentId} al servicio OCR (tamaño: ${fileBuffer.length} bytes)`);
    
    // Enviar el formulario al servicio OCR
    const ocrResponse = await axios.post('http://ocr-service:8000/process', form, {
      headers: {
        ...form.getHeaders(), // Usar los headers generados por form-data
      },
      timeout: 60000 // 60 segundos para evitar peticiones que se queden colgadas
    });
    
    // Obtener los resultados del OCR
    const ocrData = ocrResponse.data;
    
    // Guardar resultados OCR en la base de datos
    await pool.query(
      `INSERT INTO ocr_results (document_id, full_text, extracted_data, confidence)
       VALUES ($1, $2, $3, $4)`,
      [
        documentId,
        ocrData.text || '',
        JSON.stringify(ocrData.extracted_data || {}),
        ocrData.confidence || 0.0
      ]
    );
    
    // Actualizar el estado del documento
    await pool.query(
      `UPDATE documents SET ocr_processed = true, status = 'processed_pending_review' WHERE id = $1`,
      [documentId]
    );
    
    console.log(`Procesamiento OCR completado para el documento ${documentId}. Esperando revisión del usuario.`);
  } catch (error) {
    console.error(`Error procesando OCR para el documento ${documentId}:`, error);
    
    // Actualizar el estado del documento con información del error
    try {
      await pool.query(
        `UPDATE documents SET status = $1, ocr_processed = false WHERE id = $2`,
        ['error_ocr', documentId]
      );
    } catch (dbError) {
      console.error(`Error actualizando estado del documento: ${dbError.message}`);
    }
  }
}

// Función para crear transacción financiera
async function createFinancialTransaction(userId, documentId, extractedData) {
  try {
    // Extraer el monto (eliminar el símbolo $ y convertir a número)
    let amount = extractedData.amount;
    if (typeof amount === 'string') {
      amount = amount.replace(/[$\s,.]/g, '');
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
      category: extractedData.category || null,
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
      
      // Obtener documentos de la base de datos
      const documentsResult = await pool.query(
        `SELECT id, filename, original_filename, mimetype, size, bucket_name, object_name, 
                status, ocr_processed, created_at, updated_at 
         FROM documents 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [userId]
      );
      
      for (const doc of documentsResult.rows) {
        try {
          // Generar URL de descarga
          const downloadUrl = `/api/documents/view-encoded/${encodeURIComponent(doc.object_name)}`;
          
          files.push({
            id: doc.id, // IMPORTANTE: Asegurar que el ID se incluya
            filename: doc.filename,
            originalFilename: doc.original_filename,
            mimetype: doc.mimetype,
            size: doc.size,
            bucketName: doc.bucket_name,
            objectName: doc.object_name,
            status: doc.status,
            ocrProcessed: doc.ocr_processed,
            uploadDate: doc.created_at,
            downloadUrl: downloadUrl
          });
        } catch (fileError) {
          request.log.error(`Error processing document ${doc.id}: ${fileError.message}`);
          // Continuar con otros archivos aunque uno falle
        }
      }
      
      console.log(`Returning ${files.length} documents for user ${userId}`);
      return { documents: files };
    } catch (error) {
      request.log.error(`Error listing documents: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener los documentos' });
    }
  }
});

// Document view endpoint
fastify.get('/view/:objectName', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const objectName = request.params.objectName;
      
      // Verificar que el archivo pertenece al usuario
      const userPath = `user-${userId}/`;
      if (!objectName.startsWith(userPath)) {
        return reply.code(403).send({ message: 'Acceso no autorizado al archivo' });
      }
      
      // Generar URL firmada
      const url = await minioClient.getFileUrl('documents', objectName);
      
      // Redirigir a la URL firmada
      return reply.redirect(url);
    } catch (error) {
      request.log.error(`Error viewing document: ${error.message}`);
      return reply.code(500).send({ message: 'Error al acceder al documento' });
    }
  }
});

// Document view encoded endpoint
fastify.get('/view-encoded/:encodedObjectName', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const encodedObjectName = request.params.encodedObjectName;
      const objectName = decodeURIComponent(encodedObjectName);
      
      console.log(`Document service - Accessing encoded document: ${objectName} for user: ${userId}`);
      
      // Verificar que el archivo pertenece al usuario
      const userPath = `user-${userId}/`;
      if (!objectName.startsWith(userPath)) {
        console.log(`Access denied: ${objectName} doesn't start with user-${userId}/`);
        return reply.code(403).send({ message: 'Acceso no autorizado al archivo' });
      }
      
      try {
        // Get the file stream directly instead of generating a URL
        console.log(`Getting file stream for: documents/${objectName}`);
        const fileStream = await minioClient.getFileStream('documents', objectName);
        
        // Determine content type based on file extension
        let contentType = 'application/octet-stream';
        if (objectName.toLowerCase().endsWith('.pdf')) {
          contentType = 'application/pdf';
        } else if (objectName.toLowerCase().match(/\.(jpg|jpeg)$/)) {
          contentType = 'image/jpeg';
        } else if (objectName.toLowerCase().endsWith('.png')) {
          contentType = 'image/png';
        }
        
        // Set response headers
        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', 'inline');
        reply.header('Cache-Control', 'private, max-age=3600');
        
        console.log(`Streaming document: ${objectName} with content-type: ${contentType}`);
        
        // Stream the file directly
        return reply.send(fileStream);
        
      } catch (minioError) {
        console.error(`Error accessing file from MinIO: ${minioError.message}`);
        console.error(`Attempted to access: documents/${objectName}`);
        return reply.code(404).send({ message: 'Document not found in storage' });
      }
    } catch (error) {
      request.log.error(`Error viewing encoded document: ${error.message}`);
      return reply.code(500).send({ message: 'Error al acceder al documento' });
    }
  }
});

// Document deletion endpoint
fastify.delete('/documents/:documentId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const documentId = request.params.documentId;
      
      // Verificar que el documento existe y pertenece al usuario
      const docResult = await pool.query(
        `SELECT * FROM documents WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
      );
      
      if (docResult.rows.length === 0) {
        return reply.code(404).send({ 
          message: 'Documento no encontrado o no tienes permiso para eliminarlo' 
        });
      }
      
      const document = docResult.rows[0];
      
      // Eliminar el archivo de MinIO
      try {
        await minioClient.deleteFile(document.bucket_name, document.object_name);
      } catch (minioError) {
        request.log.warn(`Warning: Could not delete file from MinIO: ${minioError.message}`);
      }
      
      // Eliminar registros relacionados (OCR results)
      await pool.query(`DELETE FROM ocr_results WHERE document_id = $1`, [documentId]);
      
      // Eliminar el documento de la base de datos
      await pool.query(`DELETE FROM documents WHERE id = $1`, [documentId]);
      
      return { 
        message: 'Documento eliminado correctamente',
        documentId: documentId
      };
    } catch (error) {
      request.log.error(`Error deleting document: ${error.message}`);
      return reply.code(500).send({ message: 'Error al eliminar el documento' });
    }
  }
});

// OCR data endpoint
fastify.get('/ocr-data/:documentId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const documentId = request.params.documentId;
      
      // Verificar que el documento pertenece al usuario
      const docResult = await pool.query(
        `SELECT * FROM documents WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
      );
      
      if (docResult.rows.length === 0) {
        return reply.code(404).send({ 
          message: 'Documento no encontrado' 
        });
      }
      
      // Obtener datos de OCR
      const ocrResult = await pool.query(
        `SELECT * FROM ocr_results WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [documentId]
      );
      
      if (ocrResult.rows.length === 0) {
        return reply.code(404).send({ 
          message: 'No se encontraron datos de OCR para este documento' 
        });
      }
      
      const ocrData = ocrResult.rows[0];
      
      return {
        documentId: documentId,
        fullText: ocrData.full_text,
        extractedData: ocrData.extracted_data,
        confidence: ocrData.confidence,
        processedAt: ocrData.created_at
      };
    } catch (error) {
      request.log.error(`Error getting OCR data: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener datos de OCR' });
    }
  }
});


// Route for processing documents (trigger OCR analysis)
fastify.post('/process/:documentId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const documentId = request.params.documentId;
      
      console.log(`Processing document ${documentId} for user ${userId}`);
      
      // Get document info
      const documentResult = await pool.query(
        `SELECT * FROM documents WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
      );
      
      if (documentResult.rows.length === 0) {
        return reply.code(404).send({ message: 'Document not found or access denied' });
      }
      
      const document = documentResult.rows[0];
      
      // Get file from MinIO
      const fileStream = await minioClient.getFileStream('documents', document.object_name);
      
      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);
      
      // Process with OCR in background
      processOcr(fileBuffer, documentId, userId).catch(err => {
        request.log.error(`Error processing OCR: ${err.message}`);
      });
      
      return { 
        message: 'Document processing started',
        documentId: documentId
      };
      
    } catch (error) {
      request.log.error(`Error starting document processing: ${error.message}`);
      return reply.code(500).send({ message: 'Error starting document processing' });
    }
  }
});

// Route for creating transactions from documents
fastify.post('/create-transaction/:documentId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const documentId = request.params.documentId;
      const transactionData = request.body;
      
      console.log(`Creating transaction for document ${documentId}:`, transactionData);
      
      // Verify document belongs to user
      const documentCheck = await pool.query(
        `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
      );
      
      if (documentCheck.rows.length === 0) {
        return reply.code(404).send({ message: 'Document not found or access denied' });
      }
      
      // Send to financial service
      const response = await axios.post('http://financial-service:3003/transactions', {
        userId: userId,
        documentId: documentId,
        amount: transactionData.amount,
        date: transactionData.date,
        description: transactionData.description,
        vendor: transactionData.vendor,
        transaction_type: transactionData.transaction_type || 'expense',
        source: 'manual'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response.data;
      
    } catch (error) {
      request.log.error(`Error creating transaction: ${error.message}`);
      if (error.response) {
        return reply.code(error.response.status).send(error.response.data);
      }
      return reply.code(500).send({ message: 'Error creating transaction' });
    }
  }
});

// Health check
fastify.get('/health', async () => {
  return { status: 'UP' };
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
