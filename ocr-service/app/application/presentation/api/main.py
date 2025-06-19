from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pytesseract
from PIL import Image
import io
import re
import logging
import numpy as np
from datetime import datetime
import tempfile
import os
import traceback
from pdf2image import convert_from_bytes

# Configurar logging más detallado
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Verificar que tesseract está disponible
        version = pytesseract.get_tesseract_version()
        return {
            "status": "healthy",
            "tesseract_version": str(version),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@app.post("/process")
async def process_document(file: UploadFile = File(...)):
    """Process document with improved error handling and logging"""
    start_time = datetime.now()
    logger.info(f"=== Iniciando procesamiento de documento ===")
    logger.info(f"Archivo: {file.filename}, Tipo: {file.content_type}")
    
    try:
        # Leer contenido del archivo
        contents = await file.read()
        logger.info(f"Archivo leído: {len(contents)} bytes")
        
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="El archivo está vacío")
        
        # Inicializar imagen
        image = None
        
        # Procesar según el tipo de archivo
        if file.content_type == 'application/pdf' or file.filename.lower().endswith('.pdf'):
            logger.info("Procesando PDF...")
            image = await process_pdf(contents)
        else:
            logger.info("Procesando imagen...")
            image = await process_image(contents)
        
        if image is None:
            raise HTTPException(status_code=400, detail="No se pudo procesar el archivo")
        
        # Realizar OCR
        logger.info("Iniciando OCR...")
        text = await perform_ocr(image)
        
        if not text.strip():
            logger.warning("No se extrajo texto del documento")
            return {
                "text": "",
                "extracted_data": {"error": "No se pudo extraer texto del documento"},
                "confidence": 0.0,
                "processing_time": (datetime.now() - start_time).total_seconds()
            }
        
        # Extraer datos financieros
        logger.info("Extrayendo datos financieros...")
        extracted_data = extract_financial_data(text)
        
        processing_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Procesamiento completado en {processing_time:.2f} segundos")
        
        return {
            "text": text[:1000] + "..." if len(text) > 1000 else text,  # Limitar texto para response
            "extracted_data": extracted_data,
            "confidence": 0.85,
            "processing_time": processing_time
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error durante el procesamiento: {str(e)}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, 
            detail=f"Error interno del servidor: {str(e)}"
        )

async def process_pdf(contents: bytes) -> Image.Image:
    """Process PDF file and convert to image"""
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            logger.info("Convirtiendo PDF a imagen...")
            pages = convert_from_bytes(contents, 300, first_page=1, last_page=1)
            
            if not pages:
                raise ValueError("No se pudieron extraer páginas del PDF")
            
            image = pages[0]
            logger.info(f"PDF convertido exitosamente: {image.size}")
            return image
            
    except Exception as e:
        logger.error(f"Error procesando PDF: {str(e)}")
        raise

async def process_image(contents: bytes) -> Image.Image:
    """Process image file"""
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        
        try:
            image = Image.open(tmp_path)
            logger.info(f"Imagen cargada: {image.format}, {image.size}")
            return image
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except Exception as e:
        logger.error(f"Error procesando imagen: {str(e)}")
        raise

async def perform_ocr(image: Image.Image) -> str:
    """Perform OCR on image with multiple attempts"""
    try:
        # Convertir a escala de grises
        if image.mode != 'L':
            image = image.convert('L')
        
        # Intentar OCR con diferentes configuraciones
        configs = [
            '--psm 6',  # Uniform block of text
            '--psm 4',  # Single column of text
            '--psm 3',  # Fully automatic page segmentation
        ]
        
        best_text = ""
        best_confidence = 0
        
        for config in configs:
            try:
                logger.info(f"Intentando OCR con configuración: {config}")
                text = pytesseract.image_to_string(image, lang='spa', config=config)
                
                if text.strip() and len(text.strip()) > len(best_text.strip()):
                    best_text = text
                    logger.info(f"Mejor resultado encontrado: {len(text)} caracteres")
                    break
                    
            except Exception as e:
                logger.warning(f"OCR falló con config {config}: {str(e)}")
                continue
        
        return best_text
        
    except Exception as e:
        logger.error(f"Error en OCR: {str(e)}")
        raise

