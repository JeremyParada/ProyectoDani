const AuthController = require('../controllers/AuthController');

async function routes(fastify, options) {
  fastify.log.info('Registering auth routes');
  
  // Register user
  fastify.post('/register', async (request, reply) => {
    fastify.log.info('Register request received');
    fastify.log.info(request.body);
    return AuthController.register(request, reply);
  });
  
  // Login user
  fastify.post('/login', async (request, reply) => {
    fastify.log.info('Login request received');
    return AuthController.login(request, reply);
  });
  
  // Get current user (protected route)
  fastify.get('/me', {
    preValidation: [fastify.authenticate],
    handler: async (request, reply) => {
      return AuthController.getMe(request, reply);
    }
  });
  
  fastify.log.info('Auth routes registered successfully');
}

module.exports = routes;