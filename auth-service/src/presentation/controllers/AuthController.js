const AuthController = require('../controllers/AuthController');
const jwt = require('jsonwebtoken');cture/repositories/UserRepository');

async function routes(fastify, options) {ler = {
  // Register user
  fastify.post('/register', AuthController.register);ry {
        const { username, email, password } = request.body;
  // Login user
  fastify.post('/login', AuthController.login);
  await UserRepository.findByEmail(email);
  // Get current user (protected route)ingUser) {
  fastify.get('/me', {code(400).send({ message: 'User already exists' });
    preValidation: [fastify.authenticate],
    handler: AuthController.getMe 
  });    // Hash password



















};    }        return res.status(401).send({ message: 'Unauthorized!' });    } catch (error) {        next();        req.user = decoded;        const decoded = await jwt.verify(token, process.env.JWT_SECRET);    try {    }        return res.status(401).send({ message: 'No token provided.' });    if (!token) {    const token = req.headers['authorization'];module.exports = async (req, res, next) => {module.exports = routes;}      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Create user
      const user = await UserRepository.create({
        username,
        email,
        password: hashedPassword
      });
      
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      
      return reply.code(201).send(userWithoutPassword);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
    }
  },
  
  async login(request, reply) {
    try {
      const { email, password } = request.body;
      
      // Find user
      const user = await UserRepository.findByEmail(email);
      if (!user) {
        return reply.code(401).send({ message: 'Invalid credentials' });
      }
      
      // Check password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return reply.code(401).send({ message: 'Invalid credentials' });
      }
      
      // Generate token
      const token = fastify.jwt.sign({ 
        id: user.id,
        email: user.email,
        username: user.username
      });
      
      return { token };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
    }
  },
  
  async getMe(request, reply) {
    try {
      const user = await UserRepository.findById(request.user.id);
      if (!user) {
        return reply.code(404).send({ message: 'User not found' });
      }
      
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      
      return userWithoutPassword;
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
    }
  }
};

module.exports = AuthController;