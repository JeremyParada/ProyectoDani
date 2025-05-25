const { Pool } = require('pg');

// Crear un pool de conexión para PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@postgres:5432/auth_db'
});

// Inicializar la base de datos con reintentos y un tiempo de espera más largo
const initDatabase = async () => {
  let retries = 15; // Aumentar el número de reintentos
  while (retries) {
    try {
      // Create the citext extension first, before any table operations
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      console.log('citext extension initialized successfully');
      
      // Crear la tabla de usuarios si no existe
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Tabla users inicializada correctamente');
      
      // Ejecutar una consulta simple para verificar que todo funciona
      await pool.query('SELECT 1');
      console.log('Conexión a la base de datos verificada correctamente');
      
      break;
    } catch (error) {
      console.error(`Error intentando inicializar la base de datos (${retries} intentos restantes):`, error);
      retries -= 1;
      // Esperar 10 segundos antes de reintentar (tiempo más largo)
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      if (retries === 0) {
        console.error('Se agotaron los reintentos para inicializar la base de datos');
        // No lanzar error, solo registrar que no se pudo conectar
        console.error('Continuando sin inicializar la base de datos. Se intentará en las próximas solicitudes.');
        return false;
      }
    }
  }
  return true;
};

// Inicializar la base de datos cuando se carga el módulo, pero no bloquear el arranque
let dbInitialized = false;
initDatabase().then(success => {
  dbInitialized = success;
}).catch(err => {
  console.error('Error en la inicialización de la base de datos:', err);
});

const UserRepository = {
  async create(userData) {
    // Intentar inicializar la base de datos si aún no se ha hecho
    if (!dbInitialized) {
      dbInitialized = await initDatabase();
    }
    
    const { username, email, password } = userData;
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
      [username, email, password]
    );
    
    return result.rows[0];
  },
  
  async findByEmail(email) {
    // Intentar inicializar la base de datos si aún no se ha hecho
    if (!dbInitialized) {
      dbInitialized = await initDatabase();
    }
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  },
  
  async findById(id) {
    // Intentar inicializar la base de datos si aún no se ha hecho
    if (!dbInitialized) {
      dbInitialized = await initDatabase();
    }
    
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  }
};

module.exports = UserRepository;