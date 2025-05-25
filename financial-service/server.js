const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');

// Register plugins
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey'
});

// Authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ message: 'Unauthorized' });
  }
});

// Transactions endpoint
fastify.get('/transactions', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    // This would typically query from a database
    return { 
      transactions: [] 
    };
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