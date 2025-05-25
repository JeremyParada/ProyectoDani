const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for development
}));
app.use(morgan('combined'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes that don't require authentication
app.use('/api/auth', createProxyMiddleware({ 
  target: 'http://auth-service:3001',
  changeOrigin: true,
  pathRewrite: {'^/api/auth' : ''},
  onProxyReq: (proxyReq, req, res) => {
    // Asegurar que el body sea correctamente serializado
    if (req.body && typeof req.body === 'object') {
      const bodyData = JSON.stringify(req.body);
      // Actualizar los headers de contenido
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      // Escribir el body en la solicitud
      proxyReq.write(bodyData);
    }
    
    console.log(`Proxying request to: ${req.method} ${proxyReq.path}`);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    // Enviar una respuesta adecuada al cliente
    if (!res.headersSent) {
      res.status(500).json({ 
        message: 'El servicio de autenticación no está disponible. Por favor, inténtelo más tarde.',
        error: err.message
      });
    }
  },
  // Aumentar los tiempos de espera
  proxyTimeout: 30000,   // 30 segundos
  timeout: 30000,        // 30 segundos
  // Configuración para reconexión
  followRedirects: true,
  secure: false
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

// Catch-all route to serve the frontend for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});