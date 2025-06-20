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
    } catch