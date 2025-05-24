FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose the service port
EXPOSE 3000

# Start the service
CMD ["npm", "start"]