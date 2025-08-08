# Personal Finance System

This project is a microservices-based application designed for personal finance management. It consists of several services that handle user authentication, document management, OCR processing, and financial data management.

## Project Structure

- **api-gateway/**: The entry point for all API requests, handling routing and middleware.
- **auth-service/**: Manages user authentication, registration, and session management.
- **document-service/**: Handles the lifecycle of financial documents, including upload and storage.
- **ocr-service/**: Processes documents to extract relevant financial information using OCR technology.
- **financial-service/**: Manages financial transactions, including creation, retrieval, and categorization.

## Technologies Used

- **Backend**: Node.js, Fastify, Python, FastAPI
- **Database**: PostgreSQL
- **Storage**: MinIO
- **OCR Engine**: Tesseract
- **Queue**: Redis
- **API Gateway**: Kong or Traefik

## Setup Instructions

### Option 1: GitHub Codespaces (Recommended - Free Cloud Development)
1. Go to the GitHub repository page
2. Click the green "Code" button
3. Select the "Codespaces" tab
4. Click "Create codespace on main"
5. Wait for the environment to load (2-3 minutes)
6. Once loaded, open the terminal and run:
   ```bash
   docker-compose up --build
   ```
7. Access the application through the automatically forwarded ports
8. **No installation required!** Works in any browser

### Option 2: Local Development
1. Ensure Docker and Docker Compose are installed on your machine.
2. Clone the repository to your local machine.
3. Navigate to the project root directory.
4. Run the command `docker-compose up --build` to build and start all services.

## Usage

### In Codespaces:
- The API Gateway will be available through port 3000 (automatically forwarded)
- MinIO Console available through port 9000
- Click on the "Ports" tab in VS Code to see all available services

### Local Development:
- Access the API Gateway at `http://localhost:3000` (or the specified port) to interact with the services.
- Use the defined routes for authentication, document management, and financial transactions.

## Access for Collaborators

If you're a collaborator on this project:
1. Make sure you have access to the GitHub repository
2. Follow the "GitHub Codespaces" setup instructions above
3. No additional software installation needed!

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License.