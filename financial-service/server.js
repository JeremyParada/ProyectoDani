const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');
const { Pool } = require('pg');

// Configurar la conexión a la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@postgres:5432/financial_db'
});

// Register plugins
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey123' // MISMA clave por defecto
});

// Authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ message: 'Unauthorized' });
  }
});

// ENDPOINT CORREGIDO - Unificando los dos endpoints GET /transactions
fastify.get('/transactions', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      
      // Obtener todas las transacciones del usuario
      const query = `
        SELECT t.*, c.name as category_name, c.color as category_color
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = $1
        ORDER BY t.date DESC
        LIMIT 10
      `;
      
      const result = await pool.query(query, [userId]);
      
      return { transactions: result.rows };
    } catch (error) {
      request.log.error(`Error fetching transactions: ${error.message}`);
      return reply.code(500).send({ message: 'Error al obtener las transacciones' });
    }
  }
});

// Modificar el endpoint para recibir datos de transacciones del OCR
fastify.post('/transactions', {
  handler: async (request, reply) => {
    try {
      const { userId, documentId, amount, date, description, category_id, transaction_type, source, category } = request.body;
      
      // Validar los datos recibidos
      if (!userId || !amount || !date) {
        return reply.code(400).send({ 
          message: 'Se requieren userId, amount y date para crear una transacción'
        });
      }
      
      // Si se proporciona una categoría pero no un category_id, intentar encontrar o crear la categoría
      let finalCategoryId = category_id || 2; // Por defecto "Gastos" (ID 2)
      
      if (category && !category_id) {
        try {
          // Verificar si la categoría ya existe
          const categoryResult = await pool.query(
            `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
            [category]
          );
          
          if (categoryResult.rows.length > 0) {
            // Usar la categoría existente
            finalCategoryId = categoryResult.rows[0].id;
          } else {
            // Crear nueva categoría
            const newCategoryResult = await pool.query(
              `INSERT INTO categories (name, description, color) 
               VALUES ($1, $2, $3) 
               RETURNING id`,
              [
                category,
                `Categoría detectada automáticamente: ${category}`,
                // Asignar un color aleatorio
                '#' + Math.floor(Math.random()*16777215).toString(16)
              ]
            );
            
            finalCategoryId = newCategoryResult.rows[0].id;
          }
        } catch (categoryError) {
          request.log.error(`Error processing category: ${categoryError.message}`);
          // Si hay un error, usar la categoría por defecto
        }
      }
      
      // Insertar la transacción en la base de datos
      const transactionQuery = `
        INSERT INTO transactions 
        (user_id, document_id, amount, description, date, category_id, transaction_type, source, verified) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;
      
      const result = await pool.query(transactionQuery, [
        userId,
        documentId,
        amount,
        description || 'Transacción generada por OCR',
        date,
        finalCategoryId,
        transaction_type || 'expense',
        source || 'ocr',
        false // No verificada por defecto
      ]);
      
      const transactionId = result.rows[0].id;
      
      return {
        message: 'Transacción creada exitosamente',
        transaction: {
          id: transactionId,
          user_id: userId,
          document_id: documentId,
          amount,
          description,
          date,
          category_id: finalCategoryId,
          transaction_type,
          source,
          verified: false
        }
      };
    } catch (error) {
      request.log.error(`Error creating transaction: ${error.message}`);
      return reply.code(500).send({ message: 'Error al crear la transacción' });
    }
  }
});

// Añadir el endpoint para eliminar transacciones
fastify.delete('/transactions/:transactionId', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const userId = request.user.id;
      const transactionId = request.params.transactionId;
      
      // Verificar que la transacción pertenece al usuario
      const checkResult = await pool.query(
        `SELECT * FROM transactions WHERE id = $1 AND user_id = $2`,
        [transactionId, userId]
      );
      
      if (checkResult.rows.length === 0) {
        return reply.code(404).send({ 
          message: 'Transacción no encontrada o no tienes permiso para eliminarla' 
        });
      }
      
      // Eliminar la transacción
      await pool.query(
        `DELETE FROM transactions WHERE id = $1`,
        [transactionId]
      );
      
      return { 
        message: 'Transacción eliminada correctamente',
        transactionId
      };
    } catch (error) {
      request.log.error(`Error eliminando transacción: ${error.message}`);
      return reply.code(500).send({ message: 'Error al eliminar la transacción' });
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
    await fastify.listen({ port: 3003, host: '0.0.0.0' });
    fastify.log.info(`Financial service listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();