const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const UserRepository = require('./src/infrastructure/repositories/UserRepository');

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

// Register user endpoint
fastify.post('/register', async (request, reply) => {
  try {
    // Agregar un manejador explícito del cuerpo de la solicitud
    let body;
    try {
      body = request.body || {};
      // Validar que el cuerpo sea un objeto válido
      if (typeof body !== 'object' || body === null) {
        fastify.log.warn('Invalid request body received');
        body = {};
      }
    } catch (parseError) {
      fastify.log.error(`Error parsing request body: ${parseError.message}`);
      return reply.code(400).send({ message: 'Invalid request format' });
    }

    const { username, email, password } = body;
    
    // Validar campos requeridos
    if (!username || !email || !password) {
      fastify.log.warn(`Missing required fields: ${JSON.stringify({ username: !!username, email: !!email, password: !!password })}`);
      return reply.code(400).send({ message: 'Username, email and password are required' });
    }
    
    fastify.log.info(`Attempting to register user with email: ${email}`);
    
    // Check if user already exists
    const existingUser = await UserRepository.findByEmail(email);
    if (existingUser) {
      fastify.log.info(`User with email ${email} already exists`);
      return reply.code(400).send({ message: 'User already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const user = await UserRepository.create({
      username,
      email,
      password: hashedPassword
    });
    
    fastify.log.info(`New user created with ID: ${user.id}`);
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    fastify.log.info(`User registered successfully: ${email}`);
    return reply.code(201).send(userWithoutPassword);
  } catch (error) {
    fastify.log.error(`Registration error: ${error.message}`);
    fastify.log.error(error.stack);
    return reply.code(500).send({ message: 'Internal server error' });
  }
});

// Login user endpoint
fastify.post('/login', async (request, reply) => {
  try {
    const { email, password } = request.body;
    
    fastify.log.info(`Login attempt for email: ${email}`);
    
    // Find user
    const user = await UserRepository.findByEmail(email);
    if (!user) {
      fastify.log.info(`User with email ${email} not found`);
      return reply.code(401).send({ message: 'Invalid credentials' });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      fastify.log.info(`Invalid password for user ${email}`);
      return reply.code(401).send({ message: 'Invalid credentials' });
    }
    
    // Generate token
    const token = fastify.jwt.sign({ 
      id: user.id,
      email: user.email,
      username: user.username
    });
    
    fastify.log.info(`Login successful for user ${email}`);
    return reply.send({ token });
  } catch (error) {
    fastify.log.error(`Login error: ${error.message}`);
    fastify.log.error(error.stack);
    return reply.code(500).send({ message: 'Internal server error' });
  }
});

// Get current user endpoint
fastify.get('/me', {
  preValidation: [fastify.authenticate],
  handler: async (request, reply) => {
    try {
      const user = await UserRepository.findById(request.user.id);
      if (!user) {
        return reply.code(404).send({ message: 'User not found' });
      }
      
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      
      return userWithoutPassword;
    } catch (error) {
      fastify.log.error(error);
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
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    fastify.log.info(`Auth service listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();