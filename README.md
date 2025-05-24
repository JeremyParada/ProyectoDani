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

1. Ensure Docker and Docker Compose are installed on your machine.
2. Clone the repository to your local machine.
3. Navigate to the project root directory.
4. Run the command `docker-compose up --build` to build and start all services.

## Usage

- Access the API Gateway at `http://localhost:3000` (or the specified port) to interact with the services.
- Use the defined routes for authentication, document management, and financial transactions.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License.