const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Routes that don't require authentication
app.use('/api/auth', createProxyMiddleware({ 
  target: 'http://auth-service:3001',
  changeOrigin: true,
  pathRewrite: {'^/api/auth' : ''}
}));

// Routes that require authentication
app.use('/api/documents', authMiddleware, createProxyMiddleware({ 
  target: 'http://document-service:3002',
  changeOrigin: true,
  pathRewrite: {'^/api/documents' : ''}
}));

app.use('/api/financial', authMiddleware, createProxyMiddleware({ 
  target: 'http://financial-service:3003',
  changeOrigin: true,
  pathRewrite: {'^/api/financial' : ''}
}));

app.use('/api/ocr', authMiddleware, createProxyMiddleware({ 
  target: 'http://ocr-service:8000',
  changeOrigin: true,
  pathRewrite: {'^/api/ocr' : ''}
}));

// Health check
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'UP' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway running on port ${PORT}`);
});

// auth-service/src/presentation/routes/auth.js
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

// auth-service/src/server.js
const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');

// Register plugins
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey'
});

// Add authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
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