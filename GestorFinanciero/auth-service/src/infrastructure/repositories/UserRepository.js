const users = [];
let nextId = 1;

const UserRepository = {
  async create(userData) {
    const user = {
      id: nextId++,
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    users.push(user);
    return user;
  },
  
  async findByEmail(email) {
    return users.find(user => user.email === email);
  },
  
  async findById(id) {
    return users.find(user => user.id === parseInt(id, 10));
  }
};

module.exports = UserRepository;