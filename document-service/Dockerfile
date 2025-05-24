FROM node:18-alpine

WORKDIR /app

# Install sharp dependencies
RUN apk add --no-cache python3 make g++ vips-dev

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose the service port
EXPOSE 3002

# Start the service
CMD ["npm", "start"]