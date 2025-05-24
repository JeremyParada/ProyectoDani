const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');

// Register plugins
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey'
});

// Register routes
fastify.register(require('./presentation/routes/auth'));

// Health check
fastify.get('/health', async () => {
  return { status: 'UP' };
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    fastify.log.info(`Auth service listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();