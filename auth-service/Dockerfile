FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code - simplify the structure
COPY . .

# Expose the service port
EXPOSE 3001

# Start the service using the server.js in the root directory
CMD ["node", "server.js"]