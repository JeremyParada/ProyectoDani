const AuthController = require('../controllers/AuthController');

async function routes(fastify, options) {
  // Register user
  fastify.post('/register', AuthController.register);
  
  // Login user
  fastify.post('/login', AuthController.login);
  
  // Get current user (protected route)
  fastify.get('/me', {
    preValidation: [fastify.authenticate],
    handler: AuthController.getMe
  });
}

module.exports = routes;