FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and frontend files
COPY src/ ./src/
COPY frontend/ ./frontend/

# Expose the service port
EXPOSE 3000

# Start the service
CMD ["npm", "start"]