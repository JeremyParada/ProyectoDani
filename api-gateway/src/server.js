const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');

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

// Authentication middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Auth header received:', authHeader);
  
  if (!authHeader) {
    console.log('No authorization header present');
    return res.status(401).json({ message: 'No token provided.' });
  }
  
  let token;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = authHeader;
  }
  
  console.log('Token extracted:', token.substring(0, 20) + '...');
  
  try {
    // IMPORTANTE: Usar la misma clave que en auth-service
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123');
    console.log('Token decoded successfully:', decoded.id);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ message: 'Invalid token.' });
  }
};

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

// Proxy for document service
app.use('/api/documents', authMiddleware, createProxyMiddleware({
  target: 'http://document-service:3002',
  changeOrigin: true,
  pathRewrite: {
    '^/api/documents': '', // remove /api/documents
  },
  onProxyReq: (proxyReq, req) => {
    // Asegurar que el token se pasa correctamente
    const token = req.headers.authorization;
    console.log('Proxying request with token:', token ? token.substring(0, 30) + '...' : 'none');
    
    if (token) {
      proxyReq.setHeader('Authorization', token);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('Proxy response status:', proxyRes.statusCode);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ message: 'Error interno del proxy' });
  }
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

// Endpoint específico para ver documentos
app.get('/view-document/:objectName', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).send('No se ha proporcionado token de autenticación');
  }
  
  // Redirigir a la API interna con el token en la cabecera
  const objectName = req.params.objectName;
  const targetUrl = `http://document-service:3002/view/${objectName}`;
  
  // Crear un proxy específico para esta solicitud
  const proxy = createProxyMiddleware({ 
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: (path) => `/view/${objectName}`,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('Authorization', `Bearer ${token}`);
    }
  });
  
  // Ejecutar el proxy
  proxy(req, res);
});

// Añadir este endpoint específico para la visualización de documentos codificados
app.get('/api/documents/view-encoded/:encodedObjectName', authMiddleware, (req, res) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'No token provided.' });
  }
  
  const encodedObjectName = req.params.encodedObjectName;
  
  // Crear un proxy específico para esta solicitud
  const proxy = createProxyMiddleware({ 
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: {
      [`^/api/documents/view-encoded/${encodedObjectName}`]: `/view-encoded/${encodedObjectName}`
    },
    onProxyReq: (proxyReq) => {
      // Pasar el token de autorización
      proxyReq.setHeader('Authorization', token);
    },
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).send({ 
        message: 'Error al comunicarse con el servicio de documentos',
        error: err.message
      });
    }
  });
  
  // Ejecutar el proxy
  proxy(req, res);
});

// Proxy for OCR data
app.get('/api/documents/ocr-data/:documentId', authMiddleware, (req, res) => {
  const token = req.headers.authorization;
  
  console.log(`Proxy OCR data request for document: ${req.params.documentId}`);
  
  const proxy = createProxyMiddleware({
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: {
      [`^/api/documents/ocr-data/${req.params.documentId}`]: `/ocr-data/${req.params.documentId}`
    },
    onProxyReq: (proxyReq, req) => {
      console.log(`Proxying OCR data request with token: ${token ? token.substring(0, 30) + '...' : 'none'}`);
      if (token) {
        proxyReq.setHeader('Authorization', token);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`OCR data proxy response status: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      console.error('OCR data proxy error:', err);
      res.status(500).json({ message: 'Error interno del proxy OCR' });
    }
  });
  
  proxy(req, res);
});

// Ruta para crear transacciones desde documentos
app.use('/api/documents/create-transaction/:documentId', authMiddleware, (req, res) => {
  const token = req.headers.authorization;
  
  const proxy = createProxyMiddleware({
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: {
      [`^/api/documents/create-transaction/:documentId`]: `/create-transaction/${req.params.documentId}`
    },
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('Authorization', token);
    }
  });
  
  proxy(req, res);
});

// Ruta para eliminar documentos
app.delete('/api/documents/documents/:documentId', authMiddleware, (req, res) => {
  const token = req.headers.authorization;
  const documentId = req.params.documentId;
  
  console.log(`API Gateway: Eliminando documento con ID/UUID: ${documentId}`);
  
  const proxy = createProxyMiddleware({
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: (path) => `/documents/${documentId}`,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('Authorization', token);
    },
    onError: (err, req, res) => {
      console.error('Proxy error en eliminación de documento:', err);
      res.status(500).send({ 
        message: 'Error al comunicarse con el servicio de documentos',
        error: err.message
      });
    }
  });
  
  // Esta línea faltaba - es crítica para que funcione el proxy
  proxy(req, res);
});

// Añadir proxy para el endpoint de procesamiento
app.post('/api/documents/process/:documentId', authMiddleware, (req, res) => {
  const token = req.headers.authorization;
  
  const proxy = createProxyMiddleware({
    target: 'http://document-service:3002',
    changeOrigin: true,
    pathRewrite: {
      [`^/api/documents/process/:documentId`]: `/process/${req.params.documentId}`
    },
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('Authorization', token);
    }
  });
  
  proxy(req, res);
});

// Catch-all route to serve the frontend for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(`Access the application at:`);
  console.log(`  Local: http://localhost:${PORT}`);
  console.log(`  Network: http://YOUR_IP_ADDRESS:${PORT}`);
});