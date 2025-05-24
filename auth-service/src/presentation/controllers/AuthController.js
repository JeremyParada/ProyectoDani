const bcrypt = require('bcrypt');
const UserRepository = require('../../infrastructure/repositories/UserRepository');

const AuthController = {
  async register(request, reply) {
    try {
      const { username, email, password } = request.body;
      
      // Check if user already exists
      const existingUser = await UserRepository.findByEmail(email);
      if (existingUser) {
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