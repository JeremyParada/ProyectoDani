const fastify = require('fastify')({ logger: true });
const multipart = require('@fastify/multipart');

// Register plugins
fastify.register(multipart);

// Register routes
// TODO: Add your routes here

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