def extract_financial_data(text):
    """Extract structured financial data from OCR text with focus on Chilean context"""
    lines = text.split('\n')
    data = {
        "amount": None,
        "date": None,
        "description": None,
        "vendor": None,
        "invoice_number": None,
        "category": None,
        "due_date": None,
        "currency": "CLP"  # Default currency as Chilean Peso
    }
    
    # Patrones específicos para el contexto chileno
    amount_patterns = [
        r'\$\s*([\d.,]+)',                          # $1.234.567
        r'total:?\s*\$?\s*([\d.,]+)',               # Total: $1.234.567
        r'monto:?\s*\$?\s*([\d.,]+)',               # Monto: $1.234.567
        r'valor:?\s*\$?\s*([\d.,]+)',               # Valor: $1.234.567
        r'precio:?\s*\$?\s*([\d.,]+)',              # Precio: $1.234.567
        r'pagar:?\s*\$?\s*([\d.,]+)',               # Pagar: $1.234.567
        r'pago:?\s*\$?\s*([\d.,]+)',                # Pago: $1.234.567
        r'subtotal:?\s*\$?\s*([\d.,]+)',            # Subtotal: $1.234.567
        r'total a pagar:?\s*\$?\s*([\d.,]+)',       # Total a pagar: $1.234.567
        r'importe:?\s*\$?\s*([\d.,]+)',             # Importe: $1.234.567
        r'([\d.,]+)\s*pesos',                       # 1.234.567 pesos
        r'IVA:?\s*\$?\s*([\d.,]+)',                 # IVA: $1.234.567
        r'neto:?\s*\$?\s*([\d.,]+)'                 # Neto: $1.234.567
    ]
    
    # Patrones de fecha en formato chileno
    date_patterns = [
        r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',                  # DD/MM/YYYY o DD-MM-YYYY
        r'\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}',  # DD de Mes de YYYY
        r'fecha:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',        # Fecha: DD/MM/YYYY
        r'fecha de emisión:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Fecha de emisión: DD/MM/YYYY
        r'emisión:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',      # Emisión: DD/MM/YYYY
        r'fecha:?\s*\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}'  # Fecha: DD de Mes de YYYY
    ]
    
    # Patrones para fecha de vencimiento
    due_date_patterns = [
        r'vence:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',        # Vence: DD/MM/YYYY
        r'vencimiento:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Vencimiento: DD/MM/YYYY
        r'fecha de vencimiento:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Fecha de vencimiento: DD/MM/YYYY
        r'pagar antes del:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',      # Pagar antes del: DD/MM/YYYY
    ]
    
    # Patrones para facturas y boletas chilenas
    invoice_patterns = [
        r'factura:?\s*#?\s*([\w-]+)',               # Factura: #123456
        r'boleta:?\s*#?\s*([\w-]+)',                # Boleta: #123456
        r'documento:?\s*#?\s*([\w-]+)',             # Documento: #123456
        r'no[.:]?\s*([\w-]+)',                      # No. 123456
        r'factura electrónica:?\s*#?\s*([\w-]+)',   # Factura electrónica: #123456
        r'boleta electrónica:?\s*#?\s*([\w-]+)',    # Boleta electrónica: #123456
        r'folio:?\s*([\w-]+)',                      # Folio: 123456
        r'n°\s*factura:?\s*([\w-]+)',               # N° Factura: 123456
        r'n°\s*boleta:?\s*([\w-]+)',                # N° Boleta: 123456
        r'n°\s*documento:?\s*([\w-]+)'              # N° Documento: 123456
    ]
    
    # Categorías comunes de gastos en Chile
    category_keywords = {
        'supermercado': ['jumbo', 'lider', 'unimarc', 'santa isabel', 'tottus', 'supermercado', 'super', 'líder', 'walmart'],
        'servicios_basicos': ['luz', 'agua', 'gas', 'electricidad', 'enel', 'aguas andinas', 'metrogas', 'abastible', 'gasco', 'saesa', 'chilectra'],
        'telecomunicaciones': ['movistar', 'entel', 'claro', 'wom', 'vtr', 'gtd', 'directv', 'internet', 'telefonía', 'móvil', 'celular'],
        'transporte': ['metro', 'transantiago', 'red', 'bip', 'uber', 'cabify', 'taxi', 'didi', 'combustible', 'copec', 'shell', 'estacionamiento', 'peaje'],
        'salud': ['isapre', 'fonasa', 'clínica', 'hospital', 'farmacia', 'cruz verde', 'salcobrand', 'ahumada', 'doctor', 'médico', 'consulta'],
        'educacion': ['colegio', 'universidad', 'instituto', 'matrícula', 'escuela', 'educación', 'curso', 'capacitación'],
        'entretenimiento': ['cine', 'teatro', 'netflix', 'spotify', 'amazon', 'concierto', 'evento', 'entradas', 'suscripción'],
        'restaurantes': ['restaurant', 'restaurante', 'comida', 'delivery', 'pedidosya', 'ubereats', 'rappi', 'doordash'],
        'ropa': ['falabella', 'paris', 'ripley', 'corona', 'ropa', 'calzado', 'vestuario', 'h&m', 'zara'],
        'hogar': ['sodimac', 'easy', 'homecenter', 'construcción', 'muebles', 'decoración', 'hogar']
    }
    
    # Buscar información en el texto
    text_lower = text.lower()
    
    # Detectar categoría basada en palabras clave
    max_matches = 0
    detected_category = None
    
    for category, keywords in category_keywords.items():
        matches = sum(1 for keyword in keywords if keyword in text_lower)
        if matches > max_matches:
            max_matches = matches
            detected_category = category
    
    if max_matches > 0:
        data["category"] = detected_category
    
    # Procesar cada línea para extraer información
    for line in lines:
        line_lower = line.lower()
        
        # Buscar monto
        if data["amount"] is None:
            for pattern in amount_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    # Extraer y limpiar el monto
                    try:
                        amount_str = matches.group(1) if matches.groups() else re.sub(r'[^\d,.]', '', matches.group(0))
                        # Convertir formato chileno (1.234.567) a número
                        amount_str = amount_str.replace('.', '')
                        amount_str = amount_str.replace(',', '.')
                        data["amount"] = float(amount_str)
                        break
                    except (ValueError, IndexError):
                        continue
        
        # Buscar fecha
        if data["date"] is None:
            for pattern in date_patterns:
                matches = re.search(pattern, line)
                if matches:
                    date_str = matches.group(0)
                    # Extraer solo la parte de la fecha
                    date_match = re.search(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}', date_str)
                    if date_match:
                        data["date"] = date_match.group(0)
                        break
        
        # Buscar fecha de vencimiento
        if data["due_date"] is None:
            for pattern in due_date_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    date_str = matches.group(0)
                    # Extraer solo la parte de la fecha
                    date_match = re.search(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}', date_str)
                    if date_match:
                        data["due_date"] = date_match.group(0)
                        break
        
        # Buscar número de factura/boleta
        if data["invoice_number"] is None:
            for pattern in invoice_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    # Extraer el número
                    if matches.groups():
                        data["invoice_number"] = matches.group(1)
                    else:
                        num_match = re.search(r'[\w-]+$', matches.group(0))
                        if num_match:
                            data["invoice_number"] = num_match.group(0)
                    break
        
        # Buscar vendedor (primeras líneas, normalmente contienen el nombre del negocio)
        if data["vendor"] is None and len(line.strip()) > 3:
            # Excluir líneas que probablemente no son el nombre del vendedor
            if not any(x in line_lower for x in ['total', 'fecha', 'factura', 'dirección', 'monto', 'valor', 'precio']):
                if not re.search(r'^\d+[.,]\d+$', line.strip()):  # Evitar líneas que son solo números
                    data["vendor"] = line.strip()
    
    # Generar descripción más informativa
    if data["vendor"] and data["amount"]:
        if data["category"]:
            data["description"] = f"Pago a {data['vendor']} ({data['category']}) por ${int(data['amount']):,}".replace(',', '.')
        else:
            data["description"] = f"Pago a {data['vendor']} por ${int(data['amount']):,}".replace(',', '.')
    elif data["amount"]:
        if data["category"]:
            data["description"] = f"Pago ({data['category']}) por ${int(data['amount']):,}".replace(',', '.')
        else:
            data["description"] = f"Pago por ${int(data['amount']):,}".replace(',', '.')
    
    return data

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)