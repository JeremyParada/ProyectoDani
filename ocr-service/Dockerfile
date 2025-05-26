FROM python:3.10-slim

WORKDIR /app

# Instalar Tesseract OCR y dependencias incluyendo OpenCV
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    tesseract-ocr-spa \
    libpq-dev \
    gcc \
    poppler-utils \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar requisitos Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir opencv-python-headless

# Copiar código fuente
COPY . .

# Exponer el puerto del servicio
EXPOSE 8000

# Iniciar el servicio FastAPI con uvicorn
CMD ["uvicorn", "app.application.presentation.api.main:app", "--host", "0.0.0.0", "--port", "8000"]