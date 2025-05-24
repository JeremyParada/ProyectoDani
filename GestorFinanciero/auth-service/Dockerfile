FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Create necessary directories
RUN mkdir -p src/presentation/controllers \
    src/presentation/routes \
    src/domain/entities \
    src/application/usecases \
    src/infrastructure/repositories

# Copy source code
COPY . .

# Expose the service port
EXPOSE 3001

# Start the service
CMD ["npm", "start"]