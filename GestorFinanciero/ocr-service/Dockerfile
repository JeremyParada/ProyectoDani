FROM python:3.10-slim

WORKDIR /app

# Install Tesseract OCR and dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    tesseract-ocr-spa \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose the service port
EXPOSE 8000

# Start the FastAPI service with uvicorn - note the updated path
CMD ["uvicorn", "app.application.presentation.api.main:app", "--host", "0.0.0.0", "--port", "8000"]