const fastify = require('fastify')({ logger: true });
const multipart = require('@fastify/multipart');
const jwt = require('@fastify/jwt');

// Register plugins
fastify.register(multipart);
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
      
      // Here you would typically save the file to MinIO
      // This is a simplified response
      return { 
        message: 'File uploaded successfully',
        filename: data.filename,
        mimetype: data.mimetype
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
